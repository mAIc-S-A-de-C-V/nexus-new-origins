"""
Pipeline trigger endpoints — CRUD + the internal event receiver that
pipeline_service POSTs to when a run completes.
"""
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    AgentConfigRow,
    PipelineTriggerRow,
    get_session,
)
from triggers import fire_event, fire_trigger

router = APIRouter()

VALID_OPS = {
    "eq", "ne", "gt", "gte", "lt", "lte",
    "in", "not_in", "contains", "starts_with", "ends_with",
    "is_null", "is_not_null",
}
VALID_MODES = {"per_row", "per_batch"}


# ── Schemas ──────────────────────────────────────────────────────────────────

class FilterClause(BaseModel):
    field: str
    op: str = "eq"
    value: Optional[object] = None


class TriggerCreate(BaseModel):
    name: str
    pipeline_id: str
    agent_id: str
    on_new_only: bool = True
    min_new_rows: int = 1
    mode: str = "per_row"
    max_concurrent: int = 5
    prompt_template: str = ""
    row_filter: list[FilterClause] = Field(default_factory=list)
    dedupe_action_name: Optional[str] = None
    dedupe_field: Optional[str] = None
    enabled: bool = True


class TriggerUpdate(BaseModel):
    name: Optional[str] = None
    pipeline_id: Optional[str] = None
    agent_id: Optional[str] = None
    on_new_only: Optional[bool] = None
    min_new_rows: Optional[int] = None
    mode: Optional[str] = None
    max_concurrent: Optional[int] = None
    prompt_template: Optional[str] = None
    row_filter: Optional[list[FilterClause]] = None
    dedupe_action_name: Optional[str] = None
    dedupe_field: Optional[str] = None
    enabled: Optional[bool] = None


class PipelineEvent(BaseModel):
    """Internal payload from pipeline_service after a run completes."""
    tenant_id: str
    pipeline_id: str
    run_id: str
    object_type: str
    new_row_ids: list[str] = Field(default_factory=list)
    all_row_ids: list[str] = Field(default_factory=list)


def _to_dict(row: PipelineTriggerRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "pipeline_id": row.pipeline_id,
        "agent_id": row.agent_id,
        "on_new_only": row.on_new_only,
        "min_new_rows": row.min_new_rows,
        "mode": row.mode,
        "max_concurrent": row.max_concurrent,
        "prompt_template": row.prompt_template,
        "row_filter": list(row.row_filter or []),
        "dedupe_action_name": row.dedupe_action_name,
        "dedupe_field": row.dedupe_field,
        "enabled": row.enabled,
        "last_fired_at": row.last_fired_at.isoformat() if row.last_fired_at else None,
        "last_fire_summary": row.last_fire_summary,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _validate_clauses(clauses: list[FilterClause]) -> None:
    for c in clauses:
        if c.op not in VALID_OPS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid filter op '{c.op}'. Allowed: {sorted(VALID_OPS)}",
            )


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("")
async def list_triggers(
    pipeline_id: Optional[str] = None,
    agent_id: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(PipelineTriggerRow).where(PipelineTriggerRow.tenant_id == tenant_id)
    if pipeline_id:
        stmt = stmt.where(PipelineTriggerRow.pipeline_id == pipeline_id)
    if agent_id:
        stmt = stmt.where(PipelineTriggerRow.agent_id == agent_id)
    stmt = stmt.order_by(PipelineTriggerRow.created_at.desc())
    result = await db.execute(stmt)
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_trigger(
    body: TriggerCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if body.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {VALID_MODES}")
    _validate_clauses(body.row_filter)

    # Sanity: agent must exist and belong to tenant
    agent_row = (await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == body.agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not agent_row:
        raise HTTPException(status_code=400, detail="agent_id not found in this tenant")

    row = PipelineTriggerRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        pipeline_id=body.pipeline_id,
        agent_id=body.agent_id,
        on_new_only=body.on_new_only,
        min_new_rows=max(1, body.min_new_rows),
        mode=body.mode,
        max_concurrent=max(1, body.max_concurrent),
        prompt_template=body.prompt_template or "",
        row_filter=[c.model_dump() for c in body.row_filter],
        dedupe_action_name=body.dedupe_action_name,
        dedupe_field=body.dedupe_field,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.get("/{trigger_id}")
async def get_trigger(
    trigger_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = (await db.execute(
        select(PipelineTriggerRow).where(
            PipelineTriggerRow.id == trigger_id,
            PipelineTriggerRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")
    return _to_dict(row)


@router.put("/{trigger_id}")
async def update_trigger(
    trigger_id: str,
    body: TriggerUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = (await db.execute(
        select(PipelineTriggerRow).where(
            PipelineTriggerRow.id == trigger_id,
            PipelineTriggerRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")

    if body.mode is not None and body.mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of {VALID_MODES}")
    if body.row_filter is not None:
        _validate_clauses(body.row_filter)

    for field in (
        "name", "pipeline_id", "agent_id", "on_new_only", "min_new_rows",
        "mode", "max_concurrent", "prompt_template",
        "dedupe_action_name", "dedupe_field", "enabled",
    ):
        v = getattr(body, field)
        if v is not None:
            if field == "min_new_rows":
                v = max(1, int(v))
            elif field == "max_concurrent":
                v = max(1, int(v))
            setattr(row, field, v)
    if body.row_filter is not None:
        row.row_filter = [c.model_dump() for c in body.row_filter]
    await db.commit()
    return _to_dict(row)


@router.delete("/{trigger_id}", status_code=204)
async def delete_trigger(
    trigger_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = (await db.execute(
        select(PipelineTriggerRow).where(
            PipelineTriggerRow.id == trigger_id,
            PipelineTriggerRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")
    await db.delete(row)
    await db.commit()


# ── Manual test fire ─────────────────────────────────────────────────────────

class TestFireBody(BaseModel):
    new_row_ids: list[str] = Field(default_factory=list)
    all_row_ids: list[str] = Field(default_factory=list)
    object_type: Optional[str] = None
    run_id: Optional[str] = None


@router.post("/{trigger_id}/test-fire")
async def test_fire(
    trigger_id: str,
    body: TestFireBody,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Manually fire a trigger with a supplied set of row IDs. Useful for
    UI 'try it' buttons and for backfilling a trigger over historical rows."""
    tenant_id = x_tenant_id or "tenant-001"
    row = (await db.execute(
        select(PipelineTriggerRow).where(
            PipelineTriggerRow.id == trigger_id,
            PipelineTriggerRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Trigger not found")

    summary = await fire_trigger(
        row,
        pipeline_id=row.pipeline_id,
        run_id=body.run_id or "manual-test",
        object_type=body.object_type or "",
        new_row_ids=body.new_row_ids,
        all_row_ids=body.all_row_ids or body.new_row_ids,
    )
    # Persist last_fired_at etc.
    from datetime import datetime, timezone as _tz
    row.last_fired_at = datetime.now(_tz.utc)
    row.last_fire_summary = {k: v for k, v in summary.items() if k != "trigger_id"}
    await db.commit()
    return summary


# ── Internal: pipeline-event receiver ────────────────────────────────────────

@router.post("/internal/pipeline-event", status_code=202)
async def pipeline_event(
    body: PipelineEvent,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_session),
):
    """Called by pipeline_service when a run completes. Fires every enabled
    trigger that's bound to this pipeline. Returns 202 immediately and does
    the work in the background so we don't hold up the pipeline service."""

    async def _run():
        # Use a fresh session — the request session may be closed by then
        from database import AsyncSessionLocal
        async with AsyncSessionLocal() as inner:
            try:
                await fire_event(
                    db=inner,
                    tenant_id=body.tenant_id,
                    pipeline_id=body.pipeline_id,
                    run_id=body.run_id,
                    object_type=body.object_type,
                    new_row_ids=body.new_row_ids,
                    all_row_ids=body.all_row_ids,
                )
            except Exception:
                import logging
                logging.getLogger(__name__).exception("pipeline-event handler failed")

    background.add_task(_run)
    return {"accepted": True}
