import hashlib
import secrets
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
import asyncpg
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from database import get_pool

router = APIRouter()


def _hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _row_to_dict(row: asyncpg.Record) -> dict:
    return {
        "id": row["id"],
        "tenant_id": row["tenant_id"],
        "name": row["name"],
        "key_prefix": row["key_prefix"],
        "scopes": list(row["scopes"]),
        "enabled": row["enabled"],
        "last_used_at": row["last_used_at"].isoformat() if row["last_used_at"] else None,
        "created_at": row["created_at"].isoformat(),
    }


class KeyCreate(BaseModel):
    name: str
    scopes: list[str] = ["read"]


@router.get("")
async def list_keys(x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM api_keys WHERE tenant_id = $1 ORDER BY created_at DESC",
        tenant_id,
    )
    return [_row_to_dict(r) for r in rows]


@router.post("", status_code=201)
async def create_key(body: KeyCreate, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    raw = f"nxk_{secrets.token_urlsafe(32)}"
    key_hash = _hash_key(raw)
    key_prefix = raw[:12]
    key_id = str(uuid4())
    await pool.execute(
        """
        INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, enabled, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
        """,
        key_id, tenant_id, body.name, key_hash, key_prefix, body.scopes,
    )
    # Return the raw key ONCE — never stored again
    return {"id": key_id, "key": raw, "key_prefix": key_prefix, "name": body.name, "scopes": body.scopes}


@router.delete("/{key_id}", status_code=204)
async def delete_key(key_id: str, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    result = await pool.execute(
        "DELETE FROM api_keys WHERE id = $1 AND tenant_id = $2", key_id, tenant_id
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Key not found")


@router.patch("/{key_id}/toggle")
async def toggle_key(key_id: str, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    row = await pool.fetchrow("SELECT enabled FROM api_keys WHERE id = $1 AND tenant_id = $2", key_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")
    new_val = not row["enabled"]
    await pool.execute("UPDATE api_keys SET enabled = $1 WHERE id = $2", new_val, key_id)
    return {"enabled": new_val}
