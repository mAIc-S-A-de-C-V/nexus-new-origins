"""
Phase 3 — process-aware (cross-object) mining endpoints.

Mirror the existing /process/{cases,variants,transitions,bottlenecks,stats,overview}
endpoints, but key on a Process definition instead of a single object_type_id.

Process resolution:
  - Fetch the Process from postgres (included_object_type_ids, case_key_attribute, etc.)
  - Build a WHERE that includes events from ALL listed object types
  - Use attributes.case_key (set by Phase 2 writer or by backfill) when present;
    fall back to case_id for legacy events
  - Prefix activity with object_type_id when the process spans multiple object types
    so cross-object variants don't collide on shared names like RECORD_UPDATED
"""
import json
import hashlib
from typing import Optional
from fastapi import APIRouter, Query, Header, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_ts_session
from database_pg import get_pg_session

router = APIRouter()

_SYSTEM_EXCL = (
    "AND activity NOT IN ("
    "'PIPELINE_RUN_STARTED','PIPELINE_RUN_COMPLETED','PIPELINE_RUN_FAILED',"
    "'PIPELINE_COMPLETED','PIPELINE_FAILED',"
    "'CONNECTOR_SCHEMA_FETCHED','CONNECTOR_TEST_PASSED','CONNECTOR_TEST_FAILED',"
    "'RECORD_SYNCED'"
    ")"
)


async def _load_process(pg: AsyncSession, tenant_id: str, process_id: str):
    res = await pg.execute(
        text("SELECT * FROM processes WHERE id = :id AND tenant_id = :tid"),
        {"id": process_id, "tid": tenant_id},
    )
    row = res.fetchone()
    if not row:
        raise HTTPException(404, "Process not found")
    return row


def _build_user_excl(excluded: list[str]) -> tuple[str, dict]:
    if not excluded:
        return "", {}
    placeholders = ", ".join(f":uexcl_{i}" for i in range(len(excluded)))
    return f"AND activity NOT IN ({placeholders})", {f"uexcl_{i}": v for i, v in enumerate(excluded)}


def _build_date_filter(ts_expr: str, start_date: str | None, end_date: str | None) -> tuple[str, dict]:
    clauses, params = [], {}
    if start_date:
        clauses.append(f"AND ({ts_expr}) >= :start_date::timestamptz")
        params["start_date"] = start_date
    if end_date:
        clauses.append(f"AND ({ts_expr}) <= :end_date::timestamptz")
        params["end_date"] = end_date
    return " ".join(clauses), params


def _build_attribute_filters(attr_filters: dict[str, str]) -> tuple[str, dict]:
    if not attr_filters:
        return "", {}
    clauses, params = [], {}
    for i, (key, value) in enumerate(attr_filters.items()):
        pk, pv = f"af_key_{i}", f"af_val_{i}"
        clauses.append(
            f"AND COALESCE(attributes->'record_snapshot'->>:{pk}, attributes->>:{pk}) = :{pv}"
        )
        params[pk] = key
        params[pv] = value
    return " ".join(clauses), params


def _build_included_activities_filter(included: list[str] | None) -> str:
    """When a process whitelists activities, filter to just those (raw activity names)."""
    if not included:
        return ""
    placeholders = ", ".join(f":inc_{i}" for i in range(len(included)))
    return f"AND activity IN ({placeholders})"


def _included_act_params(included: list[str] | None) -> dict:
    if not included:
        return {}
    return {f"inc_{i}": v for i, v in enumerate(included)}


def _process_case_id_expr() -> str:
    """Resolved case_id for a process: attributes.case_key when set, else case_id."""
    return "COALESCE(NULLIF(attributes->>'case_key',''), case_id)"


def _process_activity_expr(multi_object: bool) -> str:
    """For multi-object processes, prefix with object_type_id so activities from
    different objects don't collide. The '::' separator is parsed by the frontend
    to render swimlanes."""
    if multi_object:
        return "(object_type_id || '::' || activity)"
    return "activity"


def _split_activities(activities: list[str]) -> list[dict]:
    """Decode 'objectTypeId::activity' tokens used in multi-object processes."""
    out = []
    for a in activities:
        if a and "::" in a:
            ot, act = a.split("::", 1)
            out.append({"activity": act, "object_type_id": ot, "label": a})
        else:
            out.append({"activity": a, "object_type_id": None, "label": a})
    return out


def _variant_id(activities: list[str]) -> str:
    return hashlib.md5("→".join(activities).encode()).hexdigest()[:12]


def _process_filters(proc) -> tuple[str, str, dict, list[str]]:
    """Returns (object_filter_sql, included_activity_sql, params, included_activities)."""
    ots = list(proc.included_object_type_ids or [])
    inc = list(proc.included_activities) if proc.included_activities else None
    inc_sql = _build_included_activities_filter(inc)
    inc_params = _included_act_params(inc)
    return (
        "AND object_type_id = ANY(:ot_ids)",
        inc_sql,
        {"ot_ids": ots, **inc_params},
        inc or [],
    )


# ── /cases ───────────────────────────────────────────────────────────────────

@router.get("/cases/{process_id}")
async def list_cases_for_process(
    process_id: str,
    state: Optional[str] = Query(None),
    variant_id: Optional[str] = Query(None),
    stuck_days: int = Query(30),
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    multi = len(proc.included_object_type_ids or []) > 1
    cid_expr = _process_case_id_expr()
    act_expr = _process_activity_expr(multi)
    ts_expr = "timestamp"

    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)
    if proc.excluded_activities:
        excl_list = list(set(excl_list + list(proc.excluded_activities)))
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    state_filter = ""
    if state == "stuck":
        state_filter = "AND extract(epoch FROM (now() - last_activity_at)) / 86400.0 > :stuck_days"

    sql = text(f"""
        WITH case_agg AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                array_agg({act_expr} ORDER BY {ts_expr}) AS activities,
                array_agg(object_type_id ORDER BY {ts_expr}) AS object_types,
                array_agg(resource ORDER BY {ts_expr}) AS resources,
                min({ts_expr}) AS started_at,
                max({ts_expr}) AS last_activity_at,
                count(*) AS event_count,
                count(DISTINCT object_type_id) AS object_type_count
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
            GROUP BY resolved_case_id
        )
        SELECT
            resolved_case_id AS case_id,
            activities,
            object_types,
            object_type_count,
            activities[array_length(activities, 1)] AS current_activity,
            resources[array_length(resources, 1)] AS last_resource,
            extract(epoch FROM (now() - started_at)) / 86400.0 AS total_duration_days,
            extract(epoch FROM (now() - last_activity_at)) / 86400.0 AS days_since_last_activity,
            event_count,
            started_at,
            last_activity_at
        FROM case_agg
        WHERE 1=1
          {state_filter}
        ORDER BY last_activity_at DESC
        LIMIT :limit OFFSET :offset
    """)
    rows = (await ts.execute(sql, {
        "tenant_id": tenant_id,
        "stuck_days": stuck_days,
        "limit": limit,
        "offset": offset,
        **obj_params,
        **user_excl_params,
        **date_params,
        **af_params,
    })).fetchall()

    cases = []
    for row in rows:
        raw_activities = list(row.activities or [])
        decoded = _split_activities(raw_activities)
        labeled = [label_map.get(d["activity"], d["activity"]) for d in decoded]
        vid = _variant_id(raw_activities)
        seen, is_rework = [], False
        for a in labeled:
            if a in seen:
                is_rework = True
                break
            seen.append(a)
        case_state = "stuck" if (row.days_since_last_activity or 0) > stuck_days else "active"
        cases.append({
            "case_id": row.case_id,
            "current_activity": labeled[-1] if labeled else None,
            "last_resource": row.last_resource,
            "total_duration_days": round(float(row.total_duration_days or 0), 1),
            "days_since_last_activity": round(float(row.days_since_last_activity or 0), 1),
            "event_count": int(row.event_count),
            "started_at": row.started_at.isoformat() if row.started_at else None,
            "last_activity_at": row.last_activity_at.isoformat() if row.last_activity_at else None,
            "variant_id": vid,
            "is_rework": is_rework,
            "state": case_state,
            "activity_sequence": labeled,
            "object_type_count": int(row.object_type_count),
            "object_types": list(set(row.object_types or [])),
            "steps": [
                {"activity": label_map.get(d["activity"], d["activity"]),
                 "object_type_id": d["object_type_id"]}
                for d in decoded
            ],
        })

    if variant_id:
        cases = [c for c in cases if c["variant_id"] == variant_id]
    return {"cases": cases, "total": len(cases), "spans_objects": multi}


# ── /cases/{case_id}/timeline ────────────────────────────────────────────────

@router.get("/cases/{process_id}/{case_id}/timeline")
async def case_timeline_for_process(
    process_id: str,
    case_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    multi = len(proc.included_object_type_ids or []) > 1
    cid_expr = _process_case_id_expr()
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)

    sql = text(f"""
        SELECT
            id,
            activity,
            object_type_id,
            timestamp,
            resource,
            attributes,
            pipeline_id,
            connector_id,
            lag(timestamp) OVER (ORDER BY timestamp) AS prev_timestamp
        FROM events
        WHERE tenant_id = :tenant_id
          {obj_sql}
          AND ({cid_expr}) = :case_id
          {_SYSTEM_EXCL}
          {inc_sql}
        ORDER BY timestamp ASC
    """)
    rows = (await ts.execute(sql, {
        "tenant_id": tenant_id,
        "case_id": case_id,
        **obj_params,
    })).fetchall()

    if not rows:
        return {"case_id": case_id, "process_id": process_id, "events": [], "total_duration_days": 0}

    events = []
    for row in rows:
        dur_h = None
        if row.prev_timestamp:
            dur_h = round((row.timestamp - row.prev_timestamp).total_seconds() / 3600, 2)
        events.append({
            "id": row.id,
            "activity": row.activity,
            "object_type_id": row.object_type_id,
            "timestamp": row.timestamp.isoformat(),
            "resource": row.resource,
            "attributes": row.attributes or {},
            "pipeline_id": row.pipeline_id,
            "duration_since_prev_hours": dur_h,
        })
    total_days = round((rows[-1].timestamp - rows[0].timestamp).total_seconds() / 86400, 1)
    return {
        "case_id": case_id,
        "process_id": process_id,
        "events": events,
        "total_duration_days": total_days,
        "event_count": len(events),
        "spans_objects": multi,
        "object_types": list({e["object_type_id"] for e in events if e["object_type_id"]}),
    }


# ── /variants ────────────────────────────────────────────────────────────────

@router.get("/variants/{process_id}")
async def variants_for_process(
    process_id: str,
    limit: int = Query(200, le=500),
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    multi = len(proc.included_object_type_ids or []) > 1
    cid_expr = _process_case_id_expr()
    act_expr = _process_activity_expr(multi)
    ts_expr = "timestamp"

    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    if proc.excluded_activities:
        excl_list = list(set(excl_list + list(proc.excluded_activities)))
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH raw AS (
            SELECT {cid_expr} AS rid, {act_expr} AS act, {ts_expr} AS rts,
                   lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS prev_act,
                   min({ts_expr}) OVER (PARTITION BY {cid_expr}) AS started_at,
                   max({ts_expr}) OVER (PARTITION BY {cid_expr}) AS last_at
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
        ),
        seq AS (
            SELECT rid,
                   array_agg(act ORDER BY rts) AS activities,
                   min(started_at) AS started_at,
                   max(last_at) AS last_at
            FROM raw
            WHERE prev_act IS NULL OR prev_act != act
            GROUP BY rid
        )
        SELECT activities,
               count(*) AS case_count,
               sum(count(*)) OVER () AS grand_total,
               avg(extract(epoch FROM (last_at - started_at)) / 86400.0) AS avg_duration_days,
               min(extract(epoch FROM (last_at - started_at)) / 86400.0) AS min_duration_days,
               max(extract(epoch FROM (last_at - started_at)) / 86400.0) AS max_duration_days
        FROM seq
        GROUP BY activities
        ORDER BY case_count DESC
        LIMIT :limit
    """)
    rows = (await ts.execute(sql, {
        "tenant_id": tenant_id,
        "limit": limit,
        **obj_params,
        **user_excl_params,
        **date_params,
        **af_params,
    })).fetchall()

    total_cases = int(rows[0].grand_total) if rows else 0
    variants = []
    for i, row in enumerate(rows):
        raw_activities = list(row.activities or [])
        steps = _split_activities(raw_activities)
        labeled = [label_map.get(s["activity"], s["activity"]) for s in steps]
        vid = _variant_id(raw_activities)
        seen, is_rework = [], False
        for a in labeled:
            if a in seen:
                is_rework = True
                break
            seen.append(a)
        case_count = int(row.case_count)
        variants.append({
            "rank": i + 1,
            "variant_id": vid,
            "activities": labeled,
            "steps": [
                {"activity": label_map.get(s["activity"], s["activity"]),
                 "object_type_id": s["object_type_id"]}
                for s in steps
            ],
            "case_count": case_count,
            "frequency_pct": round(case_count / total_cases * 100, 1) if total_cases else 0,
            "avg_duration_days": round(float(row.avg_duration_days or 0), 1),
            "min_duration_days": round(float(row.min_duration_days or 0), 1),
            "max_duration_days": round(float(row.max_duration_days or 0), 1),
            "is_rework": is_rework,
        })
    return {
        "variants": variants,
        "total_cases": total_cases,
        "variant_count": len(variants),
        "spans_objects": multi,
    }


# ── /transitions ─────────────────────────────────────────────────────────────

@router.get("/transitions/{process_id}")
async def transitions_for_process(
    process_id: str,
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    multi = len(proc.included_object_type_ids or []) > 1
    cid_expr = _process_case_id_expr()
    act_expr = _process_activity_expr(multi)
    ts_expr = "timestamp"

    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    if proc.excluded_activities:
        excl_list = list(set(excl_list + list(proc.excluded_activities)))
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH ordered AS (
            SELECT
                {cid_expr} AS rid,
                {act_expr} AS act,
                object_type_id AS to_ot,
                {ts_expr} AS rts,
                lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_act,
                lag(object_type_id) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_ot,
                lag({ts_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_ts
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
        )
        SELECT
            from_act, from_ot,
            act AS to_act, to_ot,
            count(*) AS transition_count,
            avg(extract(epoch FROM (rts - from_ts)) / 3600.0) AS avg_hours,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (rts - from_ts)) / 3600.0) AS p50_hours,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (rts - from_ts)) / 3600.0) AS p95_hours
        FROM ordered
        WHERE from_act IS NOT NULL AND from_act != act
        GROUP BY from_act, from_ot, act, to_ot
        ORDER BY transition_count DESC
    """)
    rows = (await ts.execute(sql, {
        "tenant_id": tenant_id,
        **obj_params,
        **user_excl_params,
        **date_params,
        **af_params,
    })).fetchall()

    avgs = [float(r.avg_hours or 0) for r in rows if r.avg_hours]
    median = sorted(avgs)[len(avgs) // 2] if avgs else 1.0

    transitions = []
    activities_set = set()
    for row in rows:
        from_decoded = _split_activities([row.from_act])[0] if row.from_act else None
        to_decoded = _split_activities([row.to_act])[0]
        avg_h = float(row.avg_hours or 0)
        speed = "fast" if avg_h <= median * 0.5 else ("slow" if avg_h >= median * 2 else "normal")
        from_a = label_map.get(from_decoded["activity"], from_decoded["activity"]) if from_decoded else None
        to_a = label_map.get(to_decoded["activity"], to_decoded["activity"])
        transitions.append({
            "from_activity": from_a,
            "from_object_type_id": from_decoded["object_type_id"] if from_decoded else None,
            "to_activity": to_a,
            "to_object_type_id": to_decoded["object_type_id"],
            "count": int(row.transition_count),
            "avg_hours": round(avg_h, 1),
            "p50_hours": round(float(row.p50_hours or 0), 1),
            "p95_hours": round(float(row.p95_hours or 0), 1),
            "speed": speed,
        })
        if from_a:
            activities_set.add(from_a)
        activities_set.add(to_a)

    return {
        "transitions": transitions,
        "activities": list(activities_set),
        "median_hours": round(median, 1),
        "spans_objects": multi,
    }


# ── /bottlenecks ─────────────────────────────────────────────────────────────

@router.get("/bottlenecks/{process_id}")
async def bottlenecks_for_process(
    process_id: str,
    top_n: int = Query(10),
    excluded: Optional[str] = Query(None),
    labels: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    multi = len(proc.included_object_type_ids or []) > 1
    cid_expr = _process_case_id_expr()
    act_expr = _process_activity_expr(multi)
    ts_expr = "timestamp"

    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    if proc.excluded_activities:
        excl_list = list(set(excl_list + list(proc.excluded_activities)))
    label_map: dict[str, str] = json.loads(labels) if labels else {}
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    sql = text(f"""
        WITH ordered AS (
            SELECT
                {cid_expr} AS rid,
                {act_expr} AS act,
                {ts_expr} AS rts,
                lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_act,
                lag({ts_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS from_ts
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
        ),
        t AS (
            SELECT from_act, act AS to_act,
                   extract(epoch FROM (rts - from_ts)) / 3600.0 AS hours
            FROM ordered
            WHERE from_act IS NOT NULL AND from_act != act
        )
        SELECT from_act, to_act,
               count(*) AS case_count,
               avg(hours) AS avg_hours,
               max(hours) AS max_hours,
               percentile_cont(0.95) WITHIN GROUP (ORDER BY hours) AS p95_hours
        FROM t
        GROUP BY from_act, to_act
        ORDER BY avg_hours DESC
        LIMIT :top_n
    """)
    rows = (await ts.execute(sql, {
        "tenant_id": tenant_id,
        "top_n": top_n,
        **obj_params,
        **user_excl_params,
        **date_params,
        **af_params,
    })).fetchall()

    out = []
    for r in rows:
        f = _split_activities([r.from_act])[0] if r.from_act else None
        t_ = _split_activities([r.to_act])[0]
        out.append({
            "from_activity": label_map.get(f["activity"], f["activity"]) if f else None,
            "from_object_type_id": f["object_type_id"] if f else None,
            "to_activity": label_map.get(t_["activity"], t_["activity"]),
            "to_object_type_id": t_["object_type_id"],
            "case_count": int(r.case_count),
            "avg_hours": round(float(r.avg_hours or 0), 1),
            "max_hours": round(float(r.max_hours or 0), 1),
            "p95_hours": round(float(r.p95_hours or 0), 1),
        })
    return {"bottlenecks": out, "spans_objects": multi}


# ── /stats ───────────────────────────────────────────────────────────────────

@router.get("/stats/{process_id}")
async def stats_for_process(
    process_id: str,
    excluded: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    multi = len(proc.included_object_type_ids or []) > 1
    cid_expr = _process_case_id_expr()
    act_expr = _process_activity_expr(multi)
    ts_expr = "timestamp"

    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    if proc.excluded_activities:
        excl_list = list(set(excl_list + list(proc.excluded_activities)))
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    bp = {
        "tenant_id": tenant_id,
        **obj_params,
        **user_excl_params,
        **date_params,
        **af_params,
    }
    sql = text(f"""
        WITH case_agg AS (
            SELECT
                {cid_expr} AS rid,
                count(*) AS event_count,
                count(DISTINCT object_type_id) AS object_type_count,
                min({ts_expr}) AS started_at,
                max({ts_expr}) AS last_at,
                array_agg({act_expr} ORDER BY {ts_expr}) AS activities
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
            GROUP BY rid
        )
        SELECT
            count(*) AS total_cases,
            avg(extract(epoch FROM (last_at - started_at)) / 86400.0) AS avg_duration_days,
            count(*) FILTER (WHERE extract(epoch FROM (now() - last_at)) / 86400.0 > 30) AS stuck_cases,
            count(DISTINCT array_to_string(activities, '→')) AS variant_count,
            avg(object_type_count) AS avg_object_types_per_case
        FROM case_agg
    """)
    row = (await ts.execute(sql, bp)).fetchone()
    if not row or not row.total_cases:
        return {
            "total_cases": 0, "avg_duration_days": 0, "stuck_cases": 0,
            "variant_count": 0, "rework_rate": 0,
            "avg_object_types_per_case": 0, "spans_objects": multi,
        }
    total = int(row.total_cases)

    # rework calc — same logic as single-object stats
    rework_sql = text(f"""
        WITH deduped AS (
            SELECT {cid_expr} AS rid, {act_expr} AS act, {ts_expr} AS rts,
                   lag({act_expr}) OVER (PARTITION BY {cid_expr} ORDER BY {ts_expr}) AS prev_act
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
        ),
        seq AS (
            SELECT rid, array_agg(act ORDER BY rts) AS activities
            FROM deduped
            WHERE prev_act IS NULL OR prev_act != act
            GROUP BY rid
        )
        SELECT count(*) AS rework_cases
        FROM seq
        WHERE (
            SELECT count(DISTINCT u) FROM unnest(activities) u
        ) < array_length(activities, 1)
    """)
    rework_row = (await ts.execute(rework_sql, bp)).fetchone()
    rework_cases = int(rework_row.rework_cases) if rework_row else 0

    return {
        "total_cases": total,
        "avg_duration_days": round(float(row.avg_duration_days or 0), 1),
        "stuck_cases": int(row.stuck_cases or 0),
        "variant_count": int(row.variant_count or 0),
        "rework_rate": round(rework_cases / total * 100, 1) if total else 0,
        "avg_object_types_per_case": round(float(row.avg_object_types_per_case or 0), 2),
        "spans_objects": multi,
    }


# ── /overview ────────────────────────────────────────────────────────────────

@router.get("/overview/{process_id}")
async def overview_for_process(
    process_id: str,
    group_by: Optional[str] = Query("resource"),
    excluded: Optional[str] = Query(None),
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    attribute_filters: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    proc = await _load_process(pg, tenant_id, process_id)
    cid_expr = _process_case_id_expr()
    ts_expr = "timestamp"

    excl_list = [a.strip() for a in excluded.split(",") if a.strip()] if excluded else []
    if proc.excluded_activities:
        excl_list = list(set(excl_list + list(proc.excluded_activities)))
    af_map: dict[str, str] = json.loads(attribute_filters) if attribute_filters else {}
    obj_sql, inc_sql, obj_params, _ = _process_filters(proc)
    user_excl_sql, user_excl_params = _build_user_excl(excl_list)
    af_sql, af_params = _build_attribute_filters(af_map)
    date_sql, date_params = _build_date_filter(ts_expr, start_date, end_date)

    bp = {
        "tenant_id": tenant_id,
        **obj_params,
        **user_excl_params,
        **date_params,
        **af_params,
    }

    monthly_sql = text(f"""
        WITH case_agg AS (
            SELECT {cid_expr} AS rid,
                   min({ts_expr}) AS started_at,
                   max({ts_expr}) AS last_at
            FROM events
            WHERE tenant_id = :tenant_id
              {obj_sql}
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              {inc_sql}
              {date_sql}
              {af_sql}
            GROUP BY rid
        )
        SELECT date_trunc('month', last_at)::date AS month,
               count(*) AS cases_completed,
               round(avg(extract(epoch FROM (last_at - started_at)) / 86400.0)::numeric, 1) AS avg_duration_days
        FROM case_agg
        GROUP BY month
        ORDER BY month
    """)
    monthly_rows = (await ts.execute(monthly_sql, bp)).fetchall()

    group_col = "pipeline_id" if group_by == "pipeline" else (
        "object_type_id" if group_by == "object_type" else "resource"
    )
    dist_sql = text(f"""
        SELECT COALESCE(NULLIF({group_col}::text, ''), '(unknown)') AS group_label,
               count(DISTINCT {cid_expr}) AS case_count
        FROM events
        WHERE tenant_id = :tenant_id
          {obj_sql}
          AND ({cid_expr}) != ''
          {_SYSTEM_EXCL}
          {user_excl_sql}
          {inc_sql}
          {date_sql}
          {af_sql}
        GROUP BY group_label
        ORDER BY case_count DESC
        LIMIT 12
    """)
    dist_rows = (await ts.execute(dist_sql, bp)).fetchall()

    return {
        "monthly_series": [
            {"month": str(r.month), "cases_completed": int(r.cases_completed),
             "avg_duration_days": float(r.avg_duration_days or 0), "total_cost": 0}
            for r in monthly_rows
        ],
        "distribution": [
            {"group_label": str(r.group_label), "case_count": int(r.case_count)}
            for r in dist_rows
        ],
        "top_resources": [],
        "total_cost": 0,
        "automation_rate": 0,
        "spans_objects": len(proc.included_object_type_ids or []) > 1,
    }


# ── Phase 6: object-instance touchpoints (OCEL) ──────────────────────────────

@router.get("/by-object-instance/{object_type_id}/{object_id}/touchpoints")
async def object_instance_touchpoints(
    object_type_id: str,
    object_id: str,
    limit: int = Query(500, le=2000),
    x_tenant_id: Optional[str] = Header(None),
    ts: AsyncSession = Depends(get_ts_session),
):
    """
    Return every event that touched a specific object instance — whether the
    event was emitted FROM that object's pipeline (object_id matches) OR the
    event references this object via attributes.related_objects (OCEL multi-
    object events).
    """
    tenant_id = x_tenant_id or "tenant-001"
    sql = text("""
        SELECT id, case_id, activity, object_type_id, object_id, timestamp,
               resource, pipeline_id, connector_id, attributes,
               CASE
                 WHEN object_type_id = :ot AND object_id = :oid THEN 'primary'
                 ELSE 'related'
               END AS touch_type
        FROM events
        WHERE tenant_id = :tid
          AND (
            (object_type_id = :ot AND object_id = :oid)
            OR (attributes::jsonb)->'related_objects' @> CAST(:rel AS jsonb)
          )
        ORDER BY timestamp DESC
        LIMIT :lim
    """)
    rel = f'[{{"object_type_id":"{object_type_id}","object_id":"{object_id}"}}]'
    rows = (await ts.execute(sql, {
        "tid": tenant_id, "ot": object_type_id, "oid": object_id,
        "rel": rel, "lim": limit,
    })).fetchall()

    primary = sum(1 for r in rows if r.touch_type == "primary")
    related = sum(1 for r in rows if r.touch_type == "related")
    return {
        "object_type_id": object_type_id,
        "object_id": object_id,
        "touchpoint_count": len(rows),
        "primary_count": primary,
        "related_count": related,
        "events": [
            {
                "id": r.id,
                "case_id": r.case_id,
                "activity": r.activity,
                "object_type_id": r.object_type_id,
                "object_id": r.object_id,
                "timestamp": r.timestamp.isoformat() if r.timestamp else None,
                "resource": r.resource,
                "pipeline_id": r.pipeline_id,
                "touch_type": r.touch_type,
                "attributes": r.attributes or {},
            }
            for r in rows
        ],
    }
