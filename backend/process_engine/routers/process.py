import json
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
    "'CONNECTOR_SCHEMA_FETCHED','CONNECTOR_TEST_PASSED','CONNECTOR_TEST_FAILED',"
    "'RECORD_SYNCED'"
    ")"
)


def _resolved_activity_expr(act_attr: str) -> str:
    """
    SQL expression that resolves the logical activity name.
    When act_attr is set, remaps generic RECORD_CREATED / RECORD_UPDATED events
    to the field value stored in attributes.record_snapshot (JSONB).
    """
    if not act_attr:
        return "activity"
    return (
        f"CASE "
        f"  WHEN activity IN ('RECORD_CREATED','RECORD_UPDATED')"
        f"    AND attributes IS NOT NULL"
        f"    AND COALESCE(NULLIF(attributes->'record_snapshot'->>:act_attr,''),"
        f"                 NULLIF(attributes->>:act_attr,'')) IS NOT NULL"
        f"  THEN COALESCE("
        f"    NULLIF(attributes->'record_snapshot'->>:act_attr,''),"
        f"    NULLIF(attributes->>:act_attr,''),"
        f"    activity"
        f"  )"
        f"  ELSE activity"
        f" END"
    )


def _resolved_case_id_expr(case_id_attr: str) -> str:
    """
    SQL expression that resolves the logical case_id.
    When case_id_attr is set, remaps RECORD_CREATED / RECORD_UPDATED events
    to use the value from attributes.record_snapshot.{case_id_attr}.
    """
    if not case_id_attr:
        return "case_id"
    return (
        f"CASE "
        f"  WHEN activity IN ('RECORD_CREATED','RECORD_UPDATED')"
        f"    AND attributes IS NOT NULL"
        f"    AND COALESCE(NULLIF(attributes->'record_snapshot'->>:case_id_attr,''),"
        f"                 NULLIF(attributes->>:case_id_attr,'')) IS NOT NULL"
        f"  THEN COALESCE("
        f"    NULLIF(attributes->'record_snapshot'->>:case_id_attr,''),"
        f"    NULLIF(attributes->>:case_id_attr,''),"
        f"    case_id"
        f"  )"
        f"  ELSE case_id"
        f" END"
    )


def _resolved_timestamp_expr(ts_attr: str) -> str:
    """
    SQL expression that resolves the logical timestamp.
    When ts_attr is set, remaps RECORD_CREATED / RECORD_UPDATED events
    to use the value from attributes.record_snapshot.{ts_attr}, cast to timestamptz.
    """
    if not ts_attr:
        return "timestamp"
    return (
        f"CASE "
        f"  WHEN activity IN ('RECORD_CREATED','RECORD_UPDATED')"
        f"    AND attributes IS NOT NULL"
        f"    AND COALESCE(NULLIF(attributes->'record_snapshot'->>:ts_attr,''),"
        f"                 NULLIF(attributes->>:ts_attr,'')) IS NOT NULL"
        f"  THEN COALESCE("
        f"    NULLIF(attributes->'record_snapshot'->>:ts_attr,''),"
        f"    NULLIF(attributes->>:ts_attr,''),"
        f"    timestamp::text"
        f"  )::timestamptz"
        f"  ELSE timestamp"
        f" END"
    )


def _build_user_excl(excluded: list[str]) -> tuple[str, dict]:
    """Build a parameterized SQL fragment for user-defined excluded activities."""
    if not excluded:
        return "", {}
    placeholders = ", ".join(f":uexcl_{i}" for i in range(len(excluded)))
    return f"AND activity NOT IN ({placeholders})", {f"uexcl_{i}": v for i, v in enumerate(excluded)}


def _build_date_filter(ts_expr: str, start_date: str | None, end_date: str | None) -> tuple[str, dict]:
    """Build SQL fragment for date range filtering."""
    clauses = []
    params: dict = {}
    if start_date:
        clauses.append(f"AND ({ts_expr}) >= :start_date::timestamptz")
        params["start_date"] = start_date
    if end_date:
        clauses.append(f"AND ({ts_expr}) <= :end_date::timestamptz")
        params["end_date"] = end_date
    return " ".join(clauses), params


def _build_attribute_filters(attr_filters: dict[str, str]) -> tuple[str, dict]:
    """Build parameterized SQL WHERE clauses for filtering on record_snapshot attributes."""
    if not attr_filters:
        return "", {}
    clauses = []
    params: dict = {}
    for i, (key, value) in enumerate(attr_filters.items()):
        param_key = f"af_key_{i}"
        param_val = f"af_val_{i}"
        clauses.append(
            f"AND COALESCE(attributes->'record_snapshot'->>:{param_key}, attributes->>:{param_key}) = :{param_val}"
        )
        params[param_key] = key
        params[param_val] = value
    return " ".join(clauses), params


def _apply_labels(items: list[dict], labels: dict[str, str], key: str = "activity") -> list[dict]:
    """Replace activity values with human-readable labels in-place."""
    if not labels:
        return items
    for item in items:
        if item.get(key) in labels:
            item[key] = labels[item[key]]
    return items


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
    excluded: Optional[str] = Query(None, description="Comma-separated activity names to exclude"),
    labels: Optional[str] = Query(None, description="JSON object mapping activity→label"),
    activity_attribute: Optional[str] = Query(None, description="JSON attribute key to use as activity name (remaps RECORD_CREATED/RECORD_UPDATED)"),
    case_id_attribute: Optional[str] = Query(None, description="JSON attribute key to use as case_id (remaps RECORD_CREATED/RECORD_UPDATED)"),
    timestamp_attribute: Optional[str] = Query(None, description="JSON attribute key to use as timestamp (remaps RECORD_CREATED/RECORD_UPDATED)"),
    start_date: Optional[str] = Query(None, description="ISO date/datetime — only include events on or after this time"),
    end_date: Optional[str] = Query(None, description="ISO date/datetime — only include events on or before this time"),
    attribute_filters: Optional[str] = Query(None, description="JSON object of record_snapshot key→value pairs to filter on"),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH case_agg AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                array_agg({act_expr} ORDER BY {ts_expr}) AS activities,
                array_agg(resource ORDER BY {ts_expr}) AS resources,
                min({ts_expr}) AS started_at,
                max({ts_expr}) AS last_activity_at,
                count(*) AS event_count
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
            GROUP BY resolved_case_id
        ),
        case_computed AS (
            SELECT
                resolved_case_id,
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
            resolved_case_id AS case_id,
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
          AND (:state::text IS NULL OR (
              :state::text = 'stuck' AND days_since_last_activity > :stuck_days
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
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
        **user_excl_params,
        **date_params,
        **af_params,
    })
    rows = result.fetchall()

    cases = []
    for row in rows:
        activities = [label_map.get(a, a) for a in list(row.activities or [])]
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
            "current_activity": label_map.get(row.current_activity, row.current_activity),
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
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)

    sql = text(f"""
        SELECT
            id,
            {act_expr} AS activity,
            {ts_expr} AS resolved_ts,
            resource,
            attributes,
            pipeline_id,
            connector_id,
            lag({ts_expr}) OVER (ORDER BY {ts_expr}) AS prev_timestamp
        FROM events
        WHERE ({cid_expr}) = :case_id
          AND tenant_id = :tenant_id
          AND (:ot_id = '' OR object_type_id = :ot_id)
          {_SYSTEM_EXCL}
        ORDER BY {ts_expr} ASC
    """)

    result = await db.execute(sql, {
        "case_id": case_id,
        "tenant_id": tenant_id,
        "ot_id": object_type_id,
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
    })
    rows = result.fetchall()

    if not rows:
        return {"case_id": case_id, "events": [], "total_duration_days": 0}

    events = []
    for row in rows:
        duration_since_prev_hours = None
        if row.prev_timestamp:
            delta = row.resolved_ts - row.prev_timestamp
            duration_since_prev_hours = round(delta.total_seconds() / 3600, 2)

        events.append({
            "id": row.id,
            "activity": row.activity,
            "timestamp": row.resolved_ts.isoformat(),
            "resource": row.resource,
            "attributes": row.attributes or {},
            "pipeline_id": row.pipeline_id,
            "duration_since_prev_hours": duration_since_prev_hours,
        })

    total_days = 0.0
    if rows:
        delta = rows[-1].resolved_ts - rows[0].resolved_ts
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
    limit: int = Query(200, le=500),
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH raw AS (
            SELECT {cid_expr} AS resolved_case_id, {act_expr} AS activity, {ts_expr} AS resolved_ts,
                   lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS prev_activity,
                   min({ts_expr}) OVER (PARTITION BY {cid_expr}) AS started_at,
                   max({ts_expr}) OVER (PARTITION BY {cid_expr}) AS last_activity_at
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
        ),
        case_sequences AS (
            SELECT
                resolved_case_id,
                array_agg(activity ORDER BY resolved_ts) AS activities,
                min(started_at) AS started_at,
                max(last_activity_at) AS last_activity_at,
                count(*) AS event_count
            FROM raw
            WHERE prev_activity IS NULL OR prev_activity != activity
            GROUP BY resolved_case_id
        )
        SELECT
            activities,
            count(*) AS case_count,
            sum(count(*)) OVER () AS grand_total,
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
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
        **user_excl_params,
        **date_params,
        **af_params,
    })
    rows = result.fetchall()

    # grand_total is the true total across ALL variants (not just the top N)
    total_cases = int(rows[0].grand_total) if rows else 0

    variants = []
    for i, row in enumerate(rows):
        activities = [label_map.get(a, a) for a in list(row.activities or [])]
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
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH ordered AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                {act_expr} AS activity,
                {ts_expr} AS resolved_ts,
                lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_activity,
                lag({ts_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_timestamp
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
        )
        SELECT
            from_activity,
            activity AS to_activity,
            count(*) AS transition_count,
            avg(extract(epoch FROM (resolved_ts - from_timestamp)) / 3600.0) AS avg_hours,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_ts - from_timestamp)) / 3600.0) AS p50_hours,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (resolved_ts - from_timestamp)) / 3600.0) AS p95_hours
        FROM ordered
        WHERE from_activity IS NOT NULL
          AND from_activity != activity
        GROUP BY from_activity, activity
        ORDER BY transition_count DESC
    """)

    result = await db.execute(sql, {
        "ot_id": object_type_id, "tenant_id": tenant_id,
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
        **user_excl_params,
        **date_params,
        **af_params,
    })
    rows = result.fetchall()

    # Compute overall median for coloring in frontend
    all_avg_hours = [float(r.avg_hours or 0) for r in rows if r.avg_hours]
    median_hours = sorted(all_avg_hours)[len(all_avg_hours) // 2] if all_avg_hours else 1.0

    transitions = []
    for row in rows:
        avg_h = float(row.avg_hours or 0)
        speed = "fast" if avg_h <= median_hours * 0.5 else ("slow" if avg_h >= median_hours * 2 else "normal")
        transitions.append({
            "from_activity": label_map.get(row.from_activity, row.from_activity),
            "to_activity": label_map.get(row.to_activity, row.to_activity),
            "count": int(row.transition_count),
            "avg_hours": round(avg_h, 1),
            "p50_hours": round(float(row.p50_hours or 0), 1),
            "p95_hours": round(float(row.p95_hours or 0), 1),
            "speed": speed,
        })

    # All unique activities (already label-mapped above)
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
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH ordered AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                {act_expr} AS activity,
                {ts_expr} AS resolved_ts,
                lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_activity,
                lag({ts_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_timestamp
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
        ),
        transitions AS (
            SELECT
                from_activity,
                activity AS to_activity,
                resolved_case_id,
                extract(epoch FROM (resolved_ts - from_timestamp)) / 3600.0 AS hours
            FROM ordered
            WHERE from_activity IS NOT NULL
              AND from_activity != activity
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

    result = await db.execute(sql, {
        "ot_id": object_type_id, "tenant_id": tenant_id, "top_n": top_n,
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
        **user_excl_params,
        **date_params,
        **af_params,
    })
    rows = result.fetchall()

    return {
        "bottlenecks": [
            {
                "from_activity": label_map.get(r.from_activity, r.from_activity) if label_map else r.from_activity,
                "to_activity": label_map.get(r.to_activity, r.to_activity) if label_map else r.to_activity,
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
    excluded: Optional[str] = Query(None),
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    bind_params = {
        "ot_id": object_type_id,
        "tenant_id": tenant_id,
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
        **user_excl_params,
        **date_params,
        **af_params,
    }

    sql = text(f"""
        WITH case_agg AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                count(*) AS event_count,
                min({ts_expr}) AS started_at,
                max({ts_expr}) AS last_activity_at,
                array_agg({act_expr} ORDER BY {ts_expr}) AS activities
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
            GROUP BY resolved_case_id
        )
        SELECT
            count(*) AS total_cases,
            avg(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS avg_duration_days,
            count(*) FILTER (WHERE extract(epoch FROM (now() - last_activity_at)) / 86400.0 > 30) AS stuck_cases,
            count(DISTINCT array_to_string(activities, '→')) AS variant_count
        FROM case_agg
    """)

    result = await db.execute(sql, bind_params)
    row = result.fetchone()

    if not row or not row.total_cases:
        return {"total_cases": 0, "avg_duration_days": 0, "stuck_cases": 0, "variant_count": 0, "rework_rate": 0}

    # rework rate — cases where an activity recurs non-consecutively (true rework, not same-stage repeats)
    rework_sql = text(f"""
        WITH deduped AS (
            SELECT {cid_expr} AS resolved_case_id, {act_expr} AS resolved_activity, {ts_expr} AS resolved_ts,
                   lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS prev_activity
            FROM events
            WHERE object_type_id = :ot_id AND tenant_id = :tenant_id AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
        ),
        case_sequences AS (
            SELECT resolved_case_id,
                   array_agg(resolved_activity ORDER BY resolved_ts) AS activities
            FROM deduped
            WHERE prev_activity IS NULL OR prev_activity != resolved_activity
            GROUP BY resolved_case_id
        )
        SELECT count(*) AS rework_cases
        FROM case_sequences
        WHERE (
            SELECT count(*) FROM (
                SELECT DISTINCT unnest(activities)
            ) AS unique_acts
        ) < array_length(activities, 1)
    """)
    rework_result = await db.execute(rework_sql, bind_params)
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


@router.get("/overview/{object_type_id}")
async def get_overview(
    object_type_id: str,
    group_by: Optional[str] = Query("resource", description="Group distribution by: resource, pipeline"),
    excluded: Optional[str] = Query(None),
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    """Overview dashboard data: monthly series, distribution, top resources, automation rate."""
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    act_expr = _resolved_activity_expr(act_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    bind_params = {
        "ot_id": object_type_id,
        "tenant_id": tenant_id,
        **({"act_attr": act_attr} if act_attr else {}),
        **({"case_id_attr": cid_attr} if cid_attr else {}),
        **({"ts_attr": ts_attr} if ts_attr else {}),
        **user_excl_params,
        **date_params,
        **af_params,
    }

    # 1. Monthly series
    monthly_sql = text(f"""
        WITH case_agg AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                min({ts_expr}) AS started_at,
                max({ts_expr}) AS last_activity_at
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
            GROUP BY resolved_case_id
        )
        SELECT
            date_trunc('month', last_activity_at)::date AS month,
            count(*) AS cases_completed,
            round(avg(extract(epoch FROM (last_activity_at - started_at)) / 86400.0)::numeric, 1) AS avg_duration_days
        FROM case_agg
        GROUP BY month
        ORDER BY month
    """)
    monthly_result = await db.execute(monthly_sql, bind_params)
    monthly_rows = monthly_result.fetchall()
    monthly_series = [
        {
            "month": str(r.month),
            "cases_completed": int(r.cases_completed),
            "avg_duration_days": float(r.avg_duration_days or 0),
            "total_cost": 0,
        }
        for r in monthly_rows
    ]

    # 2. Distribution
    group_col = "pipeline_id" if group_by == "pipeline" else "resource"
    dist_sql = text(f"""
        SELECT
            COALESCE(NULLIF({group_col}::text, ''), '(unknown)') AS group_label,
            count(DISTINCT {cid_expr}) AS case_count
        FROM events
        WHERE object_type_id = :ot_id
          AND tenant_id = :tenant_id
          AND ({cid_expr}) != ''
          {_SYSTEM_EXCL}
          {user_excl_sql}
          {date_sql}
          {af_sql}
        GROUP BY group_label
        ORDER BY case_count DESC
        LIMIT 12
    """)
    dist_result = await db.execute(dist_sql, bind_params)
    dist_rows = dist_result.fetchall()
    distribution = [
        {"group_label": str(r.group_label), "case_count": int(r.case_count)}
        for r in dist_rows
    ]

    # 3. Top resources
    res_sql = text(f"""
        SELECT
            COALESCE(NULLIF(resource, ''), '(system)') AS resource,
            count(DISTINCT {cid_expr}) AS case_count,
            count(*) AS event_count,
            COALESCE(sum(cost), 0) AS total_cost
        FROM events
        WHERE object_type_id = :ot_id
          AND tenant_id = :tenant_id
          AND ({cid_expr}) != ''
          {_SYSTEM_EXCL}
          {user_excl_sql}
          {date_sql}
          {af_sql}
        GROUP BY resource
        ORDER BY case_count DESC
        LIMIT 20
    """)
    res_result = await db.execute(res_sql, bind_params)
    res_rows = res_result.fetchall()
    top_resources = [
        {
            "resource": str(r.resource),
            "case_count": int(r.case_count),
            "event_count": int(r.event_count),
            "total_cost": float(r.total_cost or 0),
        }
        for r in res_rows
    ]

    # 4. Total cost
    cost_sql = text(f"""
        SELECT COALESCE(sum(cost), 0) AS total_cost
        FROM events
        WHERE object_type_id = :ot_id
          AND tenant_id = :tenant_id
          {_SYSTEM_EXCL}
          {user_excl_sql}
          {date_sql}
          {af_sql}
    """)
    cost_result = await db.execute(cost_sql, bind_params)
    cost_row = cost_result.fetchone()
    total_cost = float(cost_row.total_cost) if cost_row else 0

    # 5. Automation rate
    auto_sql = text(f"""
        WITH case_resources AS (
            SELECT
                {cid_expr} AS cid,
                bool_and(resource IS NULL OR lower(resource) IN ('system', 'auto', 'automated', '')) AS is_automated
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {date_sql}
              {af_sql}
            GROUP BY cid
        )
        SELECT
            count(*) FILTER (WHERE is_automated) AS automated_cases,
            count(*) AS total_cases
        FROM case_resources
    """)
    auto_result = await db.execute(auto_sql, bind_params)
    auto_row = auto_result.fetchone()
    automation_rate = 0.0
    if auto_row and auto_row.total_cases:
        automation_rate = round(int(auto_row.automated_cases) / int(auto_row.total_cases) * 100, 1)

    return {
        "monthly_series": monthly_series,
        "distribution": distribution,
        "top_resources": top_resources,
        "total_cost": total_cost,
        "automation_rate": automation_rate,
    }


@router.get("/attribute-values/{object_type_id}")
async def get_attribute_values(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    """Discover available attribute keys and their distinct values for segmentation."""
    tenant_id = x_tenant_id or "tenant-001"

    # Get distinct keys from record_snapshot
    keys_sql = text("""
        SELECT DISTINCT k AS attr_key
        FROM events,
             jsonb_object_keys((attributes::jsonb)->'record_snapshot') AS k
        WHERE object_type_id = :ot_id
          AND tenant_id = :tenant_id
          AND attributes IS NOT NULL
          AND (attributes::jsonb)->'record_snapshot' IS NOT NULL
        LIMIT 30
    """)
    keys_result = await db.execute(keys_sql, {"ot_id": object_type_id, "tenant_id": tenant_id})
    keys_rows = keys_result.fetchall()

    segments = []
    for kr in keys_rows:
        key = str(kr.attr_key)
        vals_sql = text("""
            SELECT DISTINCT COALESCE((attributes::jsonb)->'record_snapshot'->>:key, attributes::jsonb->>:key) AS val
            FROM events
            WHERE object_type_id = :ot_id
              AND tenant_id = :tenant_id
              AND attributes IS NOT NULL
              AND COALESCE((attributes::jsonb)->'record_snapshot'->>:key, attributes::jsonb->>:key) IS NOT NULL
              AND COALESCE((attributes::jsonb)->'record_snapshot'->>:key, attributes::jsonb->>:key) != ''
            LIMIT 30
        """)
        vals_result = await db.execute(vals_sql, {"ot_id": object_type_id, "tenant_id": tenant_id, "key": key})
        vals_rows = vals_result.fetchall()
        values = [str(vr.val) for vr in vals_rows]
        if values:
            segments.append({"key": key, "values": values})

    return {"segments": segments}


@router.get("/benchmark/{object_type_id}")
async def get_benchmark(
    object_type_id: str,
    segment_a_key: str = Query(..., description="Attribute key for segment A"),
    segment_a_value: str = Query(..., description="Attribute value for segment A"),
    segment_b_key: str = Query(..., description="Attribute key for segment B"),
    segment_b_value: str = Query(..., description="Attribute value for segment B"),
    excluded: Optional[str] = Query(None),
    activity_attribute: Optional[str] = Query(None),
    case_id_attribute: Optional[str] = Query(None),
    timestamp_attribute: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_ts_session),
):
    """Side-by-side comparison of two segments."""
    tenant_id = x_tenant_id or "tenant-001"
    act_attr = activity_attribute or ""
    cid_attr = case_id_attribute or ""
    ts_attr = timestamp_attribute or ""
    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    act_expr = _resolved_activity_expr(act_attr)
    cid_expr = _resolved_case_id_expr(cid_attr)
    ts_expr = _resolved_timestamp_expr(ts_attr)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    async def _segment_data(seg_key: str, seg_value: str, label: str) -> dict:
        af_map = {seg_key: seg_value}
        af_sql, af_params = _build_attribute_filters(af_map)
        bp = {
            "ot_id": object_type_id,
            "tenant_id": tenant_id,
            **({"act_attr": act_attr} if act_attr else {}),
            **({"case_id_attr": cid_attr} if cid_attr else {}),
            **({"ts_attr": ts_attr} if ts_attr else {}),
            **user_excl_params,
            **date_params,
            **af_params,
        }

        # Stats
        stats_sql = text(f"""
            WITH case_agg AS (
                SELECT
                    {cid_expr} AS resolved_case_id,
                    count(*) AS event_count,
                    min({ts_expr}) AS started_at,
                    max({ts_expr}) AS last_activity_at,
                    array_agg({act_expr} ORDER BY {ts_expr}) AS activities
                FROM events
                WHERE object_type_id = :ot_id
                  AND tenant_id = :tenant_id
                  AND ({cid_expr}) != ''
                  {_SYSTEM_EXCL}
                  {user_excl_sql}
                  {date_sql}
                  {af_sql}
                GROUP BY resolved_case_id
            )
            SELECT
                count(*) AS total_cases,
                avg(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS avg_duration_days,
                count(*) FILTER (WHERE extract(epoch FROM (now() - last_activity_at)) / 86400.0 > 30) AS stuck_cases,
                count(DISTINCT array_to_string(activities, '→')) AS variant_count
            FROM case_agg
        """)
        stats_result = await db.execute(stats_sql, bp)
        srow = stats_result.fetchone()

        seg_stats = {
            "total_cases": int(srow.total_cases) if srow and srow.total_cases else 0,
            "avg_duration_days": round(float(srow.avg_duration_days or 0), 1) if srow else 0,
            "stuck_cases": int(srow.stuck_cases or 0) if srow else 0,
            "variant_count": int(srow.variant_count or 0) if srow else 0,
            "rework_rate": 0,
        }

        # Top 5 variants
        var_sql = text(f"""
            WITH case_agg AS (
                SELECT
                    {cid_expr} AS resolved_case_id,
                    array_agg({act_expr} ORDER BY {ts_expr}) AS activities,
                    min({ts_expr}) AS started_at,
                    max({ts_expr}) AS last_activity_at
                FROM events
                WHERE object_type_id = :ot_id
                  AND tenant_id = :tenant_id
                  AND ({cid_expr}) != ''
                  {_SYSTEM_EXCL}
                  {user_excl_sql}
                  {date_sql}
                  {af_sql}
                GROUP BY resolved_case_id
            ),
            variants AS (
                SELECT
                    activities,
                    count(*) AS case_count,
                    avg(extract(epoch FROM (last_activity_at - started_at)) / 86400.0) AS avg_duration_days,
                    sum(count(*)) OVER () AS grand_total
                FROM case_agg
                GROUP BY activities
                ORDER BY case_count DESC
                LIMIT 5
            )
            SELECT
                activities,
                case_count,
                avg_duration_days,
                grand_total
            FROM variants
        """)
        var_result = await db.execute(var_sql, bp)
        var_rows = var_result.fetchall()
        grand_total = int(var_rows[0].grand_total) if var_rows else seg_stats["total_cases"]
        top_variants = []
        for idx, vr in enumerate(var_rows):
            acts = list(vr.activities)
            top_variants.append({
                "rank": idx + 1,
                "variant_id": _variant_id(acts),
                "activities": acts,
                "case_count": int(vr.case_count),
                "frequency_pct": round(int(vr.case_count) / grand_total * 100, 1) if grand_total else 0,
                "avg_duration_days": round(float(vr.avg_duration_days or 0), 1),
            })

        return {
            "label": label,
            "stats": seg_stats,
            "top_variants": top_variants,
        }

    seg_a = await _segment_data(segment_a_key, segment_a_value, f"{segment_a_key}={segment_a_value}")
    seg_b = await _segment_data(segment_b_key, segment_b_value, f"{segment_b_key}={segment_b_value}")

    return {
        "segment_a": seg_a,
        "segment_b": seg_b,
    }
