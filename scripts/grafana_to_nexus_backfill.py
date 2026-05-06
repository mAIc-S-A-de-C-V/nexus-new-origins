#!/usr/bin/env python3
"""
Backfill an Object Type from Grafana's InfluxDB datasource.

Usage:
    GRAFANA_URL=https://core-link.ddns.net:3003 \
    GRAFANA_TOKEN=glsa_...           # OR GRAFANA_USER + GRAFANA_PASS for basic auth
    GRAFANA_DATASOURCE_UID=efj5xtufyr85cd \
    INFLUX_BUCKET=bucket01 \
    NEXUS_ONTOLOGY_URL=http://localhost:8004 \
    NEXUS_TENANT_ID=tenant-4d3509ad \
    NEXUS_OT_ID=6bbd780f-4833-4d82-964d-1709d5971c5b \
    python3 scripts/grafana_to_nexus_backfill.py \
        --measurement alldevices --field running \
        --lookback-days 30 --aggregate-every 5m

Hits Grafana's `/api/ds/query` endpoint (which proxies the Flux query to
InfluxDB using Grafana's stored credentials), then upserts each data point
into the target OT via `/object-types/{ot_id}/records/ingest`.

Idempotent: PK is `<device>:<iso-timestamp>` so re-runs dedupe naturally.

Notes:
- Token > basic auth. Create a Viewer-role API key in Grafana →
  /admin/api-keys and pass it via GRAFANA_TOKEN.
- The script chunks the lookback window into per-day Flux queries so a
  long backfill doesn't blow out memory or hit Grafana's response limits.
- Records are POSTed in batches (default 1000).
- `--devices` is optional; if omitted, all devices in the measurement are
  fetched in one shot. Pass a comma-separated list to subset.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Iterable

import urllib.request
import urllib.error
import ssl
import base64


def _http_post(url: str, *, data: bytes, headers: dict[str, str], insecure: bool = False, timeout: int = 60) -> tuple[int, bytes]:
    ctx = ssl.create_default_context()
    if insecure:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def _build_flux(bucket: str, measurement: str, field: str, devices: list[str] | None,
                start_iso: str, stop_iso: str, every: str) -> str:
    """Build a Flux query for a measurement+field, optionally narrowed to a
    specific device list. `every` is the aggregateWindow window (e.g. "5m").
    """
    parts = [
        f'from(bucket: "{bucket}")',
        f'  |> range(start: time(v: "{start_iso}"), stop: time(v: "{stop_iso}"))',
        f'  |> filter(fn: (r) => r["_measurement"] == "{measurement}")',
        f'  |> filter(fn: (r) => r["_field"] == "{field}")',
    ]
    if devices:
        # OR-chain device filters via contains() — keeps one round-trip.
        device_arr = "[" + ", ".join(f'"{d}"' for d in devices) + "]"
        parts.append(
            f'  |> filter(fn: (r) => contains(value: r["device"], set: {device_arr}))'
        )
    parts.append(f'  |> aggregateWindow(every: {every}, fn: mean, createEmpty: false)')
    parts.append('  |> yield(name: "mean")')
    return "\n".join(parts)


def _grafana_query(grafana_url: str, ds_uid: str, flux: str, *, auth_header: str, insecure: bool) -> dict:
    body = json.dumps({
        "queries": [{
            "refId": "A",
            "datasource": {"uid": ds_uid, "type": "influxdb"},
            "query": flux,
        }],
    }).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": auth_header,
    }
    code, raw = _http_post(f"{grafana_url}/api/ds/query", data=body, headers=headers, insecure=insecure)
    if code >= 400:
        raise RuntimeError(f"Grafana query failed ({code}): {raw[:500]!r}")
    return json.loads(raw)


def _frames_to_records(payload: dict, *, field_name: str) -> list[dict]:
    """Reshape Grafana frames into [{id, time, sensor_name, device, <field>}].

    Grafana returns one frame per series; each frame has two columns:
      - column 0: timestamps (ms epoch, integer)
      - column 1: numeric values, with `labels.device` carrying the tag value
    """
    records: list[dict] = []
    for ref_block in payload.get("results", {}).values():
        for frame in ref_block.get("frames", []) or []:
            schema = frame.get("schema", {})
            fields = schema.get("fields", [])
            if len(fields) < 2:
                continue
            data_cols = frame.get("data", {}).get("values", [])
            if len(data_cols) < 2 or not data_cols[0]:
                continue
            device = (fields[1].get("labels") or {}).get("device", "")
            timestamps_ms = data_cols[0]
            values = data_cols[1]
            for ts_ms, v in zip(timestamps_ms, values):
                if ts_ms is None or v is None:
                    continue
                ts_iso = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).isoformat()
                records.append({
                    "id": f"{device}:{ts_iso}",
                    "time": ts_iso,
                    "sensor_name": device,
                    "device": device,
                    field_name: float(v),
                })
    return records


def _ingest_chunk(nexus_url: str, ot_id: str, tenant_id: str, records: list[dict], pk_field: str) -> dict:
    body = json.dumps({
        "records": records,
        "pk_field": pk_field,
        "pipeline_id": "grafana_backfill",
    }).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-tenant-id": tenant_id,
    }
    code, raw = _http_post(
        f"{nexus_url}/object-types/{ot_id}/records/ingest",
        data=body, headers=headers, insecure=False, timeout=120,
    )
    if code >= 400:
        raise RuntimeError(f"Nexus ingest failed ({code}): {raw[:500]!r}")
    return json.loads(raw)


def _chunked(seq: list, n: int) -> Iterable[list]:
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--measurement", default="alldevices")
    ap.add_argument("--field", default="running")
    ap.add_argument("--devices", default="", help="Comma-separated device names; empty = all")
    ap.add_argument("--lookback-days", type=int, default=30)
    ap.add_argument("--aggregate-every", default="5m")
    ap.add_argument("--day-window", type=int, default=1, help="Days per Flux query (smaller = more requests, less RAM)")
    ap.add_argument("--batch-size", type=int, default=1000)
    ap.add_argument("--insecure", action="store_true", help="Skip TLS verification (self-signed certs)")
    ap.add_argument("--dry-run", action="store_true", help="Pull and print counts; don't ingest")
    args = ap.parse_args()

    # ── Env wiring ────────────────────────────────────────────────────────
    grafana_url = os.environ.get("GRAFANA_URL", "").rstrip("/")
    grafana_token = os.environ.get("GRAFANA_TOKEN", "")
    grafana_user = os.environ.get("GRAFANA_USER", "")
    grafana_pass = os.environ.get("GRAFANA_PASS", "")
    ds_uid = os.environ.get("GRAFANA_DATASOURCE_UID", "")
    bucket = os.environ.get("INFLUX_BUCKET", "")
    nexus_url = os.environ.get("NEXUS_ONTOLOGY_URL", "http://localhost:8004").rstrip("/")
    tenant_id = os.environ.get("NEXUS_TENANT_ID", "")
    ot_id = os.environ.get("NEXUS_OT_ID", "")

    missing = [
        n for n, v in [
            ("GRAFANA_URL", grafana_url),
            ("GRAFANA_DATASOURCE_UID", ds_uid),
            ("INFLUX_BUCKET", bucket),
            ("NEXUS_TENANT_ID", tenant_id),
            ("NEXUS_OT_ID", ot_id),
        ] if not v
    ]
    if missing:
        print(f"missing env vars: {', '.join(missing)}", file=sys.stderr)
        return 2
    if not grafana_token and not (grafana_user and grafana_pass):
        print("provide GRAFANA_TOKEN (preferred) or GRAFANA_USER + GRAFANA_PASS", file=sys.stderr)
        return 2

    if grafana_token:
        auth_header = f"Bearer {grafana_token}"
    else:
        b64 = base64.b64encode(f"{grafana_user}:{grafana_pass}".encode()).decode()
        auth_header = f"Basic {b64}"

    devices = [d.strip() for d in args.devices.split(",") if d.strip()] or None

    # ── Walk the lookback window in day-sized chunks ─────────────────────
    end = datetime.now(timezone.utc).replace(microsecond=0)
    start = end - timedelta(days=args.lookback_days)
    cur = start

    total_records = 0
    total_ingested = 0
    while cur < end:
        chunk_end = min(cur + timedelta(days=args.day_window), end)
        flux = _build_flux(
            bucket=bucket,
            measurement=args.measurement,
            field=args.field,
            devices=devices,
            start_iso=cur.isoformat().replace("+00:00", "Z"),
            stop_iso=chunk_end.isoformat().replace("+00:00", "Z"),
            every=args.aggregate_every,
        )
        try:
            payload = _grafana_query(grafana_url, ds_uid, flux, auth_header=auth_header, insecure=args.insecure)
        except Exception as e:
            print(f"[{cur.date()}..{chunk_end.date()}] grafana fetch failed: {e}", file=sys.stderr)
            cur = chunk_end
            continue

        records = _frames_to_records(payload, field_name=args.field)
        total_records += len(records)
        per_device: dict[str, int] = {}
        for r in records:
            per_device[r["sensor_name"]] = per_device.get(r["sensor_name"], 0) + 1
        print(
            f"[{cur.date()}..{chunk_end.date()}] {len(records)} points: "
            + ", ".join(f"{k}={v}" for k, v in sorted(per_device.items()))
        )

        if not args.dry_run and records:
            for batch in _chunked(records, args.batch_size):
                resp = _ingest_chunk(nexus_url, ot_id, tenant_id, batch, pk_field="id")
                total_ingested += int(resp.get("ingested", 0) or 0)
        cur = chunk_end

    print()
    print(f"DONE — fetched {total_records} points, ingested {total_ingested} records.")
    if args.dry_run:
        print("(dry-run — nothing was written to Nexus)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
