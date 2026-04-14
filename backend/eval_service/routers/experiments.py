"""
Eval Experiments — grid search across model/prompt/temperature combinations.
POST /experiments              → create experiment
GET  /experiments/{id}         → get experiment + run comparison table
POST /experiments/{id}/run     → execute all param combinations
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import EvalSuiteRow, EvalExperimentRow, EvalRunRow, get_session
import runner as eval_runner

router = APIRouter()


class ExperimentCreate(BaseModel):
    suite_id: str
    name: str
    param_grid: dict = Field(
        ...,
        description="Dict of param_name → list of values. e.g. {model: [...], temperature: [...]}"
    )


def _exp_to_dict(row: EvalExperimentRow) -> dict:
    return {
        "id": row.id,
        "suite_id": row.suite_id,
        "name": row.name,
        "param_grid": row.param_grid or {},
        "run_ids": row.run_ids or [],
        "best_run_id": row.best_run_id,
        "status": row.status,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


@router.post("", status_code=201)
async def create_experiment(
    body: ExperimentCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    suite_result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == body.suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    if not suite_result.scalar_one_or_none():
        raise HTTPException(404, "Suite not found")

    row = EvalExperimentRow(
        id=str(uuid4()),
        suite_id=body.suite_id,
        tenant_id=tenant_id,
        name=body.name,
        param_grid=body.param_grid,
        run_ids=[],
        status="pending",
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _exp_to_dict(row)


@router.get("")
async def list_experiments(
    suite_id: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    q = select(EvalExperimentRow).where(EvalExperimentRow.tenant_id == tenant_id)
    if suite_id:
        q = q.where(EvalExperimentRow.suite_id == suite_id)
    q = q.order_by(EvalExperimentRow.created_at.desc())
    result = await db.execute(q)
    return [_exp_to_dict(r) for r in result.scalars().all()]


@router.get("/{experiment_id}")
async def get_experiment(
    experiment_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalExperimentRow).where(
            EvalExperimentRow.id == experiment_id,
            EvalExperimentRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Experiment not found")

    exp_dict = _exp_to_dict(row)

    # Enrich with run summaries for the comparison table
    if row.run_ids:
        runs_result = await db.execute(
            select(EvalRunRow).where(EvalRunRow.id.in_(row.run_ids))
        )
        runs = {r.id: r for r in runs_result.scalars().all()}
        comparison = []
        for rid in row.run_ids:
            r = runs.get(rid)
            if r:
                comparison.append({
                    "run_id": rid,
                    "config_overrides": r.config_overrides or {},
                    "status": r.status,
                    "summary": r.summary,
                    "is_best": rid == row.best_run_id,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                })
        exp_dict["comparison"] = comparison

    return exp_dict


@router.post("/{experiment_id}/run", status_code=202)
async def run_experiment(
    experiment_id: str,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalExperimentRow).where(
            EvalExperimentRow.id == experiment_id,
            EvalExperimentRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Experiment not found")
    if row.status == "running":
        raise HTTPException(409, "Experiment is already running")

    row.status = "running"
    await db.commit()

    background_tasks.add_task(_run_experiment_bg, experiment_id, tenant_id)
    return {"experiment_id": experiment_id, "status": "running"}


async def _run_experiment_bg(experiment_id: str, tenant_id: str):
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await eval_runner.run_experiment(experiment_id, tenant_id, db)


@router.delete("/{experiment_id}", status_code=204)
async def delete_experiment(
    experiment_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalExperimentRow).where(
            EvalExperimentRow.id == experiment_id,
            EvalExperimentRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Experiment not found")
    await db.delete(row)
    await db.commit()
