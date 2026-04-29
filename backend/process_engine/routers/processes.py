"""
Process definitions — object-centric process mining (Phase 1).

A Process declares: which object types contribute events, where the shared
case key lives in event attributes, and which activities are in/out of scope.

Implicit processes (one per object_type_id) are auto-created on startup so
existing single-object dashboards keep working unchanged.
"""
from typing import Optional
from datetime import datetime
from uuid import uuid4
from fastapi import APIRouter, Header, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database_pg import get_pg_session, discover_implicit_processes
from database import get_ts_session

router = APIRouter()


class Process(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    tenant_id: str
    name: str
    description: Optional[str] = None
    case_key_attribute: Optional[str] = None
    included_object_type_ids: list[str] = Field(default_factory=list)
    included_activities: Optional[list[str]] = None
    excluded_activities: Optional[list[str]] = None
    default_model_id: Optional[str] = None
    is_implicit: bool = False
    status: str = "active"
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProcessCreate(BaseModel):
    name: str
    description: Optional[str] = None
    case_key_attribute: Optional[str] = None
    included_object_type_ids: list[str]
    included_activities: Optional[list[str]] = None
    excluded_activities: Optional[list[str]] = None
    default_model_id: Optional[str] = None
    status: str = "active"


class ProcessUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    case_key_attribute: Optional[str] = None
    included_object_type_ids: Optional[list[str]] = None
    included_activities: Optional[list[str]] = None
    excluded_activities: Optional[list[str]] = None
    default_model_id: Optional[str] = None
    status: Optional[str] = None


class ProcessDiscoverySuggestion(BaseModel):
    suggested_name: str
    case_key_attribute: str
    included_object_type_ids: list[str]
    candidate_case_count: int
    sample_case_keys: list[str] = Field(default_factory=list)
    confidence: float = 0.5
    rationale: str = ""


def _row_to_process(row) -> Process:
    return Process(
        id=row.id,
        tenant_id=row.tenant_id,
        name=row.name,
        description=row.description,
        case_key_attribute=row.case_key_attribute,
        included_object_type_ids=list(row.included_object_type_ids or []),
        included_activities=list(row.included_activities) if row.included_activities else None,
        excluded_activities=list(row.excluded_activities) if row.excluded_activities else None,
        default_model_id=row.default_model_id,
        is_implicit=bool(row.is_implicit),
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("", response_model=list[Process])
async def list_processes(
    include_implicit: bool = True,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    sql = (
        "SELECT * FROM processes WHERE tenant_id = :tid "
        + ("" if include_implicit else "AND is_implicit = FALSE ")
        + "ORDER BY is_implicit ASC, name ASC"
    )
    res = await pg.execute(text(sql), {"tid": tenant_id})
    return [_row_to_process(r) for r in res.fetchall()]


@router.post("", response_model=Process, status_code=201)
async def create_process(
    body: ProcessCreate,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if not body.included_object_type_ids:
        raise HTTPException(400, "included_object_type_ids cannot be empty")

    res = await pg.execute(
        text(
            "INSERT INTO processes (tenant_id, name, description, case_key_attribute, "
            "included_object_type_ids, included_activities, excluded_activities, "
            "default_model_id, status) "
            "VALUES (:tid, :name, :desc, :cka, :iot, :ia, :ea, :dm, :st) "
            "RETURNING *"
        ),
        {
            "tid": tenant_id,
            "name": body.name,
            "desc": body.description,
            "cka": body.case_key_attribute,
            "iot": body.included_object_type_ids,
            "ia": body.included_activities,
            "ea": body.excluded_activities,
            "dm": body.default_model_id,
            "st": body.status,
        },
    )
    row = res.fetchone()
    await pg.commit()
    return _row_to_process(row)


@router.patch("/{process_id}", response_model=Process)
async def update_process(
    process_id: str,
    body: ProcessUpdate,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        return await get_process(process_id, x_tenant_id, pg)

    set_clauses = []
    params: dict = {"id": process_id, "tid": tenant_id}
    for k, v in fields.items():
        set_clauses.append(f"{k} = :{k}")
        params[k] = v
    set_clauses.append("updated_at = NOW()")

    res = await pg.execute(
        text(
            f"UPDATE processes SET {', '.join(set_clauses)} "
            "WHERE id = :id AND tenant_id = :tid RETURNING *"
        ),
        params,
    )
    row = res.fetchone()
    if not row:
        raise HTTPException(404, "Process not found")
    await pg.commit()
    return _row_to_process(row)


@router.delete("/{process_id}", status_code=204)
async def delete_process(
    process_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    await pg.execute(
        text("DELETE FROM processes WHERE id = :id AND tenant_id = :tid"),
        {"id": process_id, "tid": tenant_id},
    )
    await pg.commit()


# ── Auto-discovery ───────────────────────────────────────────────────────────

class _DiscoverResponse(BaseModel):
    created_implicit: int
    suggestions: list[ProcessDiscoverySuggestion]


@router.post("/auto-discover", response_model=_DiscoverResponse)
async def auto_discover(
    x_tenant_id: Optional[str] = Header(None),
    ts: AsyncSession = Depends(get_ts_session),
):
    """
    Two things:
      1. Ensure every (tenant, object_type) pair seen in events has an implicit process.
      2. Propose cross-object processes — groupings of object types whose events
         appear to share a candidate case key (any record_snapshot field with the
         same name and overlapping values across two or more object types).
    """
    tenant_id = x_tenant_id or "tenant-001"
    created = await discover_implicit_processes()

    # Discover candidate shared keys: for each common record_snapshot key across
    # two or more object types, see if value sets overlap.
    candidates_sql = text("""
        WITH attr_keys AS (
            SELECT object_type_id, k AS attr_key
            FROM events,
                 jsonb_object_keys((attributes::jsonb)->'record_snapshot') AS k
            WHERE tenant_id = :tid
              AND attributes IS NOT NULL
              AND (attributes::jsonb)->'record_snapshot' IS NOT NULL
            GROUP BY object_type_id, k
        ),
        shared_keys AS (
            SELECT attr_key, array_agg(DISTINCT object_type_id) AS object_types
            FROM attr_keys
            GROUP BY attr_key
            HAVING count(DISTINCT object_type_id) >= 2
        )
        SELECT attr_key, object_types
        FROM shared_keys
        WHERE attr_key NOT IN ('id', 'created_at', 'updated_at', 'createdate', 'lastmodified',
                               'tenant_id', 'name', 'type')
        LIMIT 20
    """)
    cand_rows = (await ts.execute(candidates_sql, {"tid": tenant_id})).fetchall()

    suggestions: list[ProcessDiscoverySuggestion] = []
    for cand in cand_rows:
        attr_key = str(cand.attr_key)
        ot_list = list(cand.object_types or [])
        # For each candidate, count distinct case keys that appear across >=2 object types
        overlap_sql = text("""
            WITH case_keys AS (
                SELECT object_type_id,
                       (attributes::jsonb)->'record_snapshot'->>:k AS ck
                FROM events
                WHERE tenant_id = :tid
                  AND object_type_id = ANY(:ots)
                  AND attributes IS NOT NULL
                  AND (attributes::jsonb)->'record_snapshot'->>:k IS NOT NULL
                  AND (attributes::jsonb)->'record_snapshot'->>:k != ''
            ),
            shared AS (
                SELECT ck, count(DISTINCT object_type_id) AS ot_count
                FROM case_keys
                GROUP BY ck
                HAVING count(DISTINCT object_type_id) >= 2
            ),
            samples AS (
                SELECT ck FROM shared ORDER BY ck LIMIT 5
            )
            SELECT
                (SELECT count(*) FROM shared) AS overlap_count,
                (SELECT array_agg(ck) FROM samples) AS samples
        """)
        try:
            r = (await ts.execute(overlap_sql, {"tid": tenant_id, "k": attr_key, "ots": ot_list})).fetchone()
        except Exception:
            continue
        if not r or not r.overlap_count:
            continue
        overlap = int(r.overlap_count)
        if overlap < 1:
            continue

        confidence = min(1.0, 0.4 + (overlap / 100.0))
        suggestions.append(ProcessDiscoverySuggestion(
            suggested_name=f"{attr_key} process ({', '.join(ot_list)})",
            case_key_attribute=attr_key,
            included_object_type_ids=ot_list,
            candidate_case_count=overlap,
            sample_case_keys=[str(s) for s in (r.samples or [])][:5],
            confidence=confidence,
            rationale=(
                f"Field '{attr_key}' appears in record snapshots of {len(ot_list)} object "
                f"types and {overlap} distinct values overlap across them — likely a "
                "shared business key."
            ),
        ))

    suggestions.sort(key=lambda s: -s.candidate_case_count)
    return _DiscoverResponse(created_implicit=created, suggestions=suggestions[:10])


# ── Backfill ────────────────────────────────────────────────────────────────

class _BackfillResponse(BaseModel):
    process_id: str
    events_updated: int
    cases_after: int


@router.post("/{process_id}/backfill", response_model=_BackfillResponse)
async def backfill_case_keys(
    process_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    """
    Phase 2: for events of this process's object types whose attributes already
    contain the configured case_key_attribute (in record_snapshot or top-level),
    write that value into attributes.case_key. Lets cross-object mining light up
    over historical data without re-running pipelines.
    """
    tenant_id = x_tenant_id or "tenant-001"
    res = await pg.execute(
        text("SELECT * FROM processes WHERE id = :id AND tenant_id = :tid"),
        {"id": process_id, "tid": tenant_id},
    )
    proc = res.fetchone()
    if not proc:
        raise HTTPException(404, "Process not found")
    if not proc.case_key_attribute:
        raise HTTPException(400, "Process has no case_key_attribute set")
    if not proc.included_object_type_ids:
        raise HTTPException(400, "Process has no included_object_type_ids")

    update_sql = text("""
        UPDATE events
        SET attributes = jsonb_set(
            COALESCE(attributes::jsonb, '{}'::jsonb),
            '{case_key}',
            to_jsonb(
                COALESCE(
                    NULLIF(attributes::jsonb->'record_snapshot'->>:k, ''),
                    NULLIF(attributes::jsonb->>:k, '')
                )
            )
        )
        WHERE tenant_id = :tid
          AND object_type_id = ANY(:ots)
          AND COALESCE(
                NULLIF(attributes::jsonb->'record_snapshot'->>:k, ''),
                NULLIF(attributes::jsonb->>:k, '')
              ) IS NOT NULL
          AND (attributes::jsonb->>'case_key' IS NULL OR attributes::jsonb->>'case_key' = '')
    """)
    result = await ts.execute(update_sql, {
        "tid": tenant_id,
        "ots": list(proc.included_object_type_ids),
        "k": proc.case_key_attribute,
    })
    await ts.commit()
    updated = result.rowcount or 0

    # Count cases after backfill
    count_sql = text("""
        SELECT count(DISTINCT (attributes::jsonb->>'case_key')) AS c
        FROM events
        WHERE tenant_id = :tid
          AND object_type_id = ANY(:ots)
          AND attributes::jsonb->>'case_key' IS NOT NULL
    """)
    crow = (await ts.execute(count_sql, {
        "tid": tenant_id,
        "ots": list(proc.included_object_type_ids),
    })).fetchone()
    cases_after = int(crow.c) if crow and crow.c else 0

    return _BackfillResponse(
        process_id=process_id,
        events_updated=updated,
        cases_after=cases_after,
    )


# Parameterized routes go LAST so static paths like /auto-discover match first.
@router.get("/{process_id}", response_model=Process)
async def get_process(
    process_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    res = await pg.execute(
        text("SELECT * FROM processes WHERE id = :id AND tenant_id = :tid"),
        {"id": process_id, "tid": tenant_id},
    )
    row = res.fetchone()
    if not row:
        raise HTTPException(404, "Process not found")
    return _row_to_process(row)
