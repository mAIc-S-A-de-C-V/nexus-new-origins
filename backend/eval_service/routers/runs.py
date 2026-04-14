"""
Eval Runs — execute suites + poll results.
POST /suites/{suite_id}/run       → start a run (async, returns run_id immediately)
GET  /runs/{run_id}               → get run status + results
GET  /suites/{suite_id}/runs      → run history for a suite
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import EvalSuiteRow, EvalRunRow, get_session
import runner as eval_runner

router = APIRouter()


class RunRequest(BaseModel):
    config_overrides: dict = Field(default_factory=dict)
    run_n_times: int = Field(default=1, ge=1, le=5)


def _run_to_dict(row: EvalRunRow) -> dict:
    return {
        "id": row.id,
        "suite_id": row.suite_id,
        "status": row.status,
        "config_overrides": row.config_overrides or {},
        "results": row.results or [],
        "summary": row.summary,
        "error": row.error,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "completed_at": row.completed_at.isoformat() if row.completed_at else None,
    }


@router.post("/suites/{suite_id}/run", status_code=202)
async def start_run(
    suite_id: str,
    body: RunRequest,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Start an async suite run. Returns run_id immediately."""
    tenant_id = x_tenant_id or "tenant-001"

    # Verify suite exists
    suite_result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    if not suite_result.scalar_one_or_none():
        raise HTTPException(404, "Suite not found")

    run_ids = []
    for _ in range(body.run_n_times):
        run_id = str(uuid4())
        run = EvalRunRow(
            id=run_id,
            suite_id=suite_id,
            tenant_id=tenant_id,
            status="running",
            config_overrides=body.config_overrides,
            results=[],
        )
        db.add(run)
        run_ids.append(run_id)

    await db.commit()

    # Fire each run in the background
    for run_id in run_ids:
        background_tasks.add_task(
            _run_suite_bg,
            suite_id=suite_id,
            config_overrides=body.config_overrides,
            tenant_id=tenant_id,
            run_id=run_id,
        )

    return {"run_ids": run_ids, "run_id": run_ids[0], "status": "running"}


async def _run_suite_bg(suite_id: str, config_overrides: dict, tenant_id: str, run_id: str):
    """Background task wrapper — opens its own DB session."""
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        await eval_runner.run_suite(suite_id, config_overrides, tenant_id, run_id, db)


@router.get("/runs/{run_id}")
async def get_run(
    run_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalRunRow).where(
            EvalRunRow.id == run_id,
            EvalRunRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Run not found")
    return _run_to_dict(row)


@router.get("/suites/{suite_id}/runs")
async def list_runs(
    suite_id: str,
    limit: int = 20,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalRunRow)
        .where(EvalRunRow.suite_id == suite_id, EvalRunRow.tenant_id == tenant_id)
        .order_by(EvalRunRow.started_at.desc())
        .limit(limit)
    )
    return [_run_to_dict(r) for r in result.scalars().all()]
