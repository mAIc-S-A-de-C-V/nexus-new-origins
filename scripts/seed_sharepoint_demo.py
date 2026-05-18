"""
Seed a SharePoint connector with synthetic data (demoMode=true).

Creates:
  • A SHAREPOINT connector named "SharePoint (Demo)" in the target tenant
  • SharePointFile + SharePointFolder object types in the ontology
  • Demo files/folders ingested into those object types (the same tree that
    sharepoint_connector._DEMO_TREE serves through the API)

Idempotent. Re-running upserts on (tenant, name).

Run:
    python3 scripts/seed_sharepoint_demo.py                       # default tenant-001
    TENANT=tenant-learn python3 scripts/seed_sharepoint_demo.py   # specific tenant
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any
from uuid import uuid4

CONNECTOR_API = os.environ.get("CONNECTOR_API", "http://localhost:8001")
ONTOLOGY_API = os.environ.get("ONTOLOGY_API", "http://localhost:8004")
TENANT = os.environ.get("TENANT", "tenant-001")

CONNECTOR_NAME = "SharePoint (Demo)"


# ── HTTP helper ──────────────────────────────────────────────────────────────

def req(method: str, url: str, *, body: Any = None, tenant: str = TENANT) -> Any:
    h = {"Content-Type": "application/json", "x-tenant-id": tenant}
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        txt = e.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"{method} {url} → {e.code}: {txt}") from e


# ── Connector ────────────────────────────────────────────────────────────────

def upsert_connector() -> str:
    existing = req("GET", f"{CONNECTOR_API}/connectors") or []
    for c in existing:
        if c.get("name") == CONNECTOR_NAME and c.get("type") == "SHAREPOINT":
            return c["id"]
    body = {
        "name": CONNECTOR_NAME,
        "type": "SHAREPOINT",
        "category": "Doc",
        "description": "Synthetic SharePoint site for testing the linker app and pipelines without a real Azure tenant.",
        "auth_type": "None",
        "credentials": {},
        "config": {"demoMode": True, "max_items": 5000},
        "tags": ["doc", "sharepoint", "demo"],
        "visibility": "tenant",
    }
    created = req("POST", f"{CONNECTOR_API}/connectors", body=body)
    return created["id"]


# ── Ontology ─────────────────────────────────────────────────────────────────

def prop(name: str, sem: str, dtype: str, *,
         required: bool = False, pii: str = "NONE") -> dict:
    return {
        "id": str(uuid4()),
        "name": name,
        "display_name": name.replace("_", " ").title(),
        "semantic_type": sem,
        "data_type": dtype,
        "pii_level": pii,
        "required": required,
        "description": None,
        "sample_values": [],
    }


def upsert_object_type(name: str, display: str, description: str,
                       properties: list[dict], connector_id: str) -> str:
    existing = req("GET", f"{ONTOLOGY_API}/object-types") or []
    for ot in existing:
        if ot.get("name") == name:
            return ot["id"]
    body = {
        "id": str(uuid4()),
        "name": name,
        "display_name": display,
        "description": description,
        "properties": properties,
        "source_connector_ids": [connector_id],
        "version": 1,
        "schema_health": "healthy",
        "tenant_id": TENANT,
    }
    created = req("POST", f"{ONTOLOGY_API}/object-types", body=body)
    return created["id"]


def upsert_link(source_id: str, target_id: str) -> None:
    existing = req("GET", f"{ONTOLOGY_API}/object-types/links/all") or []
    for ln in existing:
        if (ln.get("source_object_type_id") == source_id
                and ln.get("target_object_type_id") == target_id
                and ln.get("relationship_type") == "BELONGS_TO"):
            return
    req("POST", f"{ONTOLOGY_API}/object-types/links", body={
        "id": str(uuid4()),
        "source_object_type_id": source_id,
        "target_object_type_id": target_id,
        "relationship_type": "BELONGS_TO",
        "join_keys": [{"source_field": "parent_id", "target_field": "id"}],
        "label": "inside",
        "is_inferred": False,
    })


# ── Mirror demo tree from sharepoint_connector module ────────────────────────

def fetch_demo_tree_via_api(connector_id: str) -> dict:
    """Pull the same demo tree the running connector serves, via /items."""
    # Site → drive → tree
    sites = req("GET", f"{CONNECTOR_API}/connectors/{connector_id}/sharepoint/sites").get("sites", [])
    if not sites:
        raise RuntimeError("No demo sites returned — is the connector-service running with the new code?")
    site = sites[0]
    drives = req("GET",
                 f"{CONNECTOR_API}/connectors/{connector_id}/sharepoint/drives?site_id={site['id']}"
                 ).get("drives", [])
    if not drives:
        raise RuntimeError("Demo drive missing")
    drive = drives[0]

    all_files: list[dict] = []
    all_folders: list[dict] = []
    queue: list[str | None] = [None]  # root
    visited: set[str] = set()
    while queue:
        fid = queue.pop(0)
        key = fid or "root"
        if key in visited:
            continue
        visited.add(key)
        url = (f"{CONNECTOR_API}/connectors/{connector_id}/sharepoint/items"
               f"?drive_id={drive['id']}")
        if fid:
            url += f"&folder_id={fid}"
        page = req("GET", url)
        all_folders.extend(page.get("folders", []))
        all_files.extend(page.get("files", []))
        for sub in page.get("folders", []):
            queue.append(sub["id"])
    return {"site": site, "drive": drive, "folders": all_folders, "files": all_files}


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    print(f"Tenant: {TENANT}")
    print(f"Connector API: {CONNECTOR_API}")
    print(f"Ontology API:  {ONTOLOGY_API}")
    print()

    print("→ Upsert SharePoint connector …", end=" ", flush=True)
    cid = upsert_connector()
    print(cid)

    print("→ Pull demo tree via API …", end=" ", flush=True)
    tree = fetch_demo_tree_via_api(cid)
    print(f"{len(tree['folders'])} folders, {len(tree['files'])} files")

    print("→ Upsert SharePointFolder object type …", end=" ", flush=True)
    folder_ot = upsert_object_type(
        "SharePointFolder", "SharePoint Folder",
        "A folder in a SharePoint document library.",
        [
            prop("id",            "IDENTIFIER", "string", required=True),
            prop("name",          "TEXT",       "string", required=True),
            prop("parent_id",     "IDENTIFIER", "string"),
            prop("drive_id",      "IDENTIFIER", "string", required=True),
            prop("path",          "TEXT",       "string"),
            prop("item_count",    "QUANTITY",   "integer"),
            prop("last_modified", "DATETIME",   "datetime"),
            prop("web_url",       "TEXT",       "string"),
        ],
        cid,
    )
    print(folder_ot)

    print("→ Upsert SharePointFile object type …", end=" ", flush=True)
    file_ot = upsert_object_type(
        "SharePointFile", "SharePoint File",
        "A file in a SharePoint document library.",
        [
            prop("id",            "IDENTIFIER", "string", required=True),
            prop("name",          "TEXT",       "string", required=True),
            prop("parent_id",     "IDENTIFIER", "string"),
            prop("drive_id",      "IDENTIFIER", "string", required=True),
            prop("path",          "TEXT",       "string"),
            prop("size",          "QUANTITY",   "integer"),
            prop("mime_type",     "TEXT",       "string"),
            prop("last_modified", "DATETIME",   "datetime"),
            prop("created_at",    "DATETIME",   "datetime"),
            prop("web_url",       "TEXT",       "string"),
            prop("etag",          "TEXT",       "string"),
        ],
        cid,
    )
    print(file_ot)

    print("→ Link SharePointFile → SharePointFolder …", end=" ", flush=True)
    upsert_link(file_ot, folder_ot)
    print("ok")
    print("→ Link SharePointFolder → SharePointFolder (parent) …", end=" ", flush=True)
    upsert_link(folder_ot, folder_ot)
    print("ok")

    print("→ Ingest folders …", end=" ", flush=True)
    req("POST", f"{ONTOLOGY_API}/object-types/{folder_ot}/records/ingest",
        body={"records": tree["folders"], "pk_field": "id", "pipeline_id": "seed-sharepoint-demo"})
    print(f"{len(tree['folders'])} ok")

    print("→ Ingest files …", end=" ", flush=True)
    req("POST", f"{ONTOLOGY_API}/object-types/{file_ot}/records/ingest",
        body={"records": tree["files"], "pk_field": "id", "pipeline_id": "seed-sharepoint-demo"})
    print(f"{len(tree['files'])} ok")

    print()
    print("Done.")
    print(f"  Connector:        {CONNECTOR_NAME} ({cid})")
    print(f"  Demo site:        {tree['site']['display_name']}")
    print(f"  Demo drive:       {tree['drive']['name']}")
    print(f"  Folders ingested: {len(tree['folders'])}")
    print(f"  Files ingested:   {len(tree['files'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
