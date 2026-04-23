import hashlib
import secrets
from typing import Optional
from uuid import uuid4

import asyncpg
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from database import get_pool

router = APIRouter()


VALID_SCOPES = {"read:records", "read:events", "read:all"}


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
        "rate_limit_per_min": row["rate_limit_per_min"],
        "ip_allowlist": list(row["ip_allowlist"] or []),
        "last_used_at": row["last_used_at"].isoformat() if row["last_used_at"] else None,
        "created_at": row["created_at"].isoformat(),
    }


def _validate_scopes(scopes: list[str]) -> list[str]:
    if not scopes:
        return ["read:records"]
    normalized = ["read:records" if s == "read" else s for s in scopes]
    bad = [s for s in normalized if s not in VALID_SCOPES]
    if bad:
        raise HTTPException(status_code=400, detail=f"Invalid scope(s): {bad}. Allowed: {sorted(VALID_SCOPES)}")
    return normalized


class KeyCreate(BaseModel):
    name: str
    scopes: list[str] = ["read:records"]
    rate_limit_per_min: int = 60
    ip_allowlist: list[str] = []


class KeyUpdate(BaseModel):
    name: str | None = None
    scopes: list[str] | None = None
    rate_limit_per_min: int | None = None
    ip_allowlist: list[str] | None = None


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
    scopes = _validate_scopes(body.scopes)
    pool = await get_pool()
    raw = f"nxk_{secrets.token_urlsafe(32)}"
    key_hash = _hash_key(raw)
    key_prefix = raw[:12]
    key_id = str(uuid4())
    await pool.execute(
        """
        INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, enabled, rate_limit_per_min, ip_allowlist, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, NOW())
        """,
        key_id, tenant_id, body.name, key_hash, key_prefix, scopes, body.rate_limit_per_min, body.ip_allowlist,
    )
    return {
        "id": key_id,
        "key": raw,
        "key_prefix": key_prefix,
        "name": body.name,
        "scopes": scopes,
        "rate_limit_per_min": body.rate_limit_per_min,
        "ip_allowlist": body.ip_allowlist,
    }


@router.patch("/{key_id}")
async def update_key(key_id: str, body: KeyUpdate, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM api_keys WHERE id = $1 AND tenant_id = $2", key_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Key not found")

    sets: list[str] = []
    params: list = []
    idx = 1
    if body.name is not None:
        sets.append(f"name = ${idx}"); params.append(body.name); idx += 1
    if body.scopes is not None:
        sets.append(f"scopes = ${idx}"); params.append(_validate_scopes(body.scopes)); idx += 1
    if body.rate_limit_per_min is not None:
        sets.append(f"rate_limit_per_min = ${idx}"); params.append(body.rate_limit_per_min); idx += 1
    if body.ip_allowlist is not None:
        sets.append(f"ip_allowlist = ${idx}"); params.append(body.ip_allowlist); idx += 1

    if not sets:
        return _row_to_dict(row)

    params.extend([key_id, tenant_id])
    await pool.execute(
        f"UPDATE api_keys SET {', '.join(sets)} WHERE id = ${idx} AND tenant_id = ${idx + 1}",
        *params,
    )
    updated = await pool.fetchrow("SELECT * FROM api_keys WHERE id = $1", key_id)
    return _row_to_dict(updated)


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
