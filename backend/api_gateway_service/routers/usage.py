from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Query
from database import get_pool

router = APIRouter()


def _parse_range(r: str) -> str:
    mapping = {"24h": "1 day", "7d": "7 days", "30d": "30 days", "90d": "90 days"}
    return mapping.get(r, "7 days")


@router.get("/summary")
async def usage_summary(
    x_tenant_id: Optional[str] = Header(None),
    range: str = Query("7d"),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    interval = _parse_range(range)

    totals = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*) AS calls,
            COUNT(*) FILTER (WHERE status_code >= 400) AS errors,
            COALESCE(SUM(bytes_out), 0) AS bytes_out,
            COALESCE(AVG(duration_ms), 0)::int AS avg_ms,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms
        FROM api_key_usage_log
        WHERE tenant_id = $1 AND ts > NOW() - INTERVAL '{interval}'
        """,
        tenant_id,
    )

    by_key = await pool.fetch(
        f"""
        SELECT
            COALESCE(u.key_id, '-') AS key_id,
            COALESCE(u.key_prefix, '-') AS key_prefix,
            COALESCE(k.name, 'unknown') AS name,
            COUNT(*) AS calls,
            COUNT(*) FILTER (WHERE u.status_code >= 400) AS errors,
            MAX(u.ts) AS last_call
        FROM api_key_usage_log u
        LEFT JOIN api_keys k ON k.id = u.key_id
        WHERE u.tenant_id = $1 AND u.ts > NOW() - INTERVAL '{interval}'
        GROUP BY u.key_id, u.key_prefix, k.name
        ORDER BY calls DESC
        LIMIT 100
        """,
        tenant_id,
    )

    by_endpoint = await pool.fetch(
        f"""
        SELECT
            endpoint_slug,
            resource_type,
            COUNT(*) AS calls,
            COUNT(*) FILTER (WHERE status_code >= 400) AS errors,
            COALESCE(AVG(duration_ms), 0)::int AS avg_ms,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms
        FROM api_key_usage_log
        WHERE tenant_id = $1 AND endpoint_slug IS NOT NULL AND ts > NOW() - INTERVAL '{interval}'
        GROUP BY endpoint_slug, resource_type
        ORDER BY calls DESC
        LIMIT 100
        """,
        tenant_id,
    )

    timeseries = await pool.fetch(
        f"""
        SELECT
            date_trunc('hour', ts) AS bucket,
            COUNT(*) AS calls,
            COUNT(*) FILTER (WHERE status_code >= 400) AS errors
        FROM api_key_usage_log
        WHERE tenant_id = $1 AND ts > NOW() - INTERVAL '{interval}'
        GROUP BY bucket ORDER BY bucket
        """,
        tenant_id,
    )

    return {
        "range": range,
        "totals": dict(totals) if totals else {},
        "by_key": [dict(r) for r in by_key],
        "by_endpoint": [dict(r) for r in by_endpoint],
        "timeseries": [
            {"bucket": r["bucket"].isoformat(), "calls": r["calls"], "errors": r["errors"]}
            for r in timeseries
        ],
    }


@router.get("/keys/{key_id}")
async def key_usage(
    key_id: str,
    x_tenant_id: Optional[str] = Header(None),
    range: str = Query("7d"),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    interval = _parse_range(range)

    key_row = await pool.fetchrow(
        "SELECT id, name, key_prefix, scopes, enabled FROM api_keys WHERE id = $1 AND tenant_id = $2",
        key_id, tenant_id,
    )
    if not key_row:
        raise HTTPException(status_code=404, detail="Key not found")

    totals = await pool.fetchrow(
        f"""
        SELECT
            COUNT(*) AS calls,
            COUNT(*) FILTER (WHERE status_code >= 400) AS errors,
            COALESCE(SUM(bytes_out), 0) AS bytes_out,
            COALESCE(AVG(duration_ms), 0)::int AS avg_ms,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS p95_ms
        FROM api_key_usage_log
        WHERE tenant_id = $1 AND key_id = $2 AND ts > NOW() - INTERVAL '{interval}'
        """,
        tenant_id, key_id,
    )

    by_endpoint = await pool.fetch(
        f"""
        SELECT endpoint_slug, COUNT(*) AS calls,
            COUNT(*) FILTER (WHERE status_code >= 400) AS errors,
            COALESCE(AVG(duration_ms), 0)::int AS avg_ms
        FROM api_key_usage_log
        WHERE tenant_id = $1 AND key_id = $2 AND ts > NOW() - INTERVAL '{interval}'
        GROUP BY endpoint_slug ORDER BY calls DESC
        """,
        tenant_id, key_id,
    )

    recent = await pool.fetch(
        """
        SELECT method, path, status_code, duration_ms, bytes_out, client_ip, error, ts
        FROM api_key_usage_log
        WHERE tenant_id = $1 AND key_id = $2
        ORDER BY ts DESC LIMIT 50
        """,
        tenant_id, key_id,
    )

    return {
        "key": dict(key_row),
        "range": range,
        "totals": dict(totals) if totals else {},
        "by_endpoint": [dict(r) for r in by_endpoint],
        "recent_calls": [
            {**dict(r), "ts": r["ts"].isoformat()} for r in recent
        ],
    }
