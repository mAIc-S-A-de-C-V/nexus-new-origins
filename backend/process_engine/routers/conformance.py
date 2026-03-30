"""
Conformance checking endpoints.
All model storage uses PostgreSQL; event data read from TimescaleDB.
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_ts_session
from database_pg import get_pg_session
from conformance_engine import check_conformance, aggregate_conformance

router = APIRouter()

_SYSTEM_EXCL = (
    "AND activity NOT IN ("
    "'PIPELINE_RUN_STARTED','PIPELINE_RUN_COMPLETED','PIPELINE_RUN_FAILED',"
    "'PIPELINE_COMPLETED','PIPELINE_FAILED',"
    "'CONNECTOR_SCHEMA_FETCHED','CONNECTOR_TEST_PASSED','CONNECTOR_TEST_FAILED',"
    "'RECORD_SYNCED'"
    ")"
)


# ── Model CRUD ─────────────────────────────────────────────────────────────────

class ModelCreate(BaseModel):
    name: str
    activities: list[str]
    is_active: bool = True


class ModelUpdate(BaseModel):
    name: Optional[str] = None
    activities: Optional[list[str]] = None
    is_active: Optional[bool] = None


@router.get("/models/{object_type_id}")
async def list_models(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    rows = await pg.execute(
        text(
            "SELECT * FROM conformance_models "
            "WHERE tenant_id = :tid AND object_type_id = :ot "
            "ORDER BY created_at"
        ),
        {"tid": tenant_id, "ot": object_type_id},
    )
    models = []
    for r in rows.fetchall():
        d = dict(r._mapping)
        d["created_at"] = d["created_at"].isoformat()
        d["updated_at"] = d["updated_at"].isoformat()
        models.append(d)
    return {"models": models}


@router.post("/models/{object_type_id}", status_code=201)
async def create_model(
    object_type_id: str,
    body: ModelCreate,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if not body.activities:
        raise HTTPException(400, "activities must not be empty")

    row = await pg.execute(
        text(
            "INSERT INTO conformance_models "
            "(tenant_id, object_type_id, name, activities, is_active) "
            "VALUES (:tid, :ot, :name, :acts, :active) "
            "RETURNING *"
        ),
        {
            "tid": tenant_id,
            "ot": object_type_id,
            "name": body.name,
            "acts": body.activities,
            "active": body.is_active,
        },
    )
    await pg.commit()
    d = dict(row.fetchone()._mapping)
    d["created_at"] = d["created_at"].isoformat()
    d["updated_at"] = d["updated_at"].isoformat()
    return d


@router.get("/models/{object_type_id}/{model_id}")
async def get_model(
    object_type_id: str,
    model_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = await pg.execute(
        text(
            "SELECT * FROM conformance_models "
            "WHERE id = :id AND tenant_id = :tid AND object_type_id = :ot"
        ),
        {"id": model_id, "tid": tenant_id, "ot": object_type_id},
    )
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Model not found")
    d = dict(r._mapping)
    d["created_at"] = d["created_at"].isoformat()
    d["updated_at"] = d["updated_at"].isoformat()
    return d


@router.patch("/models/{object_type_id}/{model_id}")
async def update_model(
    object_type_id: str,
    model_id: str,
    body: ModelUpdate,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    sets = ["updated_at = NOW()"]
    params: dict = {"id": model_id, "tid": tenant_id, "ot": object_type_id}

    if body.name is not None:
        sets.append("name = :name")
        params["name"] = body.name
    if body.activities is not None:
        sets.append("activities = :acts")
        params["acts"] = body.activities
    if body.is_active is not None:
        sets.append("is_active = :active")
        params["active"] = body.is_active

    await pg.execute(
        text(
            f"UPDATE conformance_models SET {', '.join(sets)} "
            "WHERE id = :id AND tenant_id = :tid AND object_type_id = :ot"
        ),
        params,
    )
    await pg.commit()
    return await get_model(object_type_id, model_id, x_tenant_id, pg)


@router.delete("/models/{object_type_id}/{model_id}", status_code=204)
async def delete_model(
    object_type_id: str,
    model_id: str,
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    await pg.execute(
        text(
            "DELETE FROM conformance_models "
            "WHERE id = :id AND tenant_id = :tid AND object_type_id = :ot"
        ),
        {"id": model_id, "tid": tenant_id, "ot": object_type_id},
    )
    await pg.commit()


# ── Conformance analysis ───────────────────────────────────────────────────────

@router.get("/check/{object_type_id}/{model_id}")
async def check_conformance_endpoint(
    object_type_id: str,
    model_id: str,
    conformance_threshold: float = Query(0.7, ge=0.0, le=1.0),
    limit: int = Query(500, le=2000),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    """Run conformance check for all cases against a model. Returns per-case + aggregate."""
    tenant_id = x_tenant_id or "tenant-001"

    # Fetch model
    row = await pg.execute(
        text(
            "SELECT * FROM conformance_models "
            "WHERE id = :id AND tenant_id = :tid AND object_type_id = :ot"
        ),
        {"id": model_id, "tid": tenant_id, "ot": object_type_id},
    )
    model_row = row.fetchone()
    if not model_row:
        raise HTTPException(404, "Model not found")
    model_activities = list(model_row._mapping["activities"])

    # Fetch all case sequences from TimescaleDB
    sql = text(f"""
        SELECT case_id,
               array_agg(activity ORDER BY timestamp) AS activities
        FROM events
        WHERE object_type_id = :ot
          AND tenant_id = :tid
          AND case_id != ''
          {_SYSTEM_EXCL}
        GROUP BY case_id
        LIMIT :lim
    """)
    cases_rows = await ts.execute(sql, {"ot": object_type_id, "tid": tenant_id, "lim": limit})

    results = []
    for r in cases_rows.fetchall():
        result = check_conformance(
            case_id=r.case_id,
            actual_sequence=list(r.activities),
            model_activities=model_activities,
            conformance_threshold=conformance_threshold,
        )
        results.append(result)

    aggregate = aggregate_conformance(results)

    per_case = [
        {
            "case_id": r.case_id,
            "fitness": r.fitness,
            "is_conformant": r.is_conformant,
            "matched": r.matched,
            "expected_total": r.expected_total,
            "actual_total": r.actual_total,
            "deviations": [
                {
                    "type": d.type,
                    "activity": d.activity,
                    "position": d.position,
                    "detail": d.detail,
                }
                for d in r.deviations
            ],
        }
        for r in results
    ]

    return {
        "model_id": model_id,
        "model_name": model_row._mapping["name"],
        "model_activities": model_activities,
        "conformance_threshold": conformance_threshold,
        "aggregate": aggregate,
        "cases": per_case,
    }


@router.get("/summary/{object_type_id}")
async def conformance_summary(
    object_type_id: str,
    conformance_threshold: float = Query(0.7, ge=0.0, le=1.0),
    x_tenant_id: Optional[str] = Header(None),
    pg: AsyncSession = Depends(get_pg_session),
    ts: AsyncSession = Depends(get_ts_session),
):
    """Run conformance against the active model for this object type."""
    tenant_id = x_tenant_id or "tenant-001"

    row = await pg.execute(
        text(
            "SELECT * FROM conformance_models "
            "WHERE tenant_id = :tid AND object_type_id = :ot AND is_active = TRUE "
            "ORDER BY updated_at DESC LIMIT 1"
        ),
        {"tid": tenant_id, "ot": object_type_id},
    )
    model_row = row.fetchone()
    if not model_row:
        return {"has_model": False, "object_type_id": object_type_id}

    result = await check_conformance_endpoint(
        object_type_id=object_type_id,
        model_id=model_row._mapping["id"],
        conformance_threshold=conformance_threshold,
        limit=500,
        x_tenant_id=x_tenant_id,
        pg=pg,
        ts=ts,
    )
    return {"has_model": True, **result}
