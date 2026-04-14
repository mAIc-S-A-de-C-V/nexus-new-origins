import hashlib
import json
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Query, Request
from pydantic import BaseModel
from database import get_pool

router = APIRouter()


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def _authenticate(request: Request, pool) -> dict:
    """Validate Bearer API key from Authorization header."""
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
    # Update last_used_at
    await pool.execute("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", row["id"])
    return {"tenant_id": row["tenant_id"], "scopes": list(row["scopes"]), "key_id": row["id"]}


class EndpointCreate(BaseModel):
    object_type_id: str
    object_type_name: str
    slug: str


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
    pool = await get_pool()
    ep_id = str(uuid4())
    try:
        await pool.execute(
            """
            INSERT INTO api_endpoints (id, tenant_id, object_type_id, object_type_name, slug, enabled, created_at)
            VALUES ($1, $2, $3, $4, $5, TRUE, NOW())
            """,
            ep_id, tenant_id, body.object_type_id, body.object_type_name, body.slug,
        )
    except Exception:
        raise HTTPException(status_code=409, detail="Slug already exists")
    return {"id": ep_id, "slug": body.slug, "object_type_id": body.object_type_id}


@router.delete("/manage/{endpoint_id}", status_code=204)
async def delete_endpoint(endpoint_id: str, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM api_endpoints WHERE id = $1 AND tenant_id = $2", endpoint_id, tenant_id
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Endpoint not found")


# ── Public API endpoints (authenticated via Bearer key) ──────────────────────

@router.get("/v1/{slug}")
async def get_records(
    slug: str,
    request: Request,
    limit: int = Query(100, le=1000),
    offset: int = Query(0, ge=0),
):
    """Public API: list records for a published object type."""
    pool = await get_pool()
    auth = await _authenticate(request, pool)
    tenant_id = auth["tenant_id"]

    endpoint = await pool.fetchrow(
        "SELECT * FROM api_endpoints WHERE tenant_id = $1 AND slug = $2 AND enabled = TRUE",
        tenant_id, slug,
    )
    if not endpoint:
        raise HTTPException(status_code=404, detail="Endpoint not found")

    rows = await pool.fetch(
        """
        SELECT id, source_id, data, created_at, updated_at
        FROM object_records
        WHERE tenant_id = $1 AND object_type_id = $2
        ORDER BY created_at DESC
        LIMIT $3 OFFSET $4
        """,
        tenant_id, endpoint["object_type_id"], limit, offset,
    )
    total = await pool.fetchval(
        "SELECT COUNT(*) FROM object_records WHERE tenant_id = $1 AND object_type_id = $2",
        tenant_id, endpoint["object_type_id"],
    )
    return {
        "object_type": endpoint["object_type_name"],
        "slug": slug,
        "total": total,
        "limit": limit,
        "offset": offset,
        "data": [
            {
                "id": r["id"],
                "source_id": r["source_id"],
                **(json.loads(r["data"]) if isinstance(r["data"], str) else r["data"]),
            }
            for r in rows
        ],
    }


@router.get("/v1/{slug}/{record_id}")
async def get_record(slug: str, record_id: str, request: Request):
    """Public API: get a single record by id."""
    pool = await get_pool()
    auth = await _authenticate(request, pool)
    tenant_id = auth["tenant_id"]

    endpoint = await pool.fetchrow(
        "SELECT * FROM api_endpoints WHERE tenant_id = $1 AND slug = $2 AND enabled = TRUE",
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
