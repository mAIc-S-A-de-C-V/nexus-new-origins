from typing import Optional
from fastapi import APIRouter, Query, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_ts_session
import hashlib

router = APIRouter()

_SYSTEM_EXCL = (
    "AND activity NOT IN ("
    "'PIPELINE_RUN_STARTED','PIPELINE_RUN_COMPLETED','PIPELINE_RUN_FAILED',"
    "'PIPELINE_COMPLETED','PIPELINE_FAILED',"
    "'CONNECTOR_SCHEMA_FETCHED','CONNECTOR_TEST_PASSED','CONNECTOR_TEST_FAILED'"
    ")"
)


def _variant_id(activities: list[str]) -> str:
    seq = "→".join(activities)
    return hashlib.md5(seq.encode()).hexdigest()[:12]


@router.get("/cases/{object_type_id}")
async def list_cases(
    object_type_id: str,
    state: Optional[str] = Query(None),
    variant_id: Optional[str] = Query(None),
    stuck_days: int = Query(30),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    sql = text(f"""
        WITH case_agg AS (
            SELECT
                case_id,
                array_agg(activity ORDER BY timestamp) AS activities,
                array_agg(resource ORDER BY timestamp) AS resources,
                min(timestamp) AS started_at,
                max(timestamp) AS last_activity_at,
                count(*) AS event_count
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND case_id != ''
              {_SYSTEM_EXCL}
            GROUP BY case_id
        ),
        case_computed AS (
            SELECT
                case_id,
                activities,
                activities[array_length(activities, 1)] AS current_activity,
                resources[array_length(resources, 1)] AS last_resource,
                extract(epoch FROM (now() - started_at)) / 86400.0 AS total_duration_days,
                extract(epoch FROM (now() - last_activity_at)) / 86400.0 AS days_since_last_activity,
                event_count,
                started_at,
                last_activity_at,
                array_length(activities, 1) > 1 AND (
                    SELECT count(*) FROM generate_subscripts(activities, 1) AS i
                    WHERE i > 1 AND activities[i] = activities[i-1]
                ) > 0 AS has_loops
            FROM case_agg
        )
        SELECT
            case_id,
            activities,
            current_activity,
            last_resource,
            total_duration_days,
            days_since_last_activity,
            event_count,
            started_at,
            last_activity_at
        FROM case_computed
        WHERE 1=1
          AND (:state IS NULL OR (
              :state = 'stuck' AND days_since_last_activity > :stuck_days
          ))
        ORDER BY last_activity_at DESC
        LIMIT :limit OFFSET :offset
    """)

    result = await db.execute(sql, {
        "ot_id": object_type_id,
        "tenant_id": tenant_id,
        "state": state,
        "stuck_days": stuck_days,
        "limit": limit,
        "offset": offset,
    })
    rows = result.fetchall()

    cases = []
    for row in rows:
        activities = list(row.activities or [])
        vid = _variant_id(activities)
        # detect rework: any activity appears after a "later" activity in the sequence
        seen = []
        is_rework = False
        for act in activities:
            if act in seen:
                is_rework = True
                break
            seen.append(act)

        case_state = "active"
        if row.days_since_last_activity and row.days_since_last_activity > stuck_days:
            case_state = "stuck"

        cases.append({
            "case_id": row.case_id,
            "current_activity": row.current_activity,
            "last_resource": row.last_resource,
            "total_duration_days": round(float(row.total_duration_days or 0), 1),
            "days_since_last_activity": round(float(row.days_since_last_activity or 0), 1),
            "event_count": int(row.event_count),
            "started_at": row.started_at.isoformat() if row.started_at else None,
            "last_activity_at": row.last_activity_at.isoformat() if row.last_activity_at else None,
            "variant_id": vid,
            "is_rework": is_rework,
            "state": case_state,
            "activity_sequence": activities,
        })

    # filter by variant_id after computation (cheap for reasonable case counts)
    if variant_id:
        cases = [c for c in cases if c["variant_id"] == variant_id]

    return {"cases": cases, "total": len(cases)}


@router.get("/cases/{object_type_id}/{case_id}/timeline")
async def get_case_timeline(
    object_type_id: str,
    case_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    sql = text(f"""
        SELECT
            id,
            activity,
            timestamp,
            resource,
            attributes,
            pipeline_id,
            connector_id,
            lag(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
        FROM events
        WHERE case_id = :case_id
          AND tenant_id = :tenant_id
          AND (:ot_id = '' OR object_type_id = :ot_id)
          {_SYSTEM_EXCL}
        ORDER BY timestamp ASC
    """)

    result = await db.execute(sql, {
        "case_id": case_id,
        "tenant_id": tenant_id,
        "ot_id": object_type_id,
    })
    rows = result.fetchall()

    if not rows:
        return {"case_id": case_id, "events": [], "total_duration_days": 0}

    events = []
    for row in rows:
        duration_since_prev_hours = None
        if row.prev_timestamp:
            delta = row.timestamp - row.prev_timestamp
            duration_since_prev_hours = round(delta.total_seconds() / 3600, 2)

        events.append({
            "id": row.id,
            "activity": row.activity,
            "timestamp": row.timestamp.isoformat(),
            "resource": row.resource,
            "attributes": row.attributes or {},
            "pipeline_id": row.pipeline_id,
            "duration_since_prev_hours": duration_since_prev_hours,
        })

    total_days = 0.0
    if rows:
        delta = rows[-1].timestamp - rows[0].timestamp
        total_days = round(delta.total_seconds() / 86400, 1)

    return {
        "case_id": case_id,
        "object_type_id": object_type_id,
        "events": events,
        "total_duration_days": total_days,
        "event_count": len(events),
    }


@router.get("/variants/{object_type_id}")
async def list_variants(
    object_type_id: str,
    limit: int = Query(50, le=200),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    sql = text(f"""
        WITH case_sequences AS (
            SELECT
                case_id,
                array_agg(activity ORDER BY timestamp) AS activities,
                min(timestamp) AS started_at,
                max(timestamp) AS last_activity_at,
                count(*) AS event_count
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND case_id != ''
              {_SYSTEM_EXCL}
            GROUP BY case_id
        )
        SELECT
            activities,
            count(*) AS case_count,
            avg(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS avg_duration_days,
            min(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS min_duration_days,
            max(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS max_duration_days
        FROM case_sequences
        GROUP BY activities
        ORDER BY case_count DESC
        LIMIT :limit
    """)

    result = await db.execute(sql, {
        "ot_id": object_type_id,
        "tenant_id": tenant_id,
        "limit": limit,
    })
    rows = result.fetchall()

    total_cases = sum(int(r.case_count) for r in rows)

    variants = []
    for i, row in enumerate(rows):
        activities = list(row.activities or [])
        vid = _variant_id(activities)
        case_count = int(row.case_count)

        # detect rework in this variant
        seen = []
        is_rework = False
        for act in activities:
            if act in seen:
                is_rework = True
                break
            seen.append(act)

        # detect skips — activities that jump non-sequentially (heuristic)
        is_skip = len(set(activities)) < len(activities) or (len(activities) < 3 and case_count < total_cases * 0.1)

        variants.append({
            "rank": i + 1,
            "variant_id": vid,
            "activities": activities,
            "case_count": case_count,
            "frequency_pct": round(case_count / total_cases * 100, 1) if total_cases else 0,
            "avg_duration_days": round(float(row.avg_duration_days or 0), 1),
            "min_duration_days": round(float(row.min_duration_days or 0), 1),
            "max_duration_days": round(float(row.max_duration_days or 0), 1),
            "is_rework": is_rework,
            "is_skip": is_skip and not is_rework,
        })

    return {"variants": variants, "total_cases": total_cases, "variant_count": len(variants)}


@router.get("/transitions/{object_type_id}")
async def get_transitions(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    sql = text(f"""
        WITH ordered AS (
            SELECT
                case_id,
                activity,
                timestamp,
                lag(activity) OVER (PARTITION BY case_id ORDER BY timestamp) AS from_activity,
                lag(timestamp) OVER (PARTITION BY case_id ORDER BY timestamp) AS from_timestamp
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND case_id != ''
              {_SYSTEM_EXCL}
        )
        SELECT
            from_activity,
            activity AS to_activity,
            count(*) AS transition_count,
            avg(extract(epoch FROM (timestamp - from_timestamp)) / 3600.0) AS avg_hours,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (timestamp - from_timestamp)) / 3600.0) AS p50_hours,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (timestamp - from_timestamp)) / 3600.0) AS p95_hours
        FROM ordered
        WHERE from_activity IS NOT NULL
        GROUP BY from_activity, activity
        ORDER BY transition_count DESC
    """)

    result = await db.execute(sql, {"ot_id": object_type_id, "tenant_id": tenant_id})
    rows = result.fetchall()

    # Compute overall median for coloring in frontend
    all_avg_hours = [float(r.avg_hours or 0) for r in rows if r.avg_hours]
    median_hours = sorted(all_avg_hours)[len(all_avg_hours) // 2] if all_avg_hours else 1.0

    transitions = []
    for row in rows:
        avg_h = float(row.avg_hours or 0)
        speed = "fast" if avg_h <= median_hours * 0.5 else ("slow" if avg_h >= median_hours * 2 else "normal")
        transitions.append({
            "from_activity": row.from_activity,
            "to_activity": row.to_activity,
            "count": int(row.transition_count),
            "avg_hours": round(avg_h, 1),
            "p50_hours": round(float(row.p50_hours or 0), 1),
            "p95_hours": round(float(row.p95_hours or 0), 1),
            "speed": speed,
        })

    # All unique activities
    activities = list(set(
        [t["from_activity"] for t in transitions] + [t["to_activity"] for t in transitions]
    ))

    return {
        "transitions": transitions,
        "activities": activities,
        "median_hours": round(median_hours, 1),
    }


@router.get("/bottlenecks/{object_type_id}")
async def get_bottlenecks(
    object_type_id: str,
    top_n: int = Query(10),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    sql = text(f"""
        WITH ordered AS (
            SELECT
                case_id,
                activity,
                timestamp,
                lag(activity) OVER (PARTITION BY case_id ORDER BY timestamp) AS from_activity,
                lag(timestamp) OVER (PARTITION BY case_id ORDER BY timestamp) AS from_timestamp
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND case_id != ''
              {_SYSTEM_EXCL}
        ),
        transitions AS (
            SELECT
                from_activity,
                activity AS to_activity,
                case_id,
                extract(epoch FROM (timestamp - from_timestamp)) / 3600.0 AS hours
            FROM ordered
            WHERE from_activity IS NOT NULL
        )
        SELECT
            from_activity,
            to_activity,
            count(*) AS case_count,
            avg(hours) AS avg_hours,
            max(hours) AS max_hours,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY hours) AS p95_hours
        FROM transitions
        GROUP BY from_activity, to_activity
        ORDER BY avg_hours DESC
        LIMIT :top_n
    """)

    result = await db.execute(sql, {"ot_id": object_type_id, "tenant_id": tenant_id, "top_n": top_n})
    rows = result.fetchall()

    return {
        "bottlenecks": [
            {
                "from_activity": r.from_activity,
                "to_activity": r.to_activity,
                "case_count": int(r.case_count),
                "avg_hours": round(float(r.avg_hours or 0), 1),
                "max_hours": round(float(r.max_hours or 0), 1),
                "p95_hours": round(float(r.p95_hours or 0), 1),
            }
            for r in rows
        ]
    }


@router.get("/stats/{object_type_id}")
async def get_stats(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    sql = text(f"""
        WITH case_agg AS (
            SELECT
                case_id,
                count(*) AS event_count,
                min(timestamp) AS started_at,
                max(timestamp) AS last_activity_at,
                array_agg(activity ORDER BY timestamp) AS activities
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND case_id != ''
              {_SYSTEM_EXCL}
            GROUP BY case_id
        )
        SELECT
            count(*) AS total_cases,
            avg(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS avg_duration_days,
            count(*) FILTER (WHERE extract(epoch FROM (now() - last_activity_at)) / 86400.0 > 30) AS stuck_cases,
            count(DISTINCT array_to_string(activities, '→')) AS variant_count
        FROM case_agg
    """)

    result = await db.execute(sql, {"ot_id": object_type_id, "tenant_id": tenant_id})
    row = result.fetchone()

    if not row or not row.total_cases:
        return {"total_cases": 0, "avg_duration_days": 0, "stuck_cases": 0, "variant_count": 0, "rework_rate": 0}

    # rework rate — cases with any repeated activity
    rework_sql = text(f"""
        WITH case_sequences AS (
            SELECT case_id, array_agg(activity ORDER BY timestamp) AS activities
            FROM events
            WHERE object_type_id = :ot_id AND tenant_id = :tenant_id AND case_id != ''
              {_SYSTEM_EXCL}
            GROUP BY case_id
        )
        SELECT count(*) AS rework_cases
        FROM case_sequences
        WHERE (
            SELECT count(*) FROM (
                SELECT DISTINCT unnest(activities)
            ) AS unique_acts
        ) < array_length(activities, 1)
    """)
    rework_result = await db.execute(rework_sql, {"ot_id": object_type_id, "tenant_id": tenant_id})
    rework_row = rework_result.fetchone()
    rework_cases = int(rework_row.rework_cases) if rework_row else 0
    total = int(row.total_cases)

    return {
        "total_cases": total,
        "avg_duration_days": round(float(row.avg_duration_days or 0), 1),
        "stuck_cases": int(row.stuck_cases or 0),
        "variant_count": int(row.variant_count or 0),
        "rework_rate": round(rework_cases / total * 100, 1) if total else 0,
    }
