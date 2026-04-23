import base64
import csv
import hashlib
import io
import json
import os
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Header, Query, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

from database import get_pool
from rate_limit import check_and_consume

router = APIRouter()

EVENT_LOG_URL = os.environ.get("EVENT_LOG_URL", "http://event-log-service:8005")

RESOURCE_SCOPES = {
    "records": ("read:records", "read:all"),
    "events": ("read:events", "read:all"),
}


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


async def _authenticate(request: Request, pool, required_scopes: tuple[str, ...]) -> dict:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing API key")
    raw_key = auth[7:]
    key_hash = _hash_key(raw_key)
    row = await pool.fetchrow(
        "SELECT * FROM api_keys WHERE key_hash = $1 AND enabled = TRUE", key_hash
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid or disabled API key")

    scopes = list(row["scopes"])
    if not any(s in scopes for s in required_scopes):
        raise HTTPException(status_code=403, detail=f"Missing scope. Required one of: {', '.join(required_scopes)}")

    ip_allow = list(row["ip_allowlist"] or [])
    if ip_allow:
        ip = _client_ip(request)
        if ip not in ip_allow:
            raise HTTPException(status_code=403, detail=f"IP {ip} not allowed for this key")

    allowed, remaining, reset_in = await check_and_consume(row["id"], row["rate_limit_per_min"])
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded",
            headers={"Retry-After": str(reset_in), "X-RateLimit-Remaining": "0"},
        )

    await pool.execute("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", row["id"])

    request.state.api_key = {
        "id": row["id"],
        "prefix": row["key_prefix"],
        "tenant_id": row["tenant_id"],
        "scopes": scopes,
    }
    request.state.rate_limit_remaining = remaining

    return {
        "tenant_id": row["tenant_id"],
        "scopes": scopes,
        "key_id": row["id"],
        "rate_remaining": remaining,
    }


# ── Management ────────────────────────────────────────────────────────────────


class EndpointCreate(BaseModel):
    object_type_id: str | None = None
    object_type_name: str
    slug: str
    resource_type: str = "records"  # "records" | "events"


@router.get("/manage")
async def list_endpoints(x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM api_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC",
        tenant_id,
    )
    return [dict(r) for r in rows]


@router.post("/manage", status_code=201)
async def create_endpoint(body: EndpointCreate, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    if body.resource_type not in ("records", "events"):
        raise HTTPException(status_code=400, detail="resource_type must be 'records' or 'events'")
    pool = await get_pool()
    ep_id = str(uuid4())
    try:
        await pool.execute(
            """
            INSERT INTO api_endpoints (id, tenant_id, object_type_id, object_type_name, slug, resource_type, enabled, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
            """,
            ep_id, tenant_id, body.object_type_id or "", body.object_type_name, body.slug, body.resource_type,
        )
    except Exception:
        raise HTTPException(status_code=409, detail="Slug already exists")
    return {"id": ep_id, "slug": body.slug, "object_type_id": body.object_type_id, "resource_type": body.resource_type}


@router.delete("/manage/{endpoint_id}", status_code=204)
async def delete_endpoint(endpoint_id: str, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM api_endpoints WHERE id = $1 AND tenant_id = $2", endpoint_id, tenant_id
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Endpoint not found")


# ── Public data API ──────────────────────────────────────────────────────────


def _rows_to_csv(rows: list[dict]) -> str:
    if not rows:
        return ""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    return buf.getvalue()


def _encode_cursor(created_at, row_id) -> str:
    raw = json.dumps({"c": created_at.isoformat(), "i": row_id})
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[str, str] | None:
    try:
        pad = "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(cursor + pad).decode()
        data = json.loads(raw)
        return data["c"], data["i"]
    except Exception:
        return None


@router.get("/v1/{slug}")
async def get_records(
    slug: str,
    request: Request,
    limit: int = Query(100, le=1000, ge=1),
    offset: int = Query(0, ge=0),
    cursor: str | None = Query(None),
    format: str = Query("json"),
):
    pool = await get_pool()
    auth = await _authenticate(request, pool, RESOURCE_SCOPES["records"])
    tenant_id = auth["tenant_id"]

    endpoint = await pool.fetchrow(
        "SELECT * FROM api_endpoints WHERE tenant_id = $1 AND slug = $2 AND enabled = TRUE",
        tenant_id, slug,
    )
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    if endpoint["resource_type"] == "events":
        return await _proxy_events(request, endpoint, limit, offset, format)

    # Filter params: ?filter[field]=value  (or ?filter.field=value for convenience)
    filters: dict[str, str] = {}
    for k, v in request.query_params.multi_items():
        if k.startswith("filter[") and k.endswith("]"):
            filters[k[7:-1]] = v
        elif k.startswith("filter."):
            filters[k[7:]] = v

    where_clauses = ["tenant_id = $1", "object_type_id = $2"]
    params: list = [tenant_id, endpoint["object_type_id"]]
    p_idx = 3

    for field, value in filters.items():
        if not field.replace("_", "").isalnum():
            raise HTTPException(status_code=400, detail=f"Invalid filter field: {field}")
        where_clauses.append(f"data->>${p_idx} = ${p_idx + 1}")
        params.extend([field, value])
        p_idx += 2

    cursor_clause = ""
    if cursor:
        decoded = _decode_cursor(cursor)
        if decoded:
            c_ts, c_id = decoded
            cursor_clause = f" AND (created_at, id) < (${p_idx}::timestamptz, ${p_idx + 1})"
            params.extend([c_ts, c_id])
            p_idx += 2

    sql = (
        f"SELECT id, source_id, data, created_at, updated_at FROM object_records "
        f"WHERE {' AND '.join(where_clauses)}{cursor_clause} "
        f"ORDER BY created_at DESC, id DESC LIMIT ${p_idx}"
    )
    params.append(limit)
    rows = await pool.fetch(sql, *params)

    total = None
    if not cursor:
        total = await pool.fetchval(
            f"SELECT COUNT(*) FROM object_records WHERE {' AND '.join(where_clauses)}",
            *params[: p_idx - 1],
        )

    records = [
        {
            "id": r["id"],
            "source_id": r["source_id"],
            **(json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]),
        }
        for r in rows
    ]

    next_cursor = None
    if rows and len(rows) == limit:
        last = rows[-1]
        next_cursor = _encode_cursor(last["created_at"], last["id"])

    if format == "csv":
        csv_body = _rows_to_csv(records)
        return Response(
            content=csv_body,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{slug}.csv"'},
        )

    return {
        "object_type": endpoint["object_type_name"],
        "slug": slug,
        "total": total,
        "limit": limit,
        "offset": offset,
        "next_cursor": next_cursor,
        "data": records,
    }


@router.get("/v1/{slug}/{record_id}")
async def get_record(slug: str, record_id: str, request: Request):
    pool = await get_pool()
    auth = await _authenticate(request, pool, RESOURCE_SCOPES["records"])
    tenant_id = auth["tenant_id"]

    endpoint = await pool.fetchrow(
        "SELECT * FROM api_endpoints WHERE tenant_id = $1 AND slug = $2 AND enabled = TRUE AND resource_type = 'records'",
        tenant_id, slug,
    )
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    row = await pool.fetchrow(
        "SELECT * FROM object_records WHERE id = $1 AND tenant_id = $2 AND object_type_id = $3",
        record_id, tenant_id, endpoint["object_type_id"],
    )
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")

    data = json.loads(row["data"]) if isinstance(row["data"], str) else row["data"]
    return {"id": row["id"], "source_id": row["source_id"], **data}


# ── Event log proxy ──────────────────────────────────────────────────────────


async def _proxy_events(request: Request, endpoint, limit: int, offset: int, format: str):
    params = {"limit": limit, "offset": offset}
    for k in ("since", "until", "activity", "case_id", "object_type_id"):
        v = request.query_params.get(k)
        if v:
            params[k] = v
    if endpoint["object_type_id"] and "object_type_id" not in params:
        params["object_type_id"] = endpoint["object_type_id"]

    headers = {"x-tenant-id": endpoint["tenant_id"]}

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.get(f"{EVENT_LOG_URL}/events", params=params, headers=headers)
        except httpx.RequestError:
            raise HTTPException(status_code=502, detail="Event log service unreachable")

    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Event log service error: {r.status_code}")

    data = r.json()
    events = data if isinstance(data, list) else data.get("events", data.get("data", []))

    if format == "csv":
        csv_body = _rows_to_csv(events)
        return Response(
            content=csv_body,
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{endpoint["slug"]}.csv"'},
        )

    return {
        "slug": endpoint["slug"],
        "resource_type": "events",
        "limit": limit,
        "offset": offset,
        "data": events,
    }


# ── OpenAPI per tenant ───────────────────────────────────────────────────────


@router.get("/v1/openapi.json")
async def tenant_openapi(x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT slug, object_type_name, resource_type FROM api_endpoints WHERE tenant_id = $1 AND enabled = TRUE ORDER BY slug",
        tenant_id,
    )

    paths: dict = {}
    for r in rows:
        base = f"/gateway/v1/{r['slug']}"
        if r["resource_type"] == "events":
            paths[base] = {
                "get": {
                    "summary": f"List events from {r['object_type_name']}",
                    "parameters": [
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 100}},
                        {"name": "since", "in": "query", "schema": {"type": "string", "format": "date-time"}},
                        {"name": "until", "in": "query", "schema": {"type": "string", "format": "date-time"}},
                        {"name": "activity", "in": "query", "schema": {"type": "string"}},
                        {"name": "case_id", "in": "query", "schema": {"type": "string"}},
                        {"name": "format", "in": "query", "schema": {"type": "string", "enum": ["json", "csv"]}},
                    ],
                    "security": [{"bearerAuth": []}],
                    "responses": {"200": {"description": "OK"}, "401": {"description": "Unauthorized"}, "429": {"description": "Rate limit exceeded"}},
                }
            }
        else:
            paths[base] = {
                "get": {
                    "summary": f"List {r['object_type_name']}",
                    "parameters": [
                        {"name": "limit", "in": "query", "schema": {"type": "integer", "default": 100}},
                        {"name": "cursor", "in": "query", "schema": {"type": "string"}},
                        {"name": "format", "in": "query", "schema": {"type": "string", "enum": ["json", "csv"]}},
                    ],
                    "security": [{"bearerAuth": []}],
                    "responses": {"200": {"description": "OK"}, "401": {"description": "Unauthorized"}, "429": {"description": "Rate limit exceeded"}},
                }
            }
            paths[f"{base}/{{id}}"] = {
                "get": {
                    "summary": f"Get a single {r['object_type_name']}",
                    "parameters": [{"name": "id", "in": "path", "required": True, "schema": {"type": "string"}}],
                    "security": [{"bearerAuth": []}],
                    "responses": {"200": {"description": "OK"}, "404": {"description": "Not found"}},
                }
            }

    return {
        "openapi": "3.1.0",
        "info": {"title": f"Nexus API — {tenant_id}", "version": "1.0.0"},
        "servers": [{"url": os.environ.get("API_PUBLIC_URL", "")}],
        "components": {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "nxk_"}
            }
        },
        "paths": paths,
    }
