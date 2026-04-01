"""
Agent Schedule endpoints — recurring autonomous agent runs.
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import AgentConfigRow, AgentScheduleRow, get_session

router = APIRouter()


class ScheduleCreate(BaseModel):
    name: str
    prompt: str
    cron_expression: str
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    cron_expression: Optional[str] = None
    enabled: Optional[bool] = None


def _to_dict(row: AgentScheduleRow) -> dict:
    return {
        "id": row.id,
        "agent_id": row.agent_id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "prompt": row.prompt,
        "cron_expression": row.cron_expression,
        "enabled": row.enabled,
        "last_run_at": row.last_run_at.isoformat() if row.last_run_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/{agent_id}/schedules")
async def list_schedules(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentScheduleRow)
        .where(AgentScheduleRow.agent_id == agent_id, AgentScheduleRow.tenant_id == tenant_id)
        .order_by(AgentScheduleRow.created_at.desc())
    )
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("/{agent_id}/schedules", status_code=201)
async def create_schedule(
    agent_id: str,
    body: ScheduleCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(AgentConfigRow.id == agent_id, AgentConfigRow.tenant_id == tenant_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found")

    row = AgentScheduleRow(
        id=str(uuid4()),
        agent_id=agent_id,
        tenant_id=tenant_id,
        name=body.name,
        prompt=body.prompt,
        cron_expression=body.cron_expression,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.put("/{agent_id}/schedules/{schedule_id}")
async def update_schedule(
    agent_id: str,
    schedule_id: str,
    body: ScheduleUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentScheduleRow).where(
            AgentScheduleRow.id == schedule_id, AgentScheduleRow.agent_id == agent_id
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")

    if body.name is not None:
        row.name = body.name
    if body.prompt is not None:
        row.prompt = body.prompt
    if body.cron_expression is not None:
        row.cron_expression = body.cron_expression
    if body.enabled is not None:
        row.enabled = body.enabled

    await db.commit()
    return _to_dict(row)


@router.delete("/{agent_id}/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    agent_id: str,
    schedule_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentScheduleRow).where(
            AgentScheduleRow.id == schedule_id, AgentScheduleRow.agent_id == agent_id
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Schedule not found")
    await db.delete(row)
    await db.commit()


@router.post("/{agent_id}/schedules/{schedule_id}/run-now", status_code=202)
async def run_schedule_now(
    agent_id: str,
    schedule_id: str,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Trigger a scheduled agent run immediately (for testing / manual fire)."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentScheduleRow).where(
            AgentScheduleRow.id == schedule_id, AgentScheduleRow.agent_id == agent_id
        )
    )
    schedule = result.scalar_one_or_none()
    if not schedule:
        raise HTTPException(status_code=404, detail="Schedule not found")

    from scheduler import fire_schedule
    background_tasks.add_task(fire_schedule, schedule_id, tenant_id)
    return {"status": "queued", "schedule_id": schedule_id}
