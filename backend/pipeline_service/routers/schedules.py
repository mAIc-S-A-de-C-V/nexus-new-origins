"""
Pipeline Schedule endpoints — cron-based recurring pipeline runs.
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import PipelineRow, PipelineScheduleRow, get_session

router = APIRouter()


class ScheduleCreate(BaseModel):
    name: str
    cron_expression: str
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None


def _to_dict(row: PipelineScheduleRow) -> dict:
    return {
        "id": row.id,
        "pipeline_id": row.pipeline_id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "cron_expression": row.cron_expression,
        "enabled": row.enabled,
        "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/{pipeline_id}/schedules")
async def list_schedules(
    pipeline_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PipelineScheduleRow)
        .where(PipelineScheduleRow.pipeline_id == pipeline_id, PipelineScheduleRow.tenant_id == tenant_id)
        .order_by(PipelineScheduleRow.created_at.desc())
    )
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("/{pipeline_id}/schedules", status_code=201)
async def create_schedule(
    pipeline_id: str,
    body: ScheduleCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PipelineRow).where(PipelineRow.id == pipeline_id, PipelineRow.tenant_id == tenant_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Pipeline not found")

    row = PipelineScheduleRow(
        id=str(uuid4()),
        pipeline_id=pipeline_id,
        tenant_id=tenant_id,
        name=body.name,
        cron_expression=body.cron_expression,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.put("/{pipeline_id}/schedules/{schedule_id}")
async def update_schedule(
    pipeline_id: str,
    schedule_id: str,
    body: ScheduleUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PipelineScheduleRow).where(
            PipelineScheduleRow.id == schedule_id,
            PipelineScheduleRow.pipeline_id == pipeline_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if body.name is not None:
        row.name = body.name
    if body.cron_expression is not None:
        row.cron_expression = body.cron_expression
    if body.enabled is not None:
        row.enabled = body.enabled

    await db.commit()
    return _to_dict(row)


@router.delete("/{pipeline_id}/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    pipeline_id: str,
    schedule_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PipelineScheduleRow).where(
            PipelineScheduleRow.id == schedule_id,
            PipelineScheduleRow.pipeline_id == pipeline_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.delete(row)
    await db.commit()


@router.post("/{pipeline_id}/schedules/{schedule_id}/run-now", status_code=202)
async def run_schedule_now(
    pipeline_id: str,
    schedule_id: str,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PipelineScheduleRow).where(
            PipelineScheduleRow.id == schedule_id,
            PipelineScheduleRow.pipeline_id == pipeline_id,
        )
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    from cron_scheduler import fire_pipeline_schedule
    background_tasks.add_task(fire_pipeline_schedule, pipeline_id, schedule_id, tenant_id)
    return {"status": "queued", "schedule_id": schedule_id}
