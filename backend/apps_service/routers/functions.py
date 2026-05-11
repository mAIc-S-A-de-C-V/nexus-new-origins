"""
Server-side function management + manual invocation.

  GET    /apps/functions                  — list functions for current tenant's installs
  POST   /apps/functions/{id}/run         — trigger a manual run
  GET    /apps/functions/{id}/runs        — list past runs
  GET    /apps/functions/runs/{run_id}    — one run with logs + output
  POST   /apps/events/ingest              — webhook receiver, fans out to subscribed functions
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth_middleware import AuthUser
from auth_dep import require_apps_auth as require_auth
from database import (
    ExternalAppFunctionRow, ExternalAppRunRow, ExternalAppInstallRow,
    ExternalAppVersionRow, get_session,
)
import scheduler_runtime

router = APIRouter()


class FunctionEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    install_id: str
    tenant_id: str
    function_name: str
    trigger_type: str
    trigger_config: dict
    timeout_ms: int
    enabled: bool
    last_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = None
    created_at: datetime


class RunEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    function_id: str
    install_id: str
    tenant_id: str
    trigger: str
    input: Optional[dict] = None
    output: Optional[dict] = None
    logs: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    duration_ms: Optional[int] = None
    started_at: datetime
    finished_at: Optional[datetime] = None


@router.get("/functions", response_model=list[FunctionEntry])
async def list_functions(
    install_id: Optional[str] = None,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    q = select(ExternalAppFunctionRow).where(ExternalAppFunctionRow.tenant_id == user.tenant_id)
    if install_id:
        q = q.where(ExternalAppFunctionRow.install_id == install_id)
    rows = (await db.execute(q)).scalars().all()
    return rows


@router.post("/functions/{function_id}/run")
async def manual_run(
    function_id: str,
    body: dict | None = None,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    fn = (await db.execute(
        select(ExternalAppFunctionRow).where(
            ExternalAppFunctionRow.id == function_id,
            ExternalAppFunctionRow.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not fn:
        raise HTTPException(404, "function not found")
    if not user.is_admin():
        raise HTTPException(403, "admin only")
    inputs = (body or {}).get("inputs") or {}
    run_id = await scheduler_runtime.run_function_now(function_id, trigger="manual", inputs=inputs)
    return {"run_id": run_id}


@router.get("/functions/{function_id}/runs", response_model=list[RunEntry])
async def list_runs(
    function_id: str,
    limit: int = 50,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    rows = (await db.execute(
        select(ExternalAppRunRow).where(
            ExternalAppRunRow.function_id == function_id,
            ExternalAppRunRow.tenant_id == user.tenant_id,
        ).order_by(desc(ExternalAppRunRow.started_at)).limit(min(limit, 200))
    )).scalars().all()
    return rows


@router.get("/functions/runs/{run_id}", response_model=RunEntry)
async def get_run(
    run_id: str,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    row = (await db.execute(
        select(ExternalAppRunRow).where(
            ExternalAppRunRow.id == run_id,
            ExternalAppRunRow.tenant_id == user.tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "run not found")
    return row


class EventIngest(BaseModel):
    event: str                  # e.g. "record.changed", "action.executed"
    object_type: Optional[str] = None
    payload: dict = {}


@router.post("/events/ingest")
async def ingest_event(
    body: EventIngest,
    x_internal: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Internal endpoint called by ontology-service / agent-service when interesting
    things happen. Fans out to installed apps whose manifest subscribes.

    Auth: internal-only (X-Internal header). Caller is responsible for already
    having authenticated the actor that produced the event.
    """
    if not x_internal:
        raise HTTPException(403, "internal-only endpoint")

    # Find function rows whose parent version subscribes to this event
    rows = (await db.execute(
        select(ExternalAppFunctionRow, ExternalAppInstallRow, ExternalAppVersionRow)
        .join(ExternalAppInstallRow, ExternalAppInstallRow.id == ExternalAppFunctionRow.install_id)
        .join(
            ExternalAppVersionRow,
            (ExternalAppVersionRow.app_id == ExternalAppInstallRow.app_id) &
            (ExternalAppVersionRow.version == ExternalAppInstallRow.version_pinned),
        )
        .where(
            ExternalAppFunctionRow.trigger_type == "webhook",
            ExternalAppFunctionRow.enabled.is_(True),
            ExternalAppInstallRow.enabled.is_(True),
        )
    )).all()

    matched: list[str] = []
    for fn, install, version in rows:
        subs = version.event_subscriptions or []
        for sub in subs:
            if sub.get("event") != body.event:
                continue
            if sub.get("object_type") and sub["object_type"] != body.object_type:
                continue
            if sub.get("function") and sub["function"] != fn.function_name:
                continue
            # Fire-and-forget: do not block the ingest call
            import asyncio
            asyncio.create_task(scheduler_runtime.run_function_now(
                fn.id, trigger="webhook",
                inputs={"event": body.event, "object_type": body.object_type},
                event=body.payload,
            ))
            matched.append(fn.id)
            break

    return {"fanned_out_to": matched, "count": len(matched)}
