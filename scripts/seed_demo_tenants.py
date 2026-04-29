"""
Seed each demo tenant with connectors, object types, events, and (where it makes
sense) cross-object Process definitions — so logging in as any demo user lights
up Process Mining v2 with realistic data.

Run from the host:
    python3 scripts/seed_demo_tenants.py

Idempotent — re-running skips work that's already done (matched by name).
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from typing import Any
from uuid import uuid4

import urllib.request
import urllib.error

CONNECTOR_API = "http://localhost:8001"
ONTOLOGY_API  = "http://localhost:8004"
EVENT_LOG_API = "http://localhost:8005"
PROCESS_API   = "http://localhost:8009"
DEMO_API      = "http://localhost:8024"

DEMO_INTERNAL = "http://demo-service:8024"  # what connectors store as base_url

# Per-record cap. Bigger = richer demo, but more memory + ingestion time.
RECORD_CAP_PER_DATASET = 5000

# Tenant → datasets to ingest as object types. Each entry: (dataset_id, object_type_name, case_id_field)
TENANTS: dict[str, list[tuple[str, str, str]]] = {
    "tenant-finance": [
        ("bpic2012-loan-applications", "LoanApplication2012", "case_id"),
        ("bpic2017-loan-applications", "LoanApplication2017", "case_id"),
    ],
    "tenant-procurement": [
        ("bpic2019-purchase-orders", "PurchaseOrder", "case_id"),
    ],
    "tenant-healthcare": [
        ("bpic2011-hospital", "PatientVisit", "case_id"),
        ("sepsis-icu", "SepsisCase", "case_id"),
    ],
    "tenant-itsm": [
        ("bpic2014-incidents", "ITIncident", "incident_id"),
        ("bpic2014-changes", "ITChange", "change_id"),
    ],
    "tenant-government": [
        ("traffic-fines", "TrafficFine", "case_id"),
        ("bpic2015-permits-m1", "BuildingPermitM1", "case_id"),
        ("bpic2015-permits-m2", "BuildingPermitM2", "case_id"),
    ],
    "tenant-manufacturing": [
        ("smart-factory-iot", "ProductionOrder", "case_id"),
    ],
    "tenant-travel": [
        ("bpic2020-domestic", "DomesticTravel", "case_id"),
        ("bpic2020-international", "InternationalTravel", "case_id"),
        ("bpic2020-prepaid", "PrepaidTravel", "case_id"),
        ("bpic2020-permits", "TravelPermit", "case_id"),
        ("bpic2020-payments", "PaymentRequest", "case_id"),
    ],
    "tenant-demo": [
        # Insurance is multi-object and shares policy_id → great for cross-object PM
        ("insurance-claims", "InsuranceClaim", "case_id"),
        # The two below are records-shaped, not events. Skip event ingestion for them.
        ("insurance-policies", "InsurancePolicy", "policy_id"),
        ("insurance-medical-submissions", "MedicalSubmission", "submission_id"),
    ],
}

# Cross-object process definitions to create (uses case_key_attribute joining).
# Listed by tenant. Object type IDs are resolved at runtime by name.
PROCESSES_TO_CREATE: dict[str, list[dict]] = {
    "tenant-itsm": [
        {
            "name": "Incident-to-Change",
            "description": "Cross-object: incidents linked to changes via CI Name (km_number ↔ ci_name).",
            "case_key_attribute": "ci_name",
            "object_type_names": ["ITIncident", "ITChange"],
        },
    ],
    "tenant-travel": [
        {
            "name": "Travel End-to-End",
            "description": "Permit → declaration → payment, joined by travel_permit_number.",
            "case_key_attribute": "travel_permit_number",
            "object_type_names": ["TravelPermit", "DomesticTravel", "InternationalTravel"],
        },
    ],
    "tenant-demo": [
        {
            "name": "Policy → Claim Lifecycle",
            "description": "Cross-object: insurance policy linked to claims via policy_id.",
            "case_key_attribute": "policy_id",
            "object_type_names": ["InsurancePolicy", "InsuranceClaim"],
        },
    ],
}


# ── Tiny HTTP helper ──────────────────────────────────────────────────────────

class HttpError(Exception):
    pass


def req(method: str, url: str, *, headers: dict[str, str] | None = None,
        body: Any = None, timeout: int = 60) -> Any:
    data = None
    h = {"Content-Type": "application/json"}
    if headers:
        h.update(headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            ctype = resp.headers.get("Content-Type", "")
            if "json" in ctype:
                return json.loads(raw)
            return raw
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", "replace")[:500]
        raise HttpError(f"{method} {url} → {e.code}: {body_txt}") from e


def th(tenant_id: str) -> dict[str, str]:
    return {"x-tenant-id": tenant_id}


# ── Connector + object type management ────────────────────────────────────────

def get_or_create_connector(tenant_id: str, dataset_id: str, name: str) -> str:
    existing = req("GET", f"{CONNECTOR_API}/connectors", headers=th(tenant_id))
    for c in existing or []:
        if c.get("name") == name:
            return c["id"]
    body = {
        "name": name,
        "type": "REST_API",
        "category": "Demo",
        "description": f"Auto-seeded connector for demo dataset {dataset_id}",
        "base_url": f"{DEMO_INTERNAL}/datasets/{dataset_id}/records",
        "auth_type": "None",
        "tags": ["demo", "process-mining"],
        "config": {"page_size": 500},
    }
    created = req("POST", f"{CONNECTOR_API}/connectors", headers=th(tenant_id), body=body)
    return created["id"]


def infer_properties(fields_info: list[dict]) -> list[dict]:
    """Map dataset schema fields → ObjectProperty dicts the ontology service expects."""
    type_map = {"string": "string", "integer": "integer", "float": "float",
                "boolean": "boolean", "datetime": "datetime"}
    out = []
    for f in fields_info:
        name_lc = f["name"].lower()
        ftype = f.get("type", "string")
        # Heuristic semantic type
        if name_lc in ("id", "case_id", "incident_id", "change_id", "submission_id",
                       "policy_id", "claim_id", "permit_number", "travel_permit_number",
                       "declaration_number", "ci_name", "km_number"):
            sem = "IDENTIFIER"
        elif "email" in name_lc:
            sem = "EMAIL"
        elif name_lc.endswith("_at") or name_lc in ("timestamp", "start_date", "end_date",
                                                     "submission_date", "reg_date"):
            sem = "DATETIME" if ftype == "datetime" else "DATE"
        elif name_lc in ("status", "lifecycle", "state"):
            sem = "STATUS"
        elif "amount" in name_lc or "premium" in name_lc or "cost" in name_lc or "deductible" in name_lc:
            sem = "CURRENCY"
        elif ftype == "boolean":
            sem = "BOOLEAN"
        elif ftype in ("integer", "float"):
            sem = "QUANTITY"
        else:
            sem = "TEXT"
        out.append({
            "id": str(uuid4()),
            "name": f["name"],
            "display_name": f["name"].replace("_", " ").title(),
            "semantic_type": sem,
            "data_type": type_map.get(ftype, "string"),
            "pii_level": "NONE",
            "required": False,
            "description": None,
            "sample_values": [str(s) for s in f.get("samples", [])][:3],
        })
    return out


def get_or_create_object_type(tenant_id: str, name: str, dataset_id: str,
                              connector_id: str, schema: dict) -> str:
    existing = req("GET", f"{ONTOLOGY_API}/object-types", headers=th(tenant_id))
    for ot in existing or []:
        if ot.get("name") == name:
            return ot["id"]
    body = {
        "id": str(uuid4()),
        "name": name,
        "display_name": name,
        "description": f"Auto-seeded from demo dataset {dataset_id}",
        "properties": infer_properties(schema.get("fields", [])),
        "source_connector_ids": [connector_id],
        "version": 1,
        "schema_health": "healthy",
        "tenant_id": tenant_id,
    }
    created = req("POST", f"{ONTOLOGY_API}/object-types", headers=th(tenant_id), body=body)
    return created["id"]


# ── Event ingestion ───────────────────────────────────────────────────────────

EVENT_DATASETS = {
    # Dataset id → (case_id_field, activity_field, timestamp_field)
    "bpic2012-loan-applications":   ("case_id", "activity", "timestamp"),
    "bpic2017-loan-applications":   ("case_id", "activity", "timestamp"),
    "bpic2019-purchase-orders":     ("case_id", "activity", "timestamp"),
    "bpic2011-hospital":            ("case_id", "activity", "timestamp"),
    "sepsis-icu":                   ("case_id", "activity", "timestamp"),
    "bpic2014-incidents":           ("incident_id", "activity", "timestamp"),
    "bpic2014-changes":             ("change_id", "activity", "timestamp"),
    "traffic-fines":                ("case_id", "activity", "timestamp"),
    "bpic2015-permits-m1":          ("case_id", "activity", "timestamp"),
    "bpic2015-permits-m2":          ("case_id", "activity", "timestamp"),
    "bpic2015-permits-m3":          ("case_id", "activity", "timestamp"),
    "bpic2015-permits-m4":          ("case_id", "activity", "timestamp"),
    "bpic2015-permits-m5":          ("case_id", "activity", "timestamp"),
    "smart-factory-iot":            ("case_id", "activity", "timestamp"),
    "bpic2020-domestic":            ("case_id", "activity", "timestamp"),
    "bpic2020-international":       ("case_id", "activity", "timestamp"),
    "bpic2020-prepaid":             ("case_id", "activity", "timestamp"),
    "bpic2020-permits":             ("case_id", "activity", "timestamp"),
    "bpic2020-payments":            ("case_id", "activity", "timestamp"),
    "insurance-claims":             ("case_id", "activity", "timestamp"),
}


# Per-dataset case_key mapping for cross-object Process Mining.
# Field names differ across datasets — this maps each dataset's "join" field
# to the same logical case_key written into attributes.case_key at ingest time.
# Each value is the field whose value is the cross-object identifier.
CASE_KEY_FIELD_BY_DATASET: dict[str, str] = {
    # ITSM: incidents reference CIs via km_number; changes via ci_name.
    "bpic2014-incidents": "km_number",
    "bpic2014-changes":   "ci_name",
    # Travel: permits' own id IS the join key; declarations carry travel_permit_number.
    "bpic2020-permits":       "case_id",
    "bpic2020-domestic":      "travel_permit_number",
    "bpic2020-international": "travel_permit_number",
    # Insurance: claims carry policy_id; policies' own id IS the join key.
    "insurance-claims": "policy_id",
}


# Per-tenant cross-object remap config.
# The demo data generators produce disjoint ID ranges across related datasets
# (e.g. permit IDs TP-10000..TP-10833 vs declaration permit refs TP-25000..),
# so the natural join misses. We deterministically remap child datasets' case_keys
# onto the anchor's key universe so cross-object cases actually fire.
#
#   anchor_dataset        — defines the universe of valid case_key values
#   anchor_field          — field on anchor records that holds the case_key value
#   anchor_is_event       — whether the anchor itself produces events (vs records-only)
#   child_datasets        — datasets whose records should be remapped
CROSS_OBJECT_REMAP: dict[str, dict] = {
    "tenant-itsm": {
        "anchor_dataset":  "bpic2014-changes",
        "anchor_field":    "ci_name",
        "anchor_is_event": True,
        "child_datasets":  ["bpic2014-incidents"],
    },
    "tenant-travel": {
        "anchor_dataset":  "bpic2020-permits",
        "anchor_field":    "case_id",
        "anchor_is_event": True,
        "child_datasets":  ["bpic2020-domestic", "bpic2020-international"],
    },
    "tenant-demo": {
        # Policies are records, not events. We use them only as the case_key universe.
        "anchor_dataset":  "insurance-policies",
        "anchor_field":    "policy_id",
        "anchor_is_event": False,
        "child_datasets":  ["insurance-claims"],
    },
}


def fetch_anchor_keys(dataset_id: str, field: str, cap: int = 5000) -> list[str]:
    """Pull the unique values of `field` from a dataset, trimmed to `cap`."""
    seen: list[str] = []
    seen_set: set[str] = set()
    offset = 0
    page = 500
    while len(seen) < cap:
        resp = req("GET", f"{DEMO_API}/datasets/{dataset_id}/records?limit={page}&offset={offset}",
                   timeout=120)
        recs = resp.get("records", []) if resp else []
        if not recs:
            break
        for r in recs:
            v = r.get(field)
            if v in (None, ""):
                continue
            v = str(v)
            if v not in seen_set:
                seen_set.add(v)
                seen.append(v)
                if len(seen) >= cap:
                    break
        offset += page
        if len(recs) < page:
            break
    return seen


def ingest_events(tenant_id: str, dataset_id: str, object_type_id: str,
                  connector_id: str, cap: int = RECORD_CAP_PER_DATASET,
                  remap_to_anchor: list[str] | None = None) -> int:
    """Stream dataset records → events into the event log."""
    triple = EVENT_DATASETS.get(dataset_id)
    if not triple:
        return 0
    case_field, act_field, ts_field = triple

    # Skip if events already present
    existing = req(
        "GET",
        f"{EVENT_LOG_API}/events?object_type={object_type_id}&limit=1",
        headers=th(tenant_id),
    )
    if existing:
        return 0  # already seeded

    pipeline_id = f"seed::{dataset_id}"
    total_written = 0
    page_size = 1000
    offset = 0

    while total_written < cap:
        n = min(page_size, cap - total_written)
        url = f"{DEMO_API}/datasets/{dataset_id}/records?limit={n}&offset={offset}"
        page = req("GET", url, timeout=120)
        records = page.get("records", []) if page else []
        if not records:
            break

        case_key_field = CASE_KEY_FIELD_BY_DATASET.get(dataset_id)
        events = []
        for rec in records:
            cid = str(rec.get(case_field, ""))
            act = str(rec.get(act_field, "RECORD_SYNCED"))
            ts = rec.get(ts_field) or ""
            if not cid:
                continue
            # Build attributes: every field except the three event keys
            attrs = {k: v for k, v in rec.items()
                     if k not in (case_field, act_field, ts_field)
                     and not isinstance(v, (list, dict))}
            attrs["record_snapshot"] = {k: v for k, v in rec.items()
                                       if not isinstance(v, (list, dict))}
            # Write cross-object case_key inline so no backfill is needed.
            if case_key_field:
                v = rec.get(case_key_field)
                if v not in (None, ""):
                    attrs["case_key"] = str(v)
            # Remap to anchor universe for cross-object joining (see CROSS_OBJECT_REMAP).
            # Deterministic — same source case_id always maps to the same anchor key.
            if remap_to_anchor:
                anchor_idx = abs(hash(cid)) % len(remap_to_anchor)
                attrs["case_key"] = remap_to_anchor[anchor_idx]
            events.append({
                "id": str(uuid4()),
                "case_id": cid,
                "activity": act,
                "timestamp": ts,
                "object_type_id": object_type_id,
                "object_id": cid,
                "pipeline_id": pipeline_id,
                "connector_id": connector_id,
                "tenant_id": tenant_id,
                "attributes": attrs,
            })

        if events:
            # Chunk to 500 to stay under any payload limits
            for i in range(0, len(events), 500):
                req("POST", f"{EVENT_LOG_API}/events/batch",
                    headers=th(tenant_id), body={"events": events[i:i+500]})
            total_written += len(events)

        offset += n
        if len(records) < n:
            break

    return total_written


# ── Process definitions (cross-object) ────────────────────────────────────────

def create_processes(tenant_id: str, ot_name_to_id: dict[str, str]) -> int:
    specs = PROCESSES_TO_CREATE.get(tenant_id, [])
    if not specs:
        return 0
    existing = req("GET", f"{PROCESS_API}/process/processes?include_implicit=false",
                   headers=th(tenant_id))
    existing_names = {p["name"] for p in (existing or [])}
    created = 0
    for s in specs:
        if s["name"] in existing_names:
            continue
        ots = [ot_name_to_id[n] for n in s["object_type_names"] if n in ot_name_to_id]
        if len(ots) < 2:
            continue
        try:
            req("POST", f"{PROCESS_API}/process/processes",
                headers=th(tenant_id),
                body={
                    "name": s["name"],
                    "description": s["description"],
                    "case_key_attribute": s["case_key_attribute"],
                    "included_object_type_ids": ots,
                })
            created += 1
        except HttpError as e:
            print(f"  ! could not create process {s['name']}: {e}")
            continue
    return created


def backfill_processes(tenant_id: str) -> None:
    """For each defined process with a case_key_attribute, run backfill."""
    procs = req("GET", f"{PROCESS_API}/process/processes?include_implicit=false",
                headers=th(tenant_id))
    for p in procs or []:
        if not p.get("case_key_attribute"):
            continue
        try:
            r = req("POST", f"{PROCESS_API}/process/processes/{p['id']}/backfill",
                    headers=th(tenant_id), timeout=180)
            print(f"  backfill {p['name']}: {r['events_updated']} events updated, "
                  f"{r['cases_after']} cases")
        except HttpError as e:
            print(f"  ! backfill failed for {p['name']}: {e}")


# ── Main ──────────────────────────────────────────────────────────────────────

def seed_tenant(tenant_id: str, datasets: list[tuple[str, str, str]]) -> dict:
    print(f"\n┄┄ {tenant_id} ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄")
    ot_name_to_id: dict[str, str] = {}
    summary: dict[str, Any] = {"connectors": 0, "object_types": 0, "events": 0, "processes": 0}

    # Cross-object remap setup
    remap_cfg = CROSS_OBJECT_REMAP.get(tenant_id)
    anchor_keys: list[str] = []
    if remap_cfg:
        anchor_keys = fetch_anchor_keys(remap_cfg["anchor_dataset"], remap_cfg["anchor_field"])
        print(f"  ⌖ cross-object anchor: {remap_cfg['anchor_dataset']}.{remap_cfg['anchor_field']} "
              f"({len(anchor_keys)} unique keys)")

    for dataset_id, ot_name, _case_id_field in datasets:
        print(f"  ▸ {dataset_id} → {ot_name}")
        # Schema for inference
        try:
            schema = req("GET", f"{DEMO_API}/datasets/{dataset_id}/schema", timeout=60)
        except HttpError as e:
            print(f"    ! schema fetch failed: {e}")
            continue

        try:
            cid = get_or_create_connector(tenant_id, dataset_id, f"Demo · {dataset_id}")
            summary["connectors"] += 1
        except HttpError as e:
            print(f"    ! connector failed: {e}")
            continue

        try:
            otid = get_or_create_object_type(tenant_id, ot_name, dataset_id, cid, schema)
            ot_name_to_id[ot_name] = otid
            summary["object_types"] += 1
        except HttpError as e:
            print(f"    ! object type failed: {e}")
            continue

        # Event ingestion (skip non-event datasets like insurance-policies)
        remap = None
        if remap_cfg and dataset_id in remap_cfg["child_datasets"] and anchor_keys:
            remap = anchor_keys
        try:
            written = ingest_events(tenant_id, dataset_id, otid, cid, remap_to_anchor=remap)
            if written:
                summary["events"] += written
                tag = " (remapped to anchor)" if remap else ""
                print(f"    ingested {written} events{tag}")
        except HttpError as e:
            print(f"    ! event ingest failed: {e}")

    # Cross-object processes
    try:
        n = create_processes(tenant_id, ot_name_to_id)
        summary["processes"] = n
        if n:
            print(f"  ✓ {n} cross-object process(es) created — running backfill")
            backfill_processes(tenant_id)
    except HttpError as e:
        print(f"  ! process creation failed: {e}")

    print(f"  summary: {summary}")
    return summary


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", help="Run only one tenant (e.g. tenant-finance)")
    global RECORD_CAP_PER_DATASET
    ap.add_argument("--cap", type=int, default=RECORD_CAP_PER_DATASET,
                    help="Max records per dataset (default 5000)")
    args = ap.parse_args()
    RECORD_CAP_PER_DATASET = args.cap

    targets = TENANTS
    if args.tenant:
        if args.tenant not in TENANTS:
            print(f"Unknown tenant {args.tenant}. Choices: {list(TENANTS)}", file=sys.stderr)
            sys.exit(2)
        targets = {args.tenant: TENANTS[args.tenant]}

    t0 = time.time()
    grand: dict[str, int] = {"connectors": 0, "object_types": 0, "events": 0, "processes": 0}
    for tid, datasets in targets.items():
        s = seed_tenant(tid, datasets)
        for k, v in s.items():
            grand[k] = grand.get(k, 0) + v
    print(f"\n━━━ Done in {time.time() - t0:.1f}s ━━━")
    print(f"  total connectors: {grand['connectors']}")
    print(f"  total object types: {grand['object_types']}")
    print(f"  total events: {grand['events']}")
    print(f"  total processes: {grand['processes']}")


if __name__ == "__main__":
    main()
