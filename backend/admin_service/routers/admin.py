import json
import asyncio
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from database import get_pool
from shared.auth_middleware import require_auth, require_superadmin, AuthUser

router = APIRouter()

INTERNAL_SECRET = "nexus-internal"


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


class TokenUsageRecord(BaseModel):
    tenant_id: str
    service: str
    model: str = "unknown"
    input_tokens: int = 0
    output_tokens: int = 0
    user_id: Optional[str] = None


# ── Tenant CRUD (superadmin only) ────────────────────────────────────────────

@router.get("/tenants")
async def list_tenants(user: AuthUser = Depends(require_superadmin)):
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM tenants ORDER BY created_at DESC")
    return [_row_to_dict(r) for r in rows]


@router.post("/tenants", status_code=201)
async def create_tenant(body: TenantCreate, user: AuthUser = Depends(require_superadmin)):
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
async def update_tenant(tenant_id: str, body: TenantUpdate, user: AuthUser = Depends(require_superadmin)):
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
async def delete_tenant(tenant_id: str, user: AuthUser = Depends(require_superadmin)):
    if tenant_id == "tenant-001":
        raise HTTPException(status_code=400, detail="Cannot delete the default tenant")
    pool = await get_pool()
    result = await pool.execute("DELETE FROM tenants WHERE id = $1", tenant_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Tenant not found")


@router.get("/tenants/{tenant_id}/usage")
async def get_tenant_usage(tenant_id: str, user: AuthUser = Depends(require_superadmin)):
    """Cross-table usage statistics for a tenant, including LLM token consumption."""
    pool = await get_pool()

    async def count(table: str, col: str = "tenant_id") -> int:
        val = await pool.fetchval(
            f"SELECT COUNT(*) FROM {table} WHERE {col} = $1", tenant_id
        )
        return val or 0

    async def token_totals() -> dict:
        row = await pool.fetchrow(
            "SELECT COALESCE(SUM(input_tokens), 0) AS total_input, "
            "COALESCE(SUM(output_tokens), 0) AS total_output "
            "FROM token_usage WHERE tenant_id = $1",
            tenant_id,
        )
        return {"total_input_tokens": row["total_input"], "total_output_tokens": row["total_output"]}

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
        token_totals(),
        return_exceptions=True,
    )

    labels = ["object_types", "records", "pipelines", "pipeline_runs", "connectors",
              "agents", "logic_functions", "comments", "api_keys"]
    usage = {}
    for label, val in zip(labels, results[:9]):
        usage[label] = val if isinstance(val, int) else 0

    tokens = results[9] if isinstance(results[9], dict) else {"total_input_tokens": 0, "total_output_tokens": 0}
    usage.update(tokens)

    return usage


# ── Token Usage (service-to-service + superadmin query) ──────────────────────

@router.post("/token-usage", status_code=201)
async def record_token_usage(body: TokenUsageRecord, x_internal: Optional[str] = Header(None)):
    """Internal endpoint for services to report LLM token usage."""
    if x_internal != INTERNAL_SECRET:
        raise HTTPException(403, "Internal only")
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO token_usage (tenant_id, service, model, input_tokens, output_tokens, user_id) "
        "VALUES ($1, $2, $3, $4, $5, $6)",
        body.tenant_id, body.service, body.model, body.input_tokens, body.output_tokens, body.user_id,
    )
    return {"ok": True}


@router.get("/token-usage/summary")
async def token_usage_summary(
    tenant_id: Optional[str] = None,
    days: int = 30,
    user: AuthUser = Depends(require_superadmin),
):
    """Aggregated token usage for superadmin dashboard."""
    pool = await get_pool()

    # By tenant
    tenant_filter = "AND tenant_id = $2" if tenant_id else ""
    params_by_tenant: list = [days]
    if tenant_id:
        params_by_tenant.append(tenant_id)

    by_tenant = await pool.fetch(
        f"SELECT tenant_id, "
        f"SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
        f"COUNT(*) AS calls "
        f"FROM token_usage WHERE created_at > NOW() - ($1 || ' days')::interval {tenant_filter} "
        f"GROUP BY tenant_id ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC",
        *params_by_tenant,
    )

    by_service = await pool.fetch(
        f"SELECT service, "
        f"SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
        f"COUNT(*) AS calls "
        f"FROM token_usage WHERE created_at > NOW() - ($1 || ' days')::interval {tenant_filter} "
        f"GROUP BY service ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC",
        *params_by_tenant,
    )

    by_model = await pool.fetch(
        f"SELECT model, "
        f"SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
        f"COUNT(*) AS calls "
        f"FROM token_usage WHERE created_at > NOW() - ($1 || ' days')::interval {tenant_filter} "
        f"GROUP BY model ORDER BY (SUM(input_tokens) + SUM(output_tokens)) DESC",
        *params_by_tenant,
    )

    # Daily time series
    daily = await pool.fetch(
        f"SELECT DATE(created_at) AS day, "
        f"SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
        f"COUNT(*) AS calls "
        f"FROM token_usage WHERE created_at > NOW() - ($1 || ' days')::interval {tenant_filter} "
        f"GROUP BY DATE(created_at) ORDER BY day",
        *params_by_tenant,
    )

    def rows_to_list(rows):
        return [dict(r) for r in rows]

    return {
        "by_tenant": rows_to_list(by_tenant),
        "by_service": rows_to_list(by_service),
        "by_model": rows_to_list(by_model),
        "daily": [{"day": r["day"].isoformat(), "input_tokens": r["input_tokens"],
                    "output_tokens": r["output_tokens"], "calls": r["calls"]} for r in daily],
    }
