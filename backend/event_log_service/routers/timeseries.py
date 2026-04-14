"""
Time series aggregation endpoints using TimescaleDB time_bucket().
"""
from fastapi import APIRouter, Request, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_session

router = APIRouter()

VALID_BUCKETS = {
    "5m": "5 minutes",
    "15m": "15 minutes",
    "1h": "1 hour",
    "6h": "6 hours",
    "1d": "1 day",
    "1w": "1 week",
}


def _tenant(request: Request) -> str:
    return request.headers.get("x-tenant-id", "tenant-001")


@router.get("/timeseries")
async def events_timeseries(
    request: Request,
    pipeline_id: str | None = Query(default=None),
    bucket: str = Query(default="1h"),
    activity: str | None = Query(default=None),
    from_ts: str | None = Query(default=None),
    to_ts: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """
    Return event counts bucketed by time.
    Response: [{bucket, activity, count}]
    """
    tenant_id = _tenant(request)
    bucket_interval = VALID_BUCKETS.get(bucket, "1 hour")

    params: dict = {"tenant_id": tenant_id}
    where_parts = ["tenant_id = :tenant_id"]

    if pipeline_id:
        where_parts.append("pipeline_id = :pipeline_id")
        params["pipeline_id"] = pipeline_id

    if activity:
        where_parts.append("activity = :activity")
        params["activity"] = activity

    if from_ts:
        where_parts.append("timestamp >= :from_ts")
        params["from_ts"] = from_ts

    if to_ts:
        where_parts.append("timestamp <= :to_ts")
        params["to_ts"] = to_ts

    where_sql = " AND ".join(where_parts)

    # Use time_bucket if available (TimescaleDB), otherwise date_trunc
    try:
        sql = text(f"""
            SELECT
                time_bucket('{bucket_interval}', timestamp) AS bucket,
                activity,
                COUNT(*) AS count
            FROM events
            WHERE {where_sql}
            GROUP BY bucket, activity
            ORDER BY bucket ASC
            LIMIT 500
        """)
        result = await session.execute(sql, params)
    except Exception:
        # Fallback: use date_trunc if time_bucket not available
        trunc_unit = "hour"
        if "minute" in bucket_interval:
            trunc_unit = "minute"
        elif "day" in bucket_interval:
            trunc_unit = "day"
        elif "week" in bucket_interval:
            trunc_unit = "week"
        sql = text(f"""
            SELECT
                date_trunc('{trunc_unit}', timestamp) AS bucket,
                activity,
                COUNT(*) AS count
            FROM events
            WHERE {where_sql}
            GROUP BY bucket, activity
            ORDER BY bucket ASC
            LIMIT 500
        """)
        result = await session.execute(sql, params)

    rows = result.fetchall()
    return [
        {
            "bucket": r.bucket.isoformat() if r.bucket else None,
            "activity": r.activity,
            "count": int(r.count),
        }
        for r in rows
    ]


@router.get("/timeseries/summary")
async def timeseries_summary(
    request: Request,
    pipeline_id: str | None = Query(default=None),
    from_ts: str | None = Query(default=None),
    to_ts: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    """Overall stats: total events, unique cases, activity breakdown, busiest hour."""
    tenant_id = _tenant(request)
    params: dict = {"tenant_id": tenant_id}
    where_parts = ["tenant_id = :tenant_id"]

    if pipeline_id:
        where_parts.append("pipeline_id = :pipeline_id")
        params["pipeline_id"] = pipeline_id
    if from_ts:
        where_parts.append("timestamp >= :from_ts")
        params["from_ts"] = from_ts
    if to_ts:
        where_parts.append("timestamp <= :to_ts")
        params["to_ts"] = to_ts

    where_sql = " AND ".join(where_parts)

    stats_sql = text(f"""
        SELECT
            COUNT(*) AS total_events,
            COUNT(DISTINCT case_id) AS unique_cases,
            MIN(timestamp) AS first_event,
            MAX(timestamp) AS last_event
        FROM events
        WHERE {where_sql}
    """)
    stats = (await session.execute(stats_sql, params)).fetchone()

    activity_sql = text(f"""
        SELECT activity, COUNT(*) AS count
        FROM events
        WHERE {where_sql}
        GROUP BY activity
        ORDER BY count DESC
        LIMIT 20
    """)
    activities = (await session.execute(activity_sql, params)).fetchall()

    return {
        "total_events": int(stats.total_events) if stats else 0,
        "unique_cases": int(stats.unique_cases) if stats else 0,
        "first_event": stats.first_event.isoformat() if stats and stats.first_event else None,
        "last_event": stats.last_event.isoformat() if stats and stats.last_event else None,
        "activity_breakdown": [{"activity": r.activity, "count": int(r.count)} for r in activities],
    }
