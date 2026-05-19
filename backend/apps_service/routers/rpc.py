"""
RPC gateway. The single egress point apps use to reach Nexus services.

Flow:
  1. App posts { requestId, method, args } via postMessage (browser host)
     OR an HTTP POST here (server-side functions).
  2. Host forwards as POST /apps/rpc with Authorization: Bearer <app-jwt>.
  3. Dispatcher:
       a. verifies JWT (signature, iss, aud=install_id, exp)
       b. looks up install row, refuses if disabled / version yanked
       c. determines required scope for method+target
       d. verifies scope is in install.scopes_granted
       e. checks rate limit
       f. forwards to target service with user session JWT + x-tenant-id
       g. writes one audit row per call
       h. returns response

If any step fails, response is {error: <code>, detail: <msg>} and audit row
captures the denial reason. The app cannot bypass.

Method map: see scopes.METHOD_SCOPES.
"""
from __future__ import annotations
import os
import time
import json
import uuid
import logging
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    ExternalAppInstallRow, ExternalAppVersionRow, ExternalAppKVRow, get_session,
)
import audit as audit_helper
import jwt_app
import rate_limit
import scopes as scopes_mod

router = APIRouter()
log = logging.getLogger("apps_service.rpc")

ONTOLOGY_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
AGENT_URL    = os.environ.get("AGENT_SERVICE_URL",    "http://agent-service:8013")
LOGIC_URL    = os.environ.get("LOGIC_SERVICE_URL",    "http://logic-service:8012")
EVENT_LOG_URL = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")

MAX_PAYLOAD_BYTES = int(os.environ.get("APPS_RPC_MAX_PAYLOAD", "1048576"))   # 1 MB
MAX_RESPONSE_BYTES = int(os.environ.get("APPS_RPC_MAX_RESPONSE", "5242880")) # 5 MB
MAX_KV_VALUE_BYTES = int(os.environ.get("APPS_KV_MAX_VALUE", "65536"))       # 64 KB
MAX_KV_TOTAL_BYTES = int(os.environ.get("APPS_KV_MAX_TOTAL", "10485760"))    # 10 MB / install


class RpcEnvelope(BaseModel):
    requestId: str
    method: str
    args: dict[str, Any] = {}


def _resp_json(request_id: str, ok: bool, **kw) -> dict:
    return {"requestId": request_id, "ok": ok, **kw}


async def _verify_token(authorization: str | None) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token")
    raw = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt_app.decode_app_token(raw, expected_install_id=None)
    except Exception as e:
        raise HTTPException(401, f"invalid app token: {e}")
    return payload


def _target_for_method(method: str, args: dict) -> str | None:
    """For *:*-style scopes, derive the concrete target (type/action/agent name)."""
    if method in ("ontology.get", "ontology.query"):
        return args.get("object_type")
    if method == "ontology.aggregate":
        return args.get("object_type")
    if method in ("ontology.create", "ontology.update", "ontology.delete"):
        return args.get("object_type")
    if method == "actions.propose":
        return args.get("action_name")
    if method == "agents.run":
        return args.get("agent_name")
    return None


async def _check_scope(payload: dict, install: ExternalAppInstallRow, method: str, args: dict) -> tuple[bool, str | None]:
    try:
        target = _target_for_method(method, args)
        required = scopes_mod.required_scope_for(method, target)
    except ValueError:
        return False, None
    if required is None:
        return True, None
    if not scopes_mod.scope_matches(required, install.scopes_granted or []):
        return False, required
    return True, required


# ── dispatcher implementations ───────────────────────────────────────────────


async def _do_ontology_list_types(payload: dict, args: dict) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{ONTOLOGY_URL}/object-types", headers={"x-tenant-id": payload["tenant_id"]})
        return r.json() if r.is_success else {"error": r.text}


async def _do_ontology_query(payload: dict, args: dict) -> Any:
    object_type = args.get("object_type")
    limit = int(args.get("limit", 50))
    offset = int(args.get("offset", 0))
    if not object_type:
        return {"error": "object_type required"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{ONTOLOGY_URL}/object-types", headers={"x-tenant-id": payload["tenant_id"]})
        ots = r.json() if r.is_success else []
        ot = next((o for o in ots if o.get("name") == object_type or o.get("displayName") == object_type), None)
        if not ot:
            return {"error": f"object_type '{object_type}' not found"}
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        for k in ("search", "filter", "order_by"):
            if k in args:
                params[k] = args[k]
        r2 = await client.get(
            f"{ONTOLOGY_URL}/object-types/{ot['id']}/records",
            params=params,
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        return r2.json() if r2.is_success else {"error": r2.text}


async def _do_ontology_get(payload: dict, args: dict) -> Any:
    object_type = args.get("object_type")
    record_id = args.get("record_id")
    if not object_type or not record_id:
        return {"error": "object_type + record_id required"}
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{ONTOLOGY_URL}/object-types", headers={"x-tenant-id": payload["tenant_id"]})
        ots = r.json() if r.is_success else []
        ot = next((o for o in ots if o.get("name") == object_type or o.get("displayName") == object_type), None)
        if not ot:
            return {"error": f"object_type '{object_type}' not found"}
        r2 = await client.get(
            f"{ONTOLOGY_URL}/object-types/{ot['id']}/records/{record_id}",
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        return r2.json() if r2.is_success else {"error": r2.text}


async def _do_ontology_aggregate(payload: dict, args: dict) -> Any:
    object_type = args.get("object_type")
    if not object_type:
        return {"error": "object_type required"}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(f"{ONTOLOGY_URL}/object-types", headers={"x-tenant-id": payload["tenant_id"]})
        ots = r.json() if r.is_success else []
        ot = next((o for o in ots if o.get("name") == object_type or o.get("displayName") == object_type), None)
        if not ot:
            return {"error": f"object_type '{object_type}' not found"}
        body = {k: v for k, v in args.items() if k != "object_type"}
        r2 = await client.post(
            f"{ONTOLOGY_URL}/object-types/{ot['id']}/aggregate",
            json=body, headers={"x-tenant-id": payload["tenant_id"]},
        )
        return r2.json() if r2.is_success else {"error": r2.text}


async def _resolve_object_type(client: httpx.AsyncClient, tenant_id: str, object_type: str) -> dict | None:
    """Look up an object type by display name or system name."""
    r = await client.get(f"{ONTOLOGY_URL}/object-types", headers={"x-tenant-id": tenant_id})
    if not r.is_success:
        return None
    ots = r.json() if r.is_success else []
    return next((o for o in ots if o.get("name") == object_type or o.get("displayName") == object_type), None)


async def _do_ontology_create(payload: dict, args: dict) -> Any:
    """Create (upsert) a single record. Uses the ontology service's bulk-ingest endpoint
    behind the scenes — apps don't see that detail. If `data.id` is present it becomes
    the record's source_id; otherwise the ontology service generates one."""
    object_type = args.get("object_type")
    data = args.get("data")
    if not object_type or not isinstance(data, dict):
        return {"error": "object_type + data (object) required"}
    pk_field = args.get("pk_field") or "id"
    async with httpx.AsyncClient(timeout=30) as client:
        ot = await _resolve_object_type(client, payload["tenant_id"], object_type)
        if not ot:
            return {"error": f"object_type '{object_type}' not found"}
        r = await client.post(
            f"{ONTOLOGY_URL}/object-types/{ot['id']}/records/ingest",
            json={
                "records": [data],
                "pk_field": pk_field,
                "pipeline_id": f"app:{payload['app_id']}",
            },
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        if not r.is_success:
            return {"error": r.text}
        body = r.json()
        # ingest returns counts + source_ids; flatten to a single-row response
        new_ids = body.get("new_source_ids") or []
        upd_ids = body.get("updated_source_ids") or []
        rid = (new_ids + upd_ids + [data.get(pk_field)])[0]
        return {"ok": True, "record_id": rid, "ingested": body.get("ingested", 0)}


async def _do_ontology_update(payload: dict, args: dict) -> Any:
    """Merge `fields` into an existing record's data. Errors if the record does not exist."""
    object_type = args.get("object_type")
    record_id = args.get("record_id")
    fields = args.get("fields")
    if not object_type or not record_id or not isinstance(fields, dict):
        return {"error": "object_type + record_id + fields (object) required"}
    async with httpx.AsyncClient(timeout=30) as client:
        ot = await _resolve_object_type(client, payload["tenant_id"], object_type)
        if not ot:
            return {"error": f"object_type '{object_type}' not found"}
        r = await client.patch(
            f"{ONTOLOGY_URL}/object-types/{ot['id']}/records/{record_id}",
            json=fields,
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        if not r.is_success:
            return {"error": r.text}
        return {"ok": True, "record_id": record_id}


async def _do_ontology_delete(payload: dict, args: dict) -> Any:
    object_type = args.get("object_type")
    record_id = args.get("record_id")
    if not object_type or not record_id:
        return {"error": "object_type + record_id required"}
    async with httpx.AsyncClient(timeout=30) as client:
        ot = await _resolve_object_type(client, payload["tenant_id"], object_type)
        if not ot:
            return {"error": f"object_type '{object_type}' not found"}
        r = await client.delete(
            f"{ONTOLOGY_URL}/object-types/{ot['id']}/records/{record_id}",
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        if not r.is_success and r.status_code != 404:
            return {"error": r.text}
        return {"ok": True, "record_id": record_id}


async def _do_actions_list(payload: dict, args: dict) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{ONTOLOGY_URL}/actions", headers={"x-tenant-id": payload["tenant_id"]})
        return r.json() if r.is_success else {"error": r.text}


async def _do_actions_propose(payload: dict, args: dict) -> Any:
    action_name = args.get("action_name")
    inputs = args.get("inputs") or {}
    reasoning = args.get("reasoning") or ""
    if not action_name:
        return {"error": "action_name required"}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{ONTOLOGY_URL}/actions/{action_name}/execute",
            json={
                "inputs": inputs,
                "executed_by": f"app:{payload['app_id']}",
                "source": "external_app",
                "source_id": payload["install_id"],
                "reasoning": reasoning,
            },
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        return r.json() if r.is_success else {"error": r.text}


async def _do_agents_list(payload: dict, args: dict) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(f"{AGENT_URL}/agents", headers={"x-tenant-id": payload["tenant_id"]})
        return r.json() if r.is_success else {"error": r.text}


async def _do_agents_run(payload: dict, args: dict) -> Any:
    agent_name = args.get("agent_name")
    inputs = args.get("inputs") or {}
    if not agent_name:
        return {"error": "agent_name required"}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(
            f"{AGENT_URL}/agents/{agent_name}/run",
            json={"inputs": inputs, "source": f"external_app:{payload['app_id']}"},
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        return r.json() if r.is_success else {"error": r.text}


async def _do_workflow_list_mine(payload: dict, args: dict) -> Any:
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(
            f"{ONTOLOGY_URL}/workflow/assignments",
            params={"user_id": payload["sub"]},
            headers={"x-tenant-id": payload["tenant_id"]},
        )
        return r.json() if r.is_success else {"error": r.text}


async def _do_kv_get(payload: dict, args: dict, db: AsyncSession) -> Any:
    key = args.get("key")
    scope = args.get("scope", "install")   # "install" or "user"
    if not key:
        return {"error": "key required"}
    uid = payload["sub"] if scope == "user" else None
    row = (await db.execute(select(ExternalAppKVRow).where(
        ExternalAppKVRow.install_id == payload["install_id"],
        ExternalAppKVRow.user_id.is_(uid) if uid is None else ExternalAppKVRow.user_id == uid,
        ExternalAppKVRow.key == key,
    ))).scalar_one_or_none()
    return {"value": row.value if row else None, "exists": row is not None}


async def _do_kv_set(payload: dict, args: dict, db: AsyncSession) -> Any:
    key = args.get("key")
    value = args.get("value")
    scope = args.get("scope", "install")
    if not key:
        return {"error": "key required"}
    blob = json.dumps(value, default=str)
    size = len(blob.encode("utf-8"))
    if size > MAX_KV_VALUE_BYTES:
        return {"error": f"value too large ({size} > {MAX_KV_VALUE_BYTES})"}

    uid = payload["sub"] if scope == "user" else None
    # Total per-install size budget
    from sqlalchemy import func as sa_func
    total = (await db.execute(
        select(sa_func.coalesce(sa_func.sum(ExternalAppKVRow.size_bytes), 0))
        .where(ExternalAppKVRow.install_id == payload["install_id"])
    )).scalar() or 0
    if total + size > MAX_KV_TOTAL_BYTES:
        return {"error": f"per-install KV quota exceeded ({total + size} > {MAX_KV_TOTAL_BYTES})"}

    row = (await db.execute(select(ExternalAppKVRow).where(
        ExternalAppKVRow.install_id == payload["install_id"],
        ExternalAppKVRow.user_id.is_(uid) if uid is None else ExternalAppKVRow.user_id == uid,
        ExternalAppKVRow.key == key,
    ))).scalar_one_or_none()
    if row:
        row.value = value
        row.size_bytes = size
    else:
        db.add(ExternalAppKVRow(
            id=str(uuid.uuid4()),
            install_id=payload["install_id"],
            user_id=uid,
            key=key,
            value=value,
            size_bytes=size,
        ))
    await db.commit()
    return {"ok": True, "size_bytes": size}


async def _do_kv_delete(payload: dict, args: dict, db: AsyncSession) -> Any:
    key = args.get("key")
    scope = args.get("scope", "install")
    if not key:
        return {"error": "key required"}
    uid = payload["sub"] if scope == "user" else None
    from sqlalchemy import delete as sa_delete
    await db.execute(sa_delete(ExternalAppKVRow).where(
        ExternalAppKVRow.install_id == payload["install_id"],
        ExternalAppKVRow.user_id.is_(uid) if uid is None else ExternalAppKVRow.user_id == uid,
        ExternalAppKVRow.key == key,
    ))
    await db.commit()
    return {"ok": True}


async def _do_kv_list(payload: dict, args: dict, db: AsyncSession) -> Any:
    scope = args.get("scope", "install")
    prefix = args.get("prefix") or ""
    uid = payload["sub"] if scope == "user" else None
    q = select(ExternalAppKVRow).where(
        ExternalAppKVRow.install_id == payload["install_id"],
        ExternalAppKVRow.user_id.is_(uid) if uid is None else ExternalAppKVRow.user_id == uid,
    )
    if prefix:
        q = q.where(ExternalAppKVRow.key.startswith(prefix))
    rows = (await db.execute(q)).scalars().all()
    return {"items": [{"key": r.key, "value": r.value, "updated_at": r.updated_at.isoformat()} for r in rows]}


async def _do_host_refresh(payload: dict, args: dict, db: AsyncSession) -> Any:
    install = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == payload["install_id"]
    ))).scalar_one_or_none()
    if not install or not install.enabled:
        return {"error": "install_disabled"}
    token, exp = jwt_app.mint_app_token(
        install_id=install.id, app_id=install.app_id, tenant_id=install.tenant_id,
        user_id=payload["sub"], user_email=payload.get("email", ""),
        user_role=payload.get("role", ""), scopes=install.scopes_granted,
        origin=payload["origin"],
    )
    return {"token": token, "expires_at": exp.isoformat()}


async def _do_host_config(payload: dict, args: dict, db: AsyncSession) -> Any:
    install = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == payload["install_id"]
    ))).scalar_one_or_none()
    if not install:
        return {"error": "install_not_found"}
    return {"config": install.config or {}}


async def _do_host_ping(payload: dict, args: dict, db: AsyncSession) -> dict:
    return {"pong": True, "now": time.time()}


DISPATCH = {
    "host.ping":           _do_host_ping,
    "host.refreshToken":   _do_host_refresh,
    "host.getConfig":      _do_host_config,
    "ontology.listTypes":  lambda p, a, d: _do_ontology_list_types(p, a),
    "ontology.query":      lambda p, a, d: _do_ontology_query(p, a),
    "ontology.get":        lambda p, a, d: _do_ontology_get(p, a),
    "ontology.aggregate":  lambda p, a, d: _do_ontology_aggregate(p, a),
    "ontology.create":     lambda p, a, d: _do_ontology_create(p, a),
    "ontology.update":     lambda p, a, d: _do_ontology_update(p, a),
    "ontology.delete":     lambda p, a, d: _do_ontology_delete(p, a),
    "actions.list":        lambda p, a, d: _do_actions_list(p, a),
    "actions.propose":     lambda p, a, d: _do_actions_propose(p, a),
    "agents.list":         lambda p, a, d: _do_agents_list(p, a),
    "agents.run":          lambda p, a, d: _do_agents_run(p, a),
    "workflow.listMine":   lambda p, a, d: _do_workflow_list_mine(p, a),
    "storage.kv.get":      _do_kv_get,
    "storage.kv.set":      _do_kv_set,
    "storage.kv.delete":   _do_kv_delete,
    "storage.kv.list":     _do_kv_list,
}


@router.post("/rpc")
async def rpc(
    envelope: RpcEnvelope,
    request: Request,
    authorization: str | None = Header(None),
    db: AsyncSession = Depends(get_session),
):
    t0 = time.monotonic()
    payload = await _verify_token(authorization)
    request_id = envelope.requestId
    method = envelope.method
    args = envelope.args or {}
    payload_size = len(json.dumps(args, default=str).encode("utf-8"))

    if payload_size > MAX_PAYLOAD_BYTES:
        return _resp_json(request_id, False, error="payload_too_large", size=payload_size)

    # Look up install, refuse if disabled or version yanked
    install = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == payload["install_id"]
    ))).scalar_one_or_none()
    if not install or install.tenant_id != payload["tenant_id"]:
        return _resp_json(request_id, False, error="install_unknown")
    if not install.enabled:
        await audit_helper.write_audit(
            db, tenant_id=install.tenant_id, install_id=install.id, app_id=install.app_id,
            user_id=payload["sub"], event_type="rpc.call", method=method, status="denied",
            error_message="install_disabled",
        )
        return _resp_json(request_id, False, error="install_disabled")

    version = (await db.execute(select(ExternalAppVersionRow).where(
        ExternalAppVersionRow.app_id == install.app_id,
        ExternalAppVersionRow.version == install.version_pinned,
    ))).scalar_one_or_none()
    if not version or version.yanked:
        return _resp_json(request_id, False, error="version_yanked")

    # Method exists?
    if method not in DISPATCH:
        await audit_helper.write_audit(
            db, tenant_id=install.tenant_id, install_id=install.id, app_id=install.app_id,
            user_id=payload["sub"], event_type="rpc.call", method=method, status="error",
            error_message="unknown_method", payload_size=payload_size,
        )
        return _resp_json(request_id, False, error="unknown_method", method=method)

    # Scope check
    ok, required_scope = await _check_scope(payload, install, method, args)
    if not ok:
        await audit_helper.write_audit(
            db, tenant_id=install.tenant_id, install_id=install.id, app_id=install.app_id,
            user_id=payload["sub"], event_type="rpc.call", method=method, status="denied",
            scope_used=required_scope, error_message="scope_denied", payload_size=payload_size,
        )
        return _resp_json(request_id, False, error="scope_denied", required_scope=required_scope)

    # Rate limit
    if not await rate_limit.check_rate(install.id):
        await audit_helper.write_audit(
            db, tenant_id=install.tenant_id, install_id=install.id, app_id=install.app_id,
            user_id=payload["sub"], event_type="rpc.call", method=method, status="denied",
            error_message="rate_limited", payload_size=payload_size,
        )
        return _resp_json(request_id, False, error="rate_limited")

    # Dispatch
    try:
        handler = DISPATCH[method]
        result = await handler(payload, args, db)
        resp_bytes = json.dumps(result, default=str).encode("utf-8")
        if len(resp_bytes) > MAX_RESPONSE_BYTES:
            return _resp_json(request_id, False, error="response_too_large", size=len(resp_bytes))
        latency = int((time.monotonic() - t0) * 1000)
        status = "ok" if not (isinstance(result, dict) and result.get("error")) else "error"
        await audit_helper.write_audit(
            db, tenant_id=install.tenant_id, install_id=install.id, app_id=install.app_id,
            user_id=payload["sub"], event_type="rpc.call", method=method, status=status,
            scope_used=required_scope, payload_size=payload_size, response_size=len(resp_bytes),
            latency_ms=latency,
            error_message=result.get("error") if isinstance(result, dict) else None,
        )
        return _resp_json(request_id, True, result=result, latency_ms=latency)
    except Exception as e:
        latency = int((time.monotonic() - t0) * 1000)
        log.exception(f"rpc dispatch error: {method}")
        await audit_helper.write_audit(
            db, tenant_id=install.tenant_id, install_id=install.id, app_id=install.app_id,
            user_id=payload["sub"], event_type="rpc.call", method=method, status="error",
            scope_used=required_scope, payload_size=payload_size, latency_ms=latency,
            error_message=str(e),
        )
        return _resp_json(request_id, False, error="internal_error", detail=str(e))


@router.get("/scopes/catalog")
async def scope_catalog():
    """Used by the admin install UI to render the scope-grant form."""
    return [{"name": s.name, "description": s.description, "sensitive": s.sensitive} for s in scopes_mod.CATALOG]
