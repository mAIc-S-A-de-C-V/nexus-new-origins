"""
Seed the certification training tenant `tenant-learn` with the Ontology + sample
data needed for Course U1 (Nexus 101).

Creates:
  • Object types: Vendor, PurchaseOrder, LineItem (+ links)
  • Action defs:   addNote (on Vendor)
  • Sample records: 10 vendors, 30 POs, ~80 line items
  • Pre-existing Action history on each vendor (1 createVendor + 1 addNote)

Optionally provisions per-candidate exam subtenants with `--candidate <name>`,
which creates `tenant-learn-exam-<name>` seeded with a deterministic scenario
the grader can verify against.

Idempotent: re-runs match existing object types / records by name+tenant and
skip work that's already done.

Run:
    python3 scripts/seed_tenant_learn.py                          # shared learn tenant
    python3 scripts/seed_tenant_learn.py --candidate jose         # exam subtenant
    python3 scripts/seed_tenant_learn.py --candidate jose --exam  # locked exam fixture
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

ONTOLOGY_API = os.environ.get("ONTOLOGY_API", "http://localhost:8004")

LEARN_TENANT = "tenant-learn"
EXAM_TENANT_PREFIX = "tenant-learn-exam-"


# ── HTTP helper ──────────────────────────────────────────────────────────────

class HttpError(Exception):
    pass


def req(method: str, url: str, *, tenant: str, body: Any = None, timeout: int = 60) -> Any:
    h = {"Content-Type": "application/json", "x-tenant-id": tenant}
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw)
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", "replace")[:500]
        raise HttpError(f"{method} {url} → {e.code}: {body_txt}") from e


# ── Property + schema helpers ────────────────────────────────────────────────

def prop(name: str, sem: str, dtype: str, *,
         required: bool = False, display: str | None = None,
         pii: str = "NONE") -> dict:
    return {
        "id": str(uuid4()),
        "name": name,
        "display_name": display or name.replace("_", " ").title(),
        "semantic_type": sem,
        "data_type": dtype,
        "pii_level": pii,
        "required": required,
        "description": None,
        "sample_values": [],
    }


def get_or_create_ot(tenant: str, name: str, display: str, description: str,
                     properties: list[dict]) -> str:
    existing = req("GET", f"{ONTOLOGY_API}/object-types", tenant=tenant) or []
    for ot in existing:
        if ot.get("name") == name:
            return ot["id"]
    body = {
        "id": str(uuid4()),
        "name": name,
        "display_name": display,
        "description": description,
        "properties": properties,
        "source_connector_ids": [],
        "version": 1,
        "schema_health": "healthy",
        "tenant_id": tenant,
    }
    created = req("POST", f"{ONTOLOGY_API}/object-types", tenant=tenant, body=body)
    return created["id"]


def get_or_create_link(tenant: str, source_id: str, target_id: str, rel: str,
                       source_field: str, target_field: str, label: str) -> None:
    existing = req("GET", f"{ONTOLOGY_API}/object-types/links/all", tenant=tenant) or []
    for ln in existing:
        if (ln.get("source_object_type_id") == source_id
                and ln.get("target_object_type_id") == target_id
                and ln.get("relationship_type") == rel):
            return
    body = {
        "id": str(uuid4()),
        "source_object_type_id": source_id,
        "target_object_type_id": target_id,
        "relationship_type": rel,
        "join_keys": [{"source_field": source_field, "target_field": target_field}],
        "label": label,
        "is_inferred": False,
    }
    req("POST", f"{ONTOLOGY_API}/object-types/links", tenant=tenant, body=body)


# ── Schema definitions ───────────────────────────────────────────────────────

def seed_schema(tenant: str) -> dict[str, str]:
    print(f"\n=== Seeding schema in {tenant} ===")

    print("→ Vendor …", end=" ", flush=True)
    vendor_id = get_or_create_ot(
        tenant, "Vendor", "Vendor",
        "A supplier the org buys from.",
        [
            prop("id",         "IDENTIFIER", "string", required=True),
            prop("name",       "TEXT",       "string", required=True),
            prop("tier",       "CATEGORY",   "string"),       # preferred | standard | watch
            prop("status",     "STATUS",     "string"),       # active | inactive
            prop("address",    "ADDRESS",    "string"),
            prop("created_at", "DATETIME",   "datetime"),
        ],
    )
    print(vendor_id)

    print("→ PurchaseOrder …", end=" ", flush=True)
    po_id = get_or_create_ot(
        tenant, "PurchaseOrder", "Purchase Order",
        "A purchase order issued to a vendor.",
        [
            prop("id",         "IDENTIFIER", "string", required=True),
            prop("vendor_id",  "IDENTIFIER", "string", required=True),
            prop("status",     "STATUS",     "string"),       # draft | pending | approved | fulfilled
            prop("total",      "CURRENCY",   "float"),
            prop("created_at", "DATETIME",   "datetime"),
            prop("approved_at","DATETIME",   "datetime"),
        ],
    )
    print(po_id)

    print("→ LineItem …", end=" ", flush=True)
    li_id = get_or_create_ot(
        tenant, "LineItem", "Line Item",
        "A line on a purchase order.",
        [
            prop("id",          "IDENTIFIER", "string", required=True),
            prop("po_id",       "IDENTIFIER", "string", required=True),
            prop("description", "TEXT",       "string"),
            prop("quantity",    "QUANTITY",   "integer"),
            prop("unit_price",  "CURRENCY",   "float"),
            prop("line_total",  "CURRENCY",   "float"),
        ],
    )
    print(li_id)

    print("→ Links …", end=" ", flush=True)
    get_or_create_link(tenant, po_id, vendor_id, "BELONGS_TO",
                       "vendor_id", "id", "issued to")
    get_or_create_link(tenant, li_id, po_id, "BELONGS_TO",
                       "po_id", "id", "line of")
    print("ok")

    return {"Vendor": vendor_id, "PurchaseOrder": po_id, "LineItem": li_id}


# ── Action definitions ───────────────────────────────────────────────────────

def get_or_create_action(tenant: str, name: str, body: dict) -> None:
    existing = req("GET", f"{ONTOLOGY_API}/actions", tenant=tenant) or []
    for a in existing:
        if a.get("name") == name:
            return
    req("POST", f"{ONTOLOGY_API}/actions", tenant=tenant, body=body)


def seed_actions(tenant: str, ot_ids: dict[str, str]) -> None:
    print(f"\n=== Seeding actions in {tenant} ===")

    print("→ addNote …", end=" ", flush=True)
    get_or_create_action(tenant, "addNote", {
        "name": "addNote",
        "display_name": "Add Note",
        "description": "Attach a freeform note to a vendor.",
        "target_object_type_id": ot_ids["Vendor"],
        "input_schema": {
            "type": "object",
            "properties": {
                "vendor_id": {"type": "string", "x-required": True},
                "text":      {"type": "string", "x-required": True, "minLength": 1},
            },
        },
        "effects": [
            # The platform records the action in history; the note text is the payload.
            {"type": "log", "level": "info"},
        ],
        "requires_confirmation": False,
    })
    print("ok")


# ── Sample records ───────────────────────────────────────────────────────────

VENDOR_NAMES = [
    ("ACME Supply Co.",       "preferred"),
    ("Bayfront Logistics",    "preferred"),
    ("Cedar Industrial",      "standard"),
    ("Dynamo Components",     "standard"),
    ("Echo Materials Group",  "standard"),
    ("Fairway Equipment",     "watch"),
    ("Gateway Procurement",   "standard"),
    ("Harbor Tooling Inc.",   "preferred"),
    ("Ironside Hardware",     "standard"),
    ("Juniper Trading Co.",   "watch"),
]


def deterministic_id(*parts: str) -> str:
    h = hashlib.sha1("|".join(parts).encode()).hexdigest()[:12]
    return f"rec-{h}"


def seed_records(tenant: str, ot_ids: dict[str, str], *, exam: bool) -> None:
    """Seed 10 vendors, 30 POs, ~80 line items. Deterministic IDs by tenant."""
    print(f"\n=== Seeding records in {tenant} ===")
    now = datetime.now(timezone.utc)

    # Vendors
    vendors: list[dict] = []
    for i, (name, tier) in enumerate(VENDOR_NAMES):
        vendors.append({
            "id": deterministic_id(tenant, "vendor", str(i)),
            "name": name,
            "tier": tier,
            "status": "active",
            "address": f"{100 + i} Main St",
            "created_at": (now - timedelta(days=30 + i)).isoformat(),
        })

    print(f"→ Ingest {len(vendors)} vendors …", end=" ", flush=True)
    req("POST", f"{ONTOLOGY_API}/object-types/{ot_ids['Vendor']}/records/ingest",
        tenant=tenant,
        body={"records": vendors, "pk_field": "id", "pipeline_id": "seed-learn"})
    print("ok")

    # Purchase orders (3 per vendor — 30 total)
    pos: list[dict] = []
    line_items: list[dict] = []
    for vi, v in enumerate(vendors):
        for j in range(3):
            po_id = deterministic_id(tenant, "po", str(vi), str(j))
            status = ["draft", "pending", "approved"][j]
            created_offset = vi * 3 + j
            po = {
                "id": po_id,
                "vendor_id": v["id"],
                "status": status,
                "total": 0.0,
                "created_at": (now - timedelta(days=created_offset)).isoformat(),
                "approved_at": (
                    (now - timedelta(days=max(0, created_offset - 1))).isoformat()
                    if status == "approved" else None
                ),
            }
            # 2-3 line items per PO
            n_lines = 2 + (j % 2)
            po_total = 0.0
            for k in range(n_lines):
                qty = 1 + ((vi + j + k) % 5)
                unit = 25.0 + ((vi + j) * 11.5 + k * 3.0)
                total = round(qty * unit, 2)
                po_total += total
                line_items.append({
                    "id": deterministic_id(tenant, "li", po_id, str(k)),
                    "po_id": po_id,
                    "description": f"Widget Mk{k+1}",
                    "quantity": qty,
                    "unit_price": unit,
                    "line_total": total,
                })
            po["total"] = round(po_total, 2)
            pos.append(po)

    print(f"→ Ingest {len(pos)} purchase orders …", end=" ", flush=True)
    req("POST", f"{ONTOLOGY_API}/object-types/{ot_ids['PurchaseOrder']}/records/ingest",
        tenant=tenant,
        body={"records": pos, "pk_field": "id", "pipeline_id": "seed-learn"})
    print("ok")

    print(f"→ Ingest {len(line_items)} line items …", end=" ", flush=True)
    req("POST", f"{ONTOLOGY_API}/object-types/{ot_ids['LineItem']}/records/ingest",
        tenant=tenant,
        body={"records": line_items, "pk_field": "id", "pipeline_id": "seed-learn"})
    print("ok")

    # Pre-seed one addNote per vendor so Action history isn't empty when learners
    # first look at a record. Skip on exam tenants — those start clean.
    if not exam:
        print("→ Pre-seed one addNote on each vendor …", end=" ", flush=True)
        for v in vendors:
            try:
                req("POST", f"{ONTOLOGY_API}/actions/addNote/execute",
                    tenant=tenant,
                    body={"inputs": {"vendor_id": v["id"], "text": "Onboarded."}})
            except HttpError as e:
                # If the action exec endpoint changes shape, surface but don't crash.
                print(f"\n  (skipped {v['name']}: {e})", end="")
        print(" ok")

    if exam:
        # Lock down the exam fixture. The grader needs a known "third-most-recent PO".
        # The ingest above puts POs with monotonically-decreasing created_at, so the
        # 3rd-most-recent is well-defined.
        third_recent = sorted(pos, key=lambda p: p["created_at"], reverse=True)[2]
        vendor = next(v for v in vendors if v["id"] == third_recent["vendor_id"])
        marker = {
            "tenant": tenant,
            "po_id": third_recent["id"],
            "vendor_id": vendor["id"],
            "vendor_name": vendor["name"],
            "generated_at": now.isoformat(),
        }
        marker_path = f"/tmp/{tenant}.exam-fixture.json"
        with open(marker_path, "w") as f:
            json.dump(marker, f, indent=2)
        print(f"\nExam fixture written → {marker_path}")
        print(f"  third-most-recent PO: {third_recent['id']}")
        print(f"  on vendor:            {vendor['name']} ({vendor['id']})")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidate", help="Provision a personal/exam subtenant for this candidate")
    ap.add_argument("--exam", action="store_true",
                    help="When set with --candidate, seed a locked exam fixture (no pre-seeded notes)")
    args = ap.parse_args()

    if args.exam and not args.candidate:
        ap.error("--exam requires --candidate")

    if args.candidate:
        tenant = f"{EXAM_TENANT_PREFIX}{args.candidate}" if args.exam else f"{LEARN_TENANT}-{args.candidate}"
    else:
        tenant = LEARN_TENANT

    print(f"Tenant: {tenant}")
    ot_ids = seed_schema(tenant)
    seed_actions(tenant, ot_ids)
    seed_records(tenant, ot_ids, exam=bool(args.exam))

    print(f"\nDone. Tenant {tenant} is ready.")
    if args.exam:
        print(f"Hand the candidate their tenant ID: {tenant}")
        print(f"Grader fixture:                   /tmp/{tenant}.exam-fixture.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
