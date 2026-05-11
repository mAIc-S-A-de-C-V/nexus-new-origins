"""
End-to-end smoke test. Runs entirely against the live apps-service.

Steps:
  1.  Build a synthetic bundle (zip of one index.html) and publish it
  2.  Install the synthetic app for tenant-001
  3.  Issue an app-context JWT
  4.  Call host.ping       (no scope) → expect ok
  5.  Call storage.kv.set  (scope granted) → expect ok
  6.  Call storage.kv.get  (scope granted) → expect prior value
  7.  Call ontology.listTypes (scope granted) → expect ok
  8.  Call actions.propose with no actions:propose scope granted → expect scope_denied
  9.  Run the server-side function manually → expect ok
  10. Read install audit log, verify per-call rows
  11. Uninstall

Run:  python backend/apps_service/smoke_test.py http://localhost:8028
"""
from __future__ import annotations
import io
import json
import os
import sys
import tarfile
import time
import uuid

import httpx

APPS_URL = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("NEXUS_APPS_URL", "http://localhost:8028")
TENANT   = os.environ.get("NEXUS_TENANT_ID", "tenant-001")
TOKEN    = os.environ.get("NEXUS_TOKEN", "")


def H(json_body=False) -> dict[str, str]:
    h = {"x-tenant-id": TENANT}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    if json_body:
        h["Content-Type"] = "application/json"
    return h


def must(ok: bool, msg: str):
    if not ok:
        print(f"  ✖ {msg}")
        sys.exit(1)
    print(f"  ✓ {msg}")


def make_synthetic_bundle() -> bytes:
    """Tarball with one index.html (apps_service insists on this file)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        html = b"<!doctype html><meta charset=utf-8><title>smoke</title><body>ok</body>"
        info = tarfile.TarInfo("index.html")
        info.size = len(html)
        tar.addfile(info, io.BytesIO(html))
    return buf.getvalue()


def main():
    app_id = f"smoke-{uuid.uuid4().hex[:8]}"
    version = "1.0.0"
    print(f"target apps-service: {APPS_URL}")
    print(f"app_id:              {app_id}")
    client = httpx.Client(timeout=30)

    # ── 1. publish ──
    manifest = {
        "id": app_id,
        "version": version,
        "publisher_id": "smoke-publisher",
        "display_name": "Smoke Test App",
        "description": "Auto-published by smoke_test.py",
        "entry": f"{APPS_URL}/apps/bundles/{app_id}/{version}/index.html",
        "scopes": [
            "ontology:list_types",
            "storage:kv:read", "storage:kv:write",
            "host:refresh", "host:config:read",
        ],
        "surfaces": [{"type": "page", "title": "Smoke", "icon": "wrench"}],
        "functions": [
            {
                "name": "echo",
                "trigger": {"type": "schedule", "cron": "0 0 31 2 *"},   # never fires
                "timeout_ms": 5000,
                "code": (
                    "async def handler(nexus, inputs, event):\n"
                    "    await nexus.kv_set('echoed_at', datetime.datetime.utcnow().isoformat())\n"
                    "    return {'echo': inputs}\n"
                ),
            }
        ],
        "event_subscriptions": [],
    }
    files = {
        "manifest_json": (None, json.dumps(manifest)),
        "bundle": (f"{app_id}.tar.gz", make_synthetic_bundle(), "application/gzip"),
    }
    r = client.post(f"{APPS_URL}/app-registry/publish", files=files, headers=H())
    must(r.status_code == 200, f"publish (got {r.status_code} {r.text[:200]})")
    sha = r.json()["sha256"]
    print(f"    sha256={sha}")

    # ── 2. install ──
    r = client.post(
        f"{APPS_URL}/app-installs",
        json={
            "app_id": app_id,
            "version": version,
            "scopes_granted": [
                "ontology:list_types", "storage:kv:read", "storage:kv:write",
                "host:refresh", "host:config:read",
            ],   # deliberately NOT granting actions:propose:*
            "config": {"hello": "world"},
        },
        headers=H(json_body=True),
    )
    must(r.status_code == 201, f"install (got {r.status_code} {r.text[:200]})")
    install_id = r.json()["id"]
    print(f"    install_id={install_id}")

    # ── 3. mint token ──
    r = client.post(f"{APPS_URL}/app-installs/{install_id}/token", headers=H(json_body=True), json={})
    must(r.status_code == 200, "token issuance")
    app_token = r.json()["token"]

    def rpc(method: str, args: dict | None = None) -> dict:
        rid = str(uuid.uuid4())
        rr = client.post(
            f"{APPS_URL}/apps/rpc",
            json={"requestId": rid, "method": method, "args": args or {}},
            headers={"Authorization": f"Bearer {app_token}"},
        )
        return rr.json()

    # ── 4. host.ping ──
    p = rpc("host.ping")
    must(p["ok"] and p["result"]["pong"] is True, "host.ping ok")

    # ── 5/6. kv set/get ──
    r1 = rpc("storage.kv.set", {"key": "test", "value": {"hi": True, "n": 42}})
    must(r1["ok"], "kv.set ok")
    r2 = rpc("storage.kv.get", {"key": "test"})
    must(r2["ok"] and r2["result"]["value"]["n"] == 42, "kv.get returns prior value")

    # ── 7. ontology.listTypes ──
    r3 = rpc("ontology.listTypes")
    must(r3["ok"], f"ontology.listTypes ok ({len(r3.get('result', []))} types)")

    # ── 8. scope deny path ──
    r4 = rpc("actions.propose", {"action_name": "anything", "inputs": {}})
    must((not r4["ok"]) and r4.get("error") == "scope_denied", "actions.propose denied")
    print(f"    required_scope reported: {r4.get('required_scope')}")

    # ── 9. server-side function ──
    fns = client.get(f"{APPS_URL}/apps/functions?install_id={install_id}", headers=H()).json()
    must(len(fns) == 1 and fns[0]["function_name"] == "echo", "function registered")
    fid = fns[0]["id"]
    rr = client.post(f"{APPS_URL}/apps/functions/{fid}/run", headers=H(json_body=True), json={"inputs": {"hello": "fn"}})
    must(rr.status_code == 200, "manual fn run kicked off")
    run_id = rr.json()["run_id"]
    # Wait briefly for completion
    final = None
    for _ in range(20):
        time.sleep(0.25)
        final = client.get(f"{APPS_URL}/apps/functions/runs/{run_id}", headers=H()).json()
        if final["status"] != "running":
            break
    must(final and final["status"] == "ok", f"fn run completed (status={final and final['status']})")
    print(f"    output: {final['output']}")

    # ── 10. audit ──
    audit = client.get(f"{APPS_URL}/app-installs/{install_id}/audit", headers=H()).json()
    rpc_rows = [r for r in audit if r["event_type"] == "rpc.call"]
    must(len(rpc_rows) >= 4, f"audit has rpc rows ({len(rpc_rows)})")
    denied = [r for r in rpc_rows if r["status"] == "denied"]
    must(any(r["method"] == "actions.propose" for r in denied), "audit captured scope_denied path")

    # ── 11. uninstall ──
    r = client.delete(f"{APPS_URL}/app-installs/{install_id}", headers=H())
    must(r.status_code == 204, "uninstall ok")

    print("\n✓ all smoke checks passed.")


if __name__ == "__main__":
    main()
