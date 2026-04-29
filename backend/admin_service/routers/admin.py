import json
import asyncio
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from database import get_pool, get_events_pool
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
        "bucket_tier": row["bucket_tier"] if "bucket_tier" in row.keys() else "S",
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
            "COALESCE(SUM(output_tokens), 0) AS total_output, "
            "COALESCE(SUM(input_tokens) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS month_input, "
            "COALESCE(SUM(output_tokens) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0) AS month_output "
            "FROM token_usage WHERE tenant_id = $1",
            tenant_id,
        )
        return {
            "total_input_tokens": row["total_input"],
            "total_output_tokens": row["total_output"],
            "month_input_tokens": row["month_input"],
            "month_output_tokens": row["month_output"],
        }

    async def agents_active_count() -> int:
        try:
            v = await pool.fetchval(
                "SELECT COUNT(*) FROM agent_configs WHERE tenant_id = $1 AND enabled = TRUE",
                tenant_id,
            )
            return int(v or 0)
        except Exception:
            return 0

    async def pipelines_running_count() -> int:
        try:
            v = await pool.fetchval(
                "SELECT COUNT(*) FROM pipeline_runs WHERE tenant_id = $1 AND status IN ('RUNNING','PENDING','QUEUED')",
                tenant_id,
            )
            return int(v or 0)
        except Exception:
            return 0

    async def events_count() -> int:
        events_pool = await get_events_pool()
        if not events_pool:
            return 0
        try:
            v = await events_pool.fetchval(
                "SELECT COUNT(*) FROM events WHERE tenant_id = $1", tenant_id
            )
            return int(v or 0)
        except Exception:
            return 0

    async def bucket_tier_for() -> str:
        row = await pool.fetchrow("SELECT bucket_tier FROM tenants WHERE id = $1", tenant_id)
        return row["bucket_tier"] if row else "S"

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
        agents_active_count(),
        pipelines_running_count(),
        events_count(),
        bucket_tier_for(),
        return_exceptions=True,
    )

    labels = ["object_types", "records", "pipelines", "pipeline_runs", "connectors",
              "agents", "logic_functions", "comments", "api_keys"]
    usage = {}
    for label, val in zip(labels, results[:9]):
        usage[label] = val if isinstance(val, int) else 0

    tokens = results[9] if isinstance(results[9], dict) else {
        "total_input_tokens": 0, "total_output_tokens": 0,
        "month_input_tokens": 0, "month_output_tokens": 0,
    }
    usage.update(tokens)

    usage["agents_active"]      = results[10] if isinstance(results[10], int) else 0
    usage["pipelines_running"]  = results[11] if isinstance(results[11], int) else 0
    usage["events"]             = results[12] if isinstance(results[12], int) else 0
    # Combined record count across both stores (Postgres + TimescaleDB).
    usage["records_combined"]   = (usage["records"] or 0) + usage["events"]
    usage["bucket_tier"]        = results[13] if isinstance(results[13], str) else "S"

    return usage


# ── Bucket tier (per-tenant subscription level) ─────────────────────────────

VALID_TIERS = {"S", "M", "L", "XL", "XXL"}


class BucketTierUpdate(BaseModel):
    bucket_tier: str


@router.get("/me/bucket")
async def my_bucket(user: AuthUser = Depends(require_auth)):
    """The caller's tenant bucket tier. Read-only for normal users."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT bucket_tier FROM tenants WHERE id = $1", user.tenant_id
    )
    return {"tenant_id": user.tenant_id, "bucket_tier": (row["bucket_tier"] if row else "S")}


@router.patch("/tenants/{tenant_id}/bucket")
async def update_tenant_bucket(
    tenant_id: str,
    body: BucketTierUpdate,
    user: AuthUser = Depends(require_superadmin),
):
    """Superadmin-only: change a tenant's bucket tier."""
    if body.bucket_tier not in VALID_TIERS:
        raise HTTPException(400, f"Invalid tier. Must be one of {sorted(VALID_TIERS)}")
    pool = await get_pool()
    res = await pool.execute(
        "UPDATE tenants SET bucket_tier = $1, updated_at = NOW() WHERE id = $2",
        body.bucket_tier, tenant_id,
    )
    if res.endswith("0"):
        raise HTTPException(404, "Tenant not found")
    return {"tenant_id": tenant_id, "bucket_tier": body.bucket_tier}


# ── Bedrock model catalog (enable/disable per tenant) ───────────────────────

# Tier → highest model class included. Enforced server-side.
# S: only Haiku-class & open-weight economic
# M: + Sonnet, Nova Pro, Mistral Small
# L: + Opus, DeepSeek, Mistral Large, Nova Premier, Llama 4 Scout
# XL: everything
# XXL: everything + Provisioned Throughput (no extra models, just guarantees)
TIER_RANK = {"S": 0, "M": 1, "L": 2, "XL": 3, "XXL": 4}

# Min tier required for each model (mirrors the catalog in the frontend)
MODEL_MIN_TIER = {
    # Anthropic
    "claude-haiku-4-5":      "S",
    "claude-sonnet-4-6":     "M",
    "claude-opus-4-7":       "L",
    # Amazon Nova
    "amazon-nova-micro":     "S",
    "amazon-nova-lite":      "S",
    "amazon-nova-pro":       "M",
    "amazon-nova-premier":   "L",
    # Meta Llama 4
    "llama-4-scout-fp8":     "S",   # open-weight, cheap
    "llama-4-maverick":      "L",
    # Mistral
    "mistral-small-3":       "S",
    "mistral-large-3":       "L",
    # DeepSeek
    "deepseek-v3-2":         "L",
}


def _model_allowed_for_tier(model_id: str, tier: str) -> bool:
    min_tier = MODEL_MIN_TIER.get(model_id, "XXL")  # unknown models = highest tier
    return TIER_RANK.get(tier, -1) >= TIER_RANK.get(min_tier, 999)


@router.get("/me/bedrock-models")
async def my_bedrock_models(user: AuthUser = Depends(require_auth)):
    """List all catalog models with their per-tenant status (enabled / available / restricted)."""
    pool = await get_pool()
    tier_row = await pool.fetchrow(
        "SELECT bucket_tier FROM tenants WHERE id = $1", user.tenant_id
    )
    tier = tier_row["bucket_tier"] if tier_row else "S"

    enabled_rows = await pool.fetch(
        "SELECT model_id FROM tenant_bedrock_models WHERE tenant_id = $1",
        user.tenant_id,
    )
    enabled_set = {r["model_id"] for r in enabled_rows}

    out = []
    for model_id, min_tier in MODEL_MIN_TIER.items():
        if model_id in enabled_set:
            status = "enabled"
        elif _model_allowed_for_tier(model_id, tier):
            status = "available"
        else:
            status = "restricted"
        out.append({"model_id": model_id, "status": status, "min_tier": min_tier})

    return {"tenant_id": user.tenant_id, "bucket_tier": tier, "models": out}


class ModelToggle(BaseModel):
    enabled: bool


@router.post("/me/bedrock-models/{model_id}")
async def toggle_my_bedrock_model(
    model_id: str,
    body: ModelToggle,
    user: AuthUser = Depends(require_auth),
):
    """Enable or disable a Bedrock model for the caller's tenant.
    Tenant admin role required to enable; anyone authed can read state.
    """
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(403, "Tenant admin required")

    if model_id not in MODEL_MIN_TIER:
        raise HTTPException(404, f"Unknown model: {model_id}")

    pool = await get_pool()
    tier_row = await pool.fetchrow(
        "SELECT bucket_tier FROM tenants WHERE id = $1", user.tenant_id
    )
    tier = tier_row["bucket_tier"] if tier_row else "S"

    if body.enabled:
        if not _model_allowed_for_tier(model_id, tier):
            raise HTTPException(
                403,
                f"Model {model_id} requires tier {MODEL_MIN_TIER[model_id]}+, "
                f"current bucket is {tier}. Ask superadmin to upgrade."
            )
        await pool.execute(
            "INSERT INTO tenant_bedrock_models (tenant_id, model_id, enabled_by) "
            "VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            user.tenant_id, model_id, user.email,
        )
    else:
        await pool.execute(
            "DELETE FROM tenant_bedrock_models WHERE tenant_id = $1 AND model_id = $2",
            user.tenant_id, model_id,
        )
    return {"model_id": model_id, "enabled": body.enabled, "tier": tier}


# ── Per-tenant consumption (caller's own tenant) ────────────────────────────

@router.get("/me/consumption")
async def my_consumption(user: AuthUser = Depends(require_auth)):
    """Live capacity utilization for the caller's tenant. Used by Settings → Consumption."""
    pool = await get_pool()
    tid = user.tenant_id

    today = await pool.fetchrow(
        "SELECT COALESCE(SUM(input_tokens),0) AS input_tokens, "
        "COALESCE(SUM(output_tokens),0) AS output_tokens, "
        "COUNT(*) AS calls "
        "FROM token_usage WHERE tenant_id = $1 AND created_at >= date_trunc('day', NOW())",
        tid,
    )
    month = await pool.fetchrow(
        "SELECT COALESCE(SUM(input_tokens),0) AS input_tokens, "
        "COALESCE(SUM(output_tokens),0) AS output_tokens, "
        "COUNT(*) AS calls "
        "FROM token_usage WHERE tenant_id = $1 AND created_at >= date_trunc('month', NOW())",
        tid,
    )
    daily_rows = await pool.fetch(
        "SELECT DATE(created_at) AS day, "
        "SUM(input_tokens) + SUM(output_tokens) AS tokens, "
        "COUNT(*) AS calls "
        "FROM token_usage WHERE tenant_id = $1 AND created_at > NOW() - INTERVAL '30 days' "
        "GROUP BY DATE(created_at) ORDER BY day",
        tid,
    )

    async def safe_count(sql: str) -> int:
        try:
            v = await pool.fetchval(sql, tid)
            return int(v or 0)
        except Exception:
            return 0

    (
        records, agents_total, agents_enabled,
        pipelines_total, pipelines_running,
        storage_bytes, concurrent_actors_60s, distinct_users_today,
    ) = await asyncio.gather(
        safe_count("SELECT COUNT(*) FROM object_records WHERE tenant_id = $1"),
        safe_count("SELECT COUNT(*) FROM agent_configs WHERE tenant_id = $1"),
        safe_count("SELECT COUNT(*) FROM agent_configs WHERE tenant_id = $1 AND enabled = TRUE"),
        safe_count("SELECT COUNT(*) FROM pipelines WHERE tenant_id = $1"),
        safe_count("SELECT COUNT(*) FROM pipeline_runs WHERE tenant_id = $1 AND status IN ('RUNNING','PENDING','QUEUED')"),
        # Real per-tenant storage from row payload byte sizes (object_records is the dominant table)
        safe_count("SELECT COALESCE(SUM(pg_column_size(data))::bigint, 0) FROM object_records WHERE tenant_id = $1"),
        # Distinct actors in audit log over the last 60 seconds = concurrent users
        safe_count("SELECT COUNT(DISTINCT actor_id) FROM audit_events WHERE tenant_id = $1 AND occurred_at > NOW() - INTERVAL '60 seconds'"),
        # Distinct actors active today = total daily active users
        safe_count("SELECT COUNT(DISTINCT actor_id) FROM audit_events WHERE tenant_id = $1 AND occurred_at >= date_trunc('day', NOW())"),
    )

    bucket_row = await pool.fetchrow("SELECT bucket_tier FROM tenants WHERE id = $1", tid)
    bucket_tier = bucket_row["bucket_tier"] if bucket_row else "S"

    # DB connection count is process-wide (pg_stat_activity), not tenant-scoped.
    try:
        db_active = await pool.fetchval(
            "SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database() AND state IS NOT NULL"
        ) or 0
    except Exception:
        db_active = 0

    # Vector store / RAG: the platform doesn't ship one. Report null so the UI
    # can render "Not configured" instead of a fake bar.
    rag_corpus_bytes = None

    # Events live in TimescaleDB (separate database). They're emitted by pipelines
    # and process-mining flows and dwarf object_records in volume. Count them too.
    events_count = 0
    events_bytes = 0
    events_pool = await get_events_pool()
    if events_pool:
        try:
            events_count = await events_pool.fetchval(
                "SELECT COUNT(*) FROM events WHERE tenant_id = $1", tid
            ) or 0
            events_bytes = await events_pool.fetchval(
                "SELECT COALESCE(SUM(pg_column_size(attributes))::bigint, 0) FROM events WHERE tenant_id = $1", tid
            ) or 0
        except Exception:
            pass

    total_records = (records or 0) + int(events_count or 0)
    total_storage_bytes = int(storage_bytes or 0) + int(events_bytes or 0)

    return {
        "tenant_id": tid,
        "bucket_tier": bucket_tier,
        "tokens_today": int(today["input_tokens"] + today["output_tokens"]),
        "tokens_today_input": int(today["input_tokens"]),
        "tokens_today_output": int(today["output_tokens"]),
        "invocations_today": int(today["calls"]),
        "tokens_month": int(month["input_tokens"] + month["output_tokens"]),
        "tokens_month_input": int(month["input_tokens"]),
        "tokens_month_output": int(month["output_tokens"]),
        "invocations_month": int(month["calls"]),
        "daily_history": [
            {"day": r["day"].isoformat(), "tokens": int(r["tokens"] or 0), "calls": int(r["calls"] or 0)}
            for r in daily_rows
        ],
        # Combined record/storage totals across object_records (Postgres) + events (TimescaleDB).
        "ontology_records": int(total_records),
        "ontology_records_breakdown": {
            "object_records": int(records or 0),
            "events": int(events_count or 0),
        },
        "storage_bytes": int(total_storage_bytes),
        "storage_breakdown": {
            "object_records_bytes": int(storage_bytes or 0),
            "events_bytes": int(events_bytes or 0),
        },
        "agents_total": agents_total,
        "agents_active": agents_enabled,
        "pipelines_total": pipelines_total,
        "pipelines_running": pipelines_running,
        "concurrent_users": int(concurrent_actors_60s or 0),
        "daily_active_users": int(distinct_users_today or 0),
        "rag_corpus_bytes": rag_corpus_bytes,            # null = not configured on this deployment
        "db_connections_process": int(db_active or 0),   # process-wide, not tenant-scoped
    }


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
    params_by_tenant: list = [str(days)]
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


# ── Platform-wide usage summary ──────────────────────────────────────────────

import os
import httpx

EVENT_LOG_URL = os.environ.get("EVENT_LOG_URL", "http://event-log-service:8005")


async def _safe_scalar(pool, sql, *args, default=0):
    try:
        val = await pool.fetchval(sql, *args)
        return val if val is not None else default
    except Exception:
        return default


async def _safe_fetchrow(pool, sql, *args, default=None):
    try:
        row = await pool.fetchrow(sql, *args)
        return dict(row) if row else (default or {})
    except Exception:
        return default or {}


async def _event_log_count(tenant_id: Optional[str], days: int) -> int:
    """Count events in the given range via event-log-service HTTP (TimescaleDB lives there)."""
    headers = {}
    if tenant_id:
        headers["x-tenant-id"] = tenant_id
    params = {"limit": 1, "since_days": days}
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{EVENT_LOG_URL}/events/timeseries/summary", params=params, headers=headers)
            if r.status_code == 200:
                data = r.json()
                return int(data.get("total") or data.get("count") or 0)
    except Exception:
        pass
    # Fallback: ask for any recent events to confirm service is reachable
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(f"{EVENT_LOG_URL}/events", params={"limit": 1}, headers=headers)
            if r.status_code == 200:
                payload = r.json()
                if isinstance(payload, dict):
                    return int(payload.get("total") or 0)
    except Exception:
        pass
    return 0


@router.get("/platform-usage/summary")
async def platform_usage_summary(
    tenant_id: Optional[str] = None,
    days: int = 30,
    user: AuthUser = Depends(require_superadmin),
):
    """Aggregated platform-wide activity for the superadmin dashboard."""
    pool = await get_pool()
    tf = f"AND tenant_id = '{tenant_id}'" if tenant_id and tenant_id.replace("-", "").replace("_", "").isalnum() else ""
    days_int = int(days)

    # Fan out all queries in parallel
    (
        llm_totals,
        gw_totals, gw_by_key, active_keys_total, api_keys_total,
        pipeline_totals, pipeline_recent,
        records_count, records_bytes,
        agent_totals,
        logic_totals,
        correlation_total,
        logins_total,
        events_count,
    ) = await asyncio.gather(
        _safe_fetchrow(pool, f"""
            SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,
                   COALESCE(SUM(output_tokens),0) AS output_tokens,
                   COUNT(*) AS calls
            FROM token_usage
            WHERE created_at > NOW() - ($1 || ' days')::interval {tf}
        """, str(days_int)),

        _safe_fetchrow(pool, f"""
            SELECT COUNT(*) AS calls,
                   COUNT(*) FILTER (WHERE status_code >= 400) AS errors,
                   COALESCE(SUM(bytes_out),0) AS bytes_out,
                   COALESCE(AVG(duration_ms),0)::int AS avg_ms,
                   COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms),0)::int AS p95_ms
            FROM api_key_usage_log
            WHERE ts > NOW() - ($1 || ' days')::interval {tf}
        """, str(days_int)),

        _safe_scalar(pool, f"""
            SELECT COUNT(DISTINCT key_id) FROM api_key_usage_log
            WHERE ts > NOW() - ($1 || ' days')::interval {tf}
        """, str(days_int)),

        _safe_scalar(pool, f"""
            SELECT COUNT(*) FROM api_keys WHERE enabled = TRUE AND last_used_at > NOW() - ($1 || ' days')::interval {tf}
        """, str(days_int)),

        _safe_scalar(pool, f"SELECT COUNT(*) FROM api_keys WHERE enabled = TRUE {tf}"),

        _safe_fetchrow(pool, f"""
            SELECT COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE status IN ('FAILED','ERROR')) AS errors,
                   COALESCE(SUM(rows_out),0) AS rows_out,
                   COALESCE(SUM(rows_in),0) AS rows_in,
                   COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))*1000),0)::int AS avg_ms,
                   COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))*1000),0)::int AS p95_ms
            FROM pipeline_runs
            WHERE started_at > NOW() - ($1 || ' days')::interval AND finished_at IS NOT NULL {tf}
        """, str(days_int)),

        _safe_scalar(pool, f"""
            SELECT COUNT(*) FROM pipeline_runs
            WHERE status = 'RUNNING' {tf}
        """),

        _safe_scalar(pool, f"SELECT COUNT(*) FROM object_records WHERE 1=1 {tf}"),

        _safe_scalar(pool, f"""
            SELECT COALESCE(SUM(pg_column_size(data)),0) FROM object_records
            WHERE 1=1 {tf}
        """),

        _safe_fetchrow(pool, f"""
            SELECT COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE error IS NOT NULL) AS errors,
                   COALESCE(SUM(iterations),0) AS iterations,
                   COALESCE(SUM(final_text_len),0) AS chars_out
            FROM agent_runs
            WHERE created_at > NOW() - ($1 || ' days')::interval {tf}
        """, str(days_int)),

        _safe_fetchrow(pool, f"""
            SELECT COUNT(*) AS runs,
                   COUNT(*) FILTER (WHERE status IN ('FAILED','ERROR')) AS errors,
                   COALESCE(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))*1000),0)::int AS avg_ms,
                   COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (finished_at - started_at))*1000),0)::int AS p95_ms
            FROM logic_runs
            WHERE started_at > NOW() - ($1 || ' days')::interval AND finished_at IS NOT NULL {tf}
        """, str(days_int)),

        _safe_scalar(pool, f"""
            SELECT COUNT(*) FROM audit_events
            WHERE created_at > NOW() - ($1 || ' days')::interval
              AND (activity ILIKE '%correlat%' OR action ILIKE '%correlat%') {tf}
        """, str(days_int)),

        _safe_scalar(pool, f"""
            SELECT COUNT(*) FROM audit_events
            WHERE created_at > NOW() - ($1 || ' days')::interval
              AND (activity ILIKE '%login%' OR action ILIKE '%login%') {tf}
        """, str(days_int)),

        _event_log_count(tenant_id, days_int),
    )

    return {
        "range_days": days_int,
        "tenant_id": tenant_id,
        "llm": {
            "input_tokens": int(llm_totals.get("input_tokens", 0)),
            "output_tokens": int(llm_totals.get("output_tokens", 0)),
            "calls": int(llm_totals.get("calls", 0)),
        },
        "gateway": {
            "calls": int(gw_totals.get("calls", 0)),
            "errors": int(gw_totals.get("errors", 0)),
            "bytes_out": int(gw_totals.get("bytes_out", 0)),
            "avg_ms": int(gw_totals.get("avg_ms", 0)),
            "p95_ms": int(gw_totals.get("p95_ms", 0)),
            "active_keys": int(gw_by_key),
            "keys_used_in_window": int(active_keys_total),
            "keys_total": int(api_keys_total),
        },
        "pipelines": {
            "runs": int(pipeline_totals.get("runs", 0)),
            "errors": int(pipeline_totals.get("errors", 0)),
            "rows_in": int(pipeline_totals.get("rows_in", 0)),
            "rows_out": int(pipeline_totals.get("rows_out", 0)),
            "avg_ms": int(pipeline_totals.get("avg_ms", 0)),
            "p95_ms": int(pipeline_totals.get("p95_ms", 0)),
            "currently_running": int(pipeline_recent),
        },
        "records": {
            "total": int(records_count),
            "bytes": int(records_bytes),
        },
        "agents": {
            "runs": int(agent_totals.get("runs", 0)),
            "errors": int(agent_totals.get("errors", 0)),
            "iterations": int(agent_totals.get("iterations", 0)),
            "chars_out": int(agent_totals.get("chars_out", 0)),
        },
        "logic": {
            "runs": int(logic_totals.get("runs", 0)),
            "errors": int(logic_totals.get("errors", 0)),
            "avg_ms": int(logic_totals.get("avg_ms", 0)),
            "p95_ms": int(logic_totals.get("p95_ms", 0)),
        },
        "correlation_scans": int(correlation_total),
        "logins": int(logins_total),
        "events": int(events_count),
    }
