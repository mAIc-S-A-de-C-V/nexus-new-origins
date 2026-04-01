"""
Logic Function Schedule Router
CRUD for recurring schedules + APScheduler wiring.
"""
import uuid
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from database import get_session, LogicScheduleRow, LogicFunctionRow
from scheduler import get_scheduler, register_schedule, remove_schedule

router = APIRouter()


class ScheduleCreate(BaseModel):
    cron: str
    label: str | None = None
    inputs: dict[str, Any] = {}
    enabled: bool = True


class ScheduleUpdate(BaseModel):
    cron: str | None = None
    label: str | None = None
    inputs: dict[str, Any] | None = None
    enabled: bool | None = None


class ScheduleOut(BaseModel):
    id: str
    tenant_id: str
    function_id: str
    cron: str
    label: str | None
    inputs: dict
    enabled: bool
    last_run_at: datetime | None
    created_at: datetime


@router.get("/{function_id}/schedules", response_model=list[ScheduleOut])
async def list_schedules(
    function_id: str,
    session: AsyncSession = Depends(get_session),
    tenant_id: str = "tenant-001",
):
    rows = await session.execute(
        select(LogicScheduleRow).where(
            LogicScheduleRow.function_id == function_id,
            LogicScheduleRow.tenant_id == tenant_id,
        )
    )
    return rows.scalars().all()


@router.post("/{function_id}/schedules", response_model=ScheduleOut, status_code=201)
async def create_schedule(
    function_id: str,
    body: ScheduleCreate,
    session: AsyncSession = Depends(get_session),
    tenant_id: str = "tenant-001",
):
    # Verify function exists
    fn = await session.get(LogicFunctionRow, function_id)
    if not fn or fn.tenant_id != tenant_id:
        raise HTTPException(404, "Function not found")

    row = LogicScheduleRow(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        function_id=function_id,
        cron=body.cron,
        label=body.label,
        inputs=body.inputs,
        enabled=body.enabled,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)

    if row.enabled:
        register_schedule(row)

    return row


@router.patch("/{function_id}/schedules/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(
    function_id: str,
    schedule_id: str,
    body: ScheduleUpdate,
    session: AsyncSession = Depends(get_session),
    tenant_id: str = "tenant-001",
):
    row = await session.get(LogicScheduleRow, schedule_id)
    if not row or row.function_id != function_id or row.tenant_id != tenant_id:
        raise HTTPException(404, "Schedule not found")

    if body.cron is not None:
        row.cron = body.cron
    if body.label is not None:
        row.label = body.label
    if body.inputs is not None:
        row.inputs = body.inputs
    if body.enabled is not None:
        row.enabled = body.enabled

    await session.commit()
    await session.refresh(row)

    # Re-register or remove from APScheduler
    remove_schedule(schedule_id)
    if row.enabled:
        register_schedule(row)

    return row


@router.delete("/{function_id}/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    function_id: str,
    schedule_id: str,
    session: AsyncSession = Depends(get_session),
    tenant_id: str = "tenant-001",
):
    row = await session.get(LogicScheduleRow, schedule_id)
    if not row or row.function_id != function_id or row.tenant_id != tenant_id:
        raise HTTPException(404, "Schedule not found")

    remove_schedule(schedule_id)
    await session.delete(row)
    await session.commit()
