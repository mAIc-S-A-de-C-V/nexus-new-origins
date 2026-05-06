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


import re as _re

_TAG_NAME_RE = _re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,63}$")


def _build_flux(bucket: str, measurement: str, fields: list[str],
                entity_tag: str, entities: list[str] | None,
                start_iso: str, stop_iso: str, every: str) -> str:
    """Build a Flux query for a measurement and one-or-more fields, narrowed
    to optional entities (matched on `entity_tag`). `every` empty = raw
    events; non-empty (e.g. "5m") = aggregateWindow downsample. Pivot folds
    multi-field results into one row per (entity, _time).
    """
    if not fields:
        raise ValueError("at least one field is required")
    if not _TAG_NAME_RE.match(entity_tag):
        raise ValueError(f"invalid entity_tag {entity_tag!r}")
    parts = [
        f'from(bucket: "{bucket}")',
        f'  |> range(start: time(v: "{start_iso}"), stop: time(v: "{stop_iso}"))',
        f'  |> filter(fn: (r) => r["_measurement"] == "{measurement}")',
    ]
    field_arr = "[" + ", ".join(f'"{f}"' for f in fields) + "]"
    parts.append(f'  |> filter(fn: (r) => contains(value: r["_field"], set: {field_arr}))')
    if entities:
        ent_arr = "[" + ", ".join(f'"{d}"' for d in entities) + "]"
        parts.append(
            f'  |> filter(fn: (r) => contains(value: r["{entity_tag}"], set: {ent_arr}))'
        )
    if every:
        parts.append(f'  |> aggregateWindow(every: {every}, fn: mean, createEmpty: false)')
    parts.append('  |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")')
    parts.append('  |> yield(name: "pivoted")')
    return "\n".join(parts)


def _grafana_query(grafana_url: str, ds_uid: str, flux: str, *, auth_header: str, insecure: bool,
                    max_data_points: int = 500_000) -> dict:
    body = json.dumps({
        "queries": [{
            "refId": "A",
            "datasource": {"uid": ds_uid, "type": "influxdb"},
            "query": flux,
            # Override Grafana's 1001-point cap that truncates raw-mode pulls.
            "maxDataPoints": int(max_data_points),
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


def _frames_to_records(payload: dict, *, entity_tag: str = "device") -> list[dict]:
    """Reshape pivoted Grafana frames into one record per (entity, _time).
    Each pivoted field becomes its own top-level column. Records carry the
    entity value under the configured tag column name (e.g. `device`,
    `host`, `asset_id`). When entity_tag="device" we also write a
    `sensor_name` alias for back-compat with sensor dashboards.
    """
    records: list[dict] = []
    for ref_block in payload.get("results", {}).values():
        for frame in ref_block.get("frames", []) or []:
            fields_meta = frame.get("schema", {}).get("fields", [])
            cols = frame.get("data", {}).get("values", [])
            if len(fields_meta) < 2 or len(cols) < 2 or not cols[0]:
                continue
            time_idx = next(
                (i for i, f in enumerate(fields_meta) if f.get("type") == "time"),
                0,
            )
            value_indices = [i for i in range(len(fields_meta)) if i != time_idx]
            if not value_indices:
                continue
            entity_value = ""
            for vi in value_indices:
                lbl = fields_meta[vi].get("labels") or {}
                if lbl.get(entity_tag):
                    entity_value = lbl[entity_tag]
                    break
            n_rows = len(cols[time_idx])
            for row_idx in range(n_rows):
                ts_ms = cols[time_idx][row_idx]
                if ts_ms is None:
                    continue
                ts_iso = datetime.fromtimestamp(ts_ms / 1000.0, tz=timezone.utc).isoformat()
                rec: dict = {
                    "id": f"{entity_value}:{ts_iso}",
                    "time": ts_iso,
                    entity_tag: entity_value,
                }
                if entity_tag == "device":
                    rec["sensor_name"] = entity_value
                for vi in value_indices:
                    fname = fields_meta[vi].get("name") or f"col_{vi}"
                    val = cols[vi][row_idx] if row_idx < len(cols[vi]) else None
                    if val is None:
                        continue
                    ftype = (fields_meta[vi].get("type") or "").lower()
                    if ftype == "number":
                        try:
                            rec[fname] = float(val)
                        except (TypeError, ValueError):
                            rec[fname] = val
                    else:
                        rec[fname] = val
                records.append(rec)
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
    ap.add_argument(
        "--fields",
        default="running,temp,heap,wifi_rssi,reconn,uptime,wifi_ok",
        help="Comma-separated InfluxDB field names; pivoted into one record per (device, time)",
    )
    ap.add_argument("--field", default="", help="(legacy single-field — overridden by --fields if set)")
    ap.add_argument(
        "--entity-tag",
        default="device",
        help="InfluxDB tag name that identifies each entity (e.g. device, host, asset_id)",
    )
    ap.add_argument("--entities", default="", help="Comma-separated entity values to filter; empty = all")
    ap.add_argument("--devices", default="", help="(legacy alias for --entities)")
    ap.add_argument("--lookback-days", type=int, default=30)
    ap.add_argument(
        "--aggregate-every",
        default="",
        help="Flux aggregateWindow size (e.g. 5m). Empty = raw events at native cadence.",
    )
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

    # Accept --entities (preferred) or legacy --devices; merge both if given.
    entity_csv = ",".join(x for x in (args.entities, args.devices) if x)
    entities = [d.strip() for d in entity_csv.split(",") if d.strip()] or None
    # Multi-field by default; legacy --field still works as a single-field override.
    fields = [f.strip() for f in args.fields.split(",") if f.strip()]
    if not fields and args.field:
        fields = [args.field.strip()]
    if not fields:
        print("must provide --fields or --field", file=sys.stderr)
        return 2

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
            fields=fields,
            entity_tag=args.entity_tag,
            entities=entities,
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

        records = _frames_to_records(payload, entity_tag=args.entity_tag)
        total_records += len(records)
        per_entity: dict[str, int] = {}
        for r in records:
            ev = str(r.get(args.entity_tag) or "(unknown)")
            per_entity[ev] = per_entity.get(ev, 0) + 1
        print(
            f"[{cur.date()}..{chunk_end.date()}] {len(records)} points: "
            + ", ".join(f"{k}={v}" for k, v in sorted(per_entity.items()))
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
