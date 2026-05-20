"""
Reads from the TimescaleDB events hypertable. Used by event-sequence
discoverers (association_rules, sequence_mining), survival outcomes, and
the ts_anomaly family.
"""
from sqlalchemy import text
from database import TsSession


_SYSTEM_EXCL = (
    "AND activity NOT IN ("
    "'PIPELINE_RUN_STARTED','PIPELINE_RUN_COMPLETED','PIPELINE_RUN_FAILED',"
    "'PIPELINE_COMPLETED','PIPELINE_FAILED',"
    "'CONNECTOR_SCHEMA_FETCHED','CONNECTOR_TEST_PASSED','CONNECTOR_TEST_FAILED',"
    "'RECORD_SYNCED'"
    ")"
)


async def fetch_events_for_ot(tenant_id: str, object_type_id: str,
                              days: int | None = None,
                              limit: int | None = None) -> list[dict]:
    """Returns events for one object type, ordered by case_id, timestamp.
    Each event dict has: case_id, activity, timestamp, attributes."""
    sql = (
        "SELECT case_id, activity, timestamp, attributes, object_id, cost "
        "FROM events "
        "WHERE tenant_id = :t AND object_type_id = :o "
        + _SYSTEM_EXCL
    )
    params = {"t": tenant_id, "o": object_type_id}
    if days:
        sql += " AND timestamp >= NOW() - (:d || ' days')::INTERVAL"
        params["d"] = days
    sql += " ORDER BY case_id, timestamp"
    if limit:
        sql += " LIMIT :lim"
        params["lim"] = int(limit)
    async with TsSession() as ts:
        rows = await ts.execute(text(sql), params)
        out = []
        for r in rows.fetchall():
            out.append({
                "case_id": r._mapping["case_id"],
                "activity": r._mapping["activity"],
                "timestamp": r._mapping["timestamp"],
                "attributes": r._mapping["attributes"] or {},
                "object_id": r._mapping["object_id"],
                "cost": r._mapping["cost"],
            })
        return out


async def case_spans(tenant_id: str, object_type_id: str,
                     days: int | None = None) -> list[dict]:
    """Per-case [{case_id, first_ts, last_ts, hours, n_events, activities[]}]."""
    sql = (
        "SELECT case_id, "
        "       MIN(timestamp) AS first_ts, MAX(timestamp) AS last_ts, "
        "       EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 3600 AS hours, "
        "       COUNT(*) AS n_events, "
        "       ARRAY_AGG(activity ORDER BY timestamp) AS activities "
        "FROM events "
        "WHERE tenant_id = :t AND object_type_id = :o "
        + _SYSTEM_EXCL
    )
    params = {"t": tenant_id, "o": object_type_id}
    if days:
        sql += " AND timestamp >= NOW() - (:d || ' days')::INTERVAL"
        params["d"] = days
    sql += " GROUP BY case_id"
    async with TsSession() as ts:
        rows = await ts.execute(text(sql), params)
        return [dict(r._mapping) for r in rows.fetchall()]


async def daily_metric_series(tenant_id: str, object_type_id: str,
                              metric: str, days: int = 90) -> list[tuple]:
    """Per-day series used by Phase 7 ts_anomaly. Returns [(date, value)]."""
    if metric == "case_count":
        sql = (
            "SELECT DATE_TRUNC('day', timestamp)::date AS day, "
            "       COUNT(DISTINCT case_id)::float AS value "
            "FROM events "
            "WHERE tenant_id = :t AND object_type_id = :o "
            "  AND timestamp >= NOW() - (:d || ' days')::INTERVAL "
            + _SYSTEM_EXCL +
            " GROUP BY 1 ORDER BY 1"
        )
    elif metric == "event_count":
        sql = (
            "SELECT DATE_TRUNC('day', timestamp)::date AS day, "
            "       COUNT(*)::float AS value "
            "FROM events "
            "WHERE tenant_id = :t AND object_type_id = :o "
            "  AND timestamp >= NOW() - (:d || ' days')::INTERVAL "
            + _SYSTEM_EXCL +
            " GROUP BY 1 ORDER BY 1"
        )
    else:
        return []
    async with TsSession() as ts:
        rows = await ts.execute(text(sql), {"t": tenant_id, "o": object_type_id, "d": days})
        return [(r._mapping["day"], r._mapping["value"]) for r in rows.fetchall()]
