import json
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
import asyncpg
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from database import get_pool

router = APIRouter()


def _row_to_dict(row: asyncpg.Record) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "slug": row["slug"],
        "plan": row["plan"],
        "status": row["status"],
        "allowed_modules": list(row["allowed_modules"]) if row["allowed_modules"] else [],
        "settings": json.loads(row["settings"]) if isinstance(row["settings"], str) else (row["settings"] or {}),
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


class TenantCreate(BaseModel):
    name: str
    slug: str
    plan: str = "free"
    allowed_modules: list[str] = []


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    plan: Optional[str] = None
    status: Optional[str] = None
    allowed_modules: Optional[list[str]] = None


@router.get("/tenants")
async def list_tenants():
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM tenants ORDER BY created_at DESC")
    return [_row_to_dict(r) for r in rows]


@router.post("/tenants", status_code=201)
async def create_tenant(body: TenantCreate):
    pool = await get_pool()
    tenant_id = f"tenant-{str(uuid4())[:8]}"
    try:
        row = await pool.fetchrow(
            """
            INSERT INTO tenants (id, name, slug, plan, status, allowed_modules)
            VALUES ($1, $2, $3, $4, 'active', $5)
            RETURNING *
            """,
            tenant_id, body.name, body.slug, body.plan, body.allowed_modules,
        )
    except Exception:
        raise HTTPException(status_code=409, detail="Slug already exists")
    return _row_to_dict(row)


@router.patch("/tenants/{tenant_id}")
async def update_tenant(tenant_id: str, body: TenantUpdate):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM tenants WHERE id = $1", tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Tenant not found")

    new_name = body.name if body.name is not None else row["name"]
    new_plan = body.plan if body.plan is not None else row["plan"]
    new_status = body.status if body.status is not None else row["status"]
    new_modules = body.allowed_modules if body.allowed_modules is not None else list(row["allowed_modules"])

    updated = await pool.fetchrow(
        """
        UPDATE tenants SET name=$1, plan=$2, status=$3, allowed_modules=$4, updated_at=NOW()
        WHERE id=$5 RETURNING *
        """,
        new_name, new_plan, new_status, new_modules, tenant_id,
    )
    return _row_to_dict(updated)


@router.delete("/tenants/{tenant_id}", status_code=204)
async def delete_tenant(tenant_id: str):
    if tenant_id == "tenant-001":
        raise HTTPException(status_code=400, detail="Cannot delete the default tenant")
    pool = await get_pool()
    result = await pool.execute("DELETE FROM tenants WHERE id = $1", tenant_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Tenant not found")


@router.get("/tenants/{tenant_id}/usage")
async def get_tenant_usage(tenant_id: str):
    """Cross-table usage statistics for a tenant."""
    pool = await get_pool()

    async def count(table: str, col: str = "tenant_id") -> int:
        val = await pool.fetchval(
            f"SELECT COUNT(*) FROM {table} WHERE {col} = $1", tenant_id
        )
        return val or 0

    # Run all counts in parallel
    import asyncio
    results = await asyncio.gather(
        count("object_types"),
        count("object_records"),
        count("pipelines"),
        count("pipeline_runs"),
        count("connectors"),
        count("agent_configs"),
        count("logic_functions"),
        count("comments"),
        count("api_keys"),
        return_exceptions=True,
    )

    labels = ["object_types", "records", "pipelines", "pipeline_runs", "connectors", "agents", "logic_functions", "comments", "api_keys"]
    usage = {}
    for label, val in zip(labels, results):
        usage[label] = val if isinstance(val, int) else 0

    return usage
