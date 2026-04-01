"""
Logic Function CRUD + execution endpoints.
"""
from typing import Optional, Any
from datetime import datetime, timezone
from uuid import uuid4
import asyncio
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import LogicFunctionRow, LogicRunRow, get_session
from runner import execute_function

router = APIRouter()


# ── Pydantic models ───────────────────────────────────────────────────────────

class InputFieldSchema(BaseModel):
    name: str
    type: str  # string | number | boolean | object | array
    description: Optional[str] = None
    object_type: Optional[str] = None
    required: bool = True


class LogicFunctionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    input_schema: list[InputFieldSchema] = []
    blocks: list[dict[str, Any]] = []
    output_block: Optional[str] = None


class LogicFunctionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    input_schema: Optional[list[InputFieldSchema]] = None
    blocks: Optional[list[dict[str, Any]]] = None
    output_block: Optional[str] = None


class RunRequest(BaseModel):
    inputs: dict[str, Any] = {}
    triggered_by: Optional[str] = "manual"


# ── Serializers ───────────────────────────────────────────────────────────────

def _fn_to_dict(row: LogicFunctionRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "input_schema": row.input_schema or [],
        "blocks": row.blocks or [],
        "output_block": row.output_block,
        "version": row.version,
        "status": row.status,
        "published_version": row.published_version,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _run_to_dict(row: LogicRunRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "function_id": row.function_id,
        "function_version": row.function_version,
        "inputs": row.inputs or {},
        "status": row.status,
        "trace": row.trace,
        "output": row.output,
        "error": row.error,
        "triggered_by": row.triggered_by,
        "started_at": row.started_at.isoformat() if row.started_at else None,
        "finished_at": row.finished_at.isoformat() if row.finished_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.get("")
async def list_functions(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow)
        .where(LogicFunctionRow.tenant_id == tenant_id)
        .order_by(LogicFunctionRow.created_at.desc())
    )
    return [_fn_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_function(
    body: LogicFunctionCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = LogicFunctionRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        input_schema=[f.model_dump() for f in body.input_schema],
        blocks=body.blocks,
        output_block=body.output_block,
        version=1,
        status="draft",
    )
    db.add(row)
    await db.commit()
    return _fn_to_dict(row)


@router.get("/{function_id}")
async def get_function(
    function_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow).where(
            LogicFunctionRow.id == function_id,
            LogicFunctionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Logic function not found")
    return _fn_to_dict(row)


@router.put("/{function_id}")
async def update_function(
    function_id: str,
    body: LogicFunctionUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow).where(
            LogicFunctionRow.id == function_id,
            LogicFunctionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Logic function not found")

    if body.name is not None:
        row.name = body.name
    if body.description is not None:
        row.description = body.description
    if body.input_schema is not None:
        row.input_schema = [f.model_dump() for f in body.input_schema]
    if body.blocks is not None:
        row.blocks = body.blocks
    if body.output_block is not None:
        row.output_block = body.output_block

    # Bump version on each save (draft edits don't lock version)
    row.version = (row.version or 1) + 1
    await db.commit()
    return _fn_to_dict(row)


@router.delete("/{function_id}", status_code=204)
async def delete_function(
    function_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow).where(
            LogicFunctionRow.id == function_id,
            LogicFunctionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Logic function not found")
    await db.delete(row)
    await db.commit()


# ── Publish ───────────────────────────────────────────────────────────────────

@router.post("/{function_id}/publish")
async def publish_function(
    function_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Lock current version as published — this is the version agents/callers use."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow).where(
            LogicFunctionRow.id == function_id,
            LogicFunctionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Logic function not found")
    if not row.blocks:
        raise HTTPException(status_code=400, detail="Cannot publish a function with no blocks")
    if not row.output_block:
        raise HTTPException(status_code=400, detail="Cannot publish a function with no output block set")

    row.status = "published"
    row.published_version = row.version
    await db.commit()
    return _fn_to_dict(row)


# ── Execute ───────────────────────────────────────────────────────────────────

async def _do_run(run_id: str, function_id: str, blocks: list, output_block: str, inputs: dict, tenant_id: str, version: int):
    """Background task: run the function and update the run row."""
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        # Mark as running
        result = await db.execute(select(LogicRunRow).where(LogicRunRow.id == run_id))
        run_row = result.scalar_one_or_none()
        if not run_row:
            return
        run_row.status = "running"
        run_row.started_at = datetime.now(timezone.utc)
        await db.commit()

        try:
            outcome = await execute_function(function_id, blocks, output_block, inputs, tenant_id)
            run_row.status = "failed" if outcome.get("error") else "completed"
            run_row.trace = outcome.get("trace")
            run_row.output = outcome.get("output")
            run_row.error = outcome.get("error")
        except Exception as e:
            run_row.status = "failed"
            run_row.error = str(e)
        finally:
            run_row.finished_at = datetime.now(timezone.utc)
            await db.commit()


@router.post("/{function_id}/run", status_code=202)
async def run_function(
    function_id: str,
    body: RunRequest,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Kick off async execution. Returns run_id immediately."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow).where(
            LogicFunctionRow.id == function_id,
            LogicFunctionRow.tenant_id == tenant_id,
        )
    )
    fn_row = result.scalar_one_or_none()
    if not fn_row:
        raise HTTPException(status_code=404, detail="Logic function not found")

    run_id = str(uuid4())
    run_row = LogicRunRow(
        id=run_id,
        tenant_id=tenant_id,
        function_id=function_id,
        function_version=fn_row.version or 1,
        inputs=body.inputs,
        status="pending",
        triggered_by=body.triggered_by,
    )
    db.add(run_row)
    await db.commit()

    background_tasks.add_task(
        _do_run,
        run_id,
        function_id,
        fn_row.blocks or [],
        fn_row.output_block or "",
        body.inputs,
        tenant_id,
        fn_row.version or 1,
    )

    return {"run_id": run_id, "status": "pending"}


@router.post("/{function_id}/run/sync")
async def run_function_sync(
    function_id: str,
    body: RunRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Synchronous execution — waits for result (useful for Logic Studio debugger)."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicFunctionRow).where(
            LogicFunctionRow.id == function_id,
            LogicFunctionRow.tenant_id == tenant_id,
        )
    )
    fn_row = result.scalar_one_or_none()
    if not fn_row:
        raise HTTPException(status_code=404, detail="Logic function not found")

    run_id = str(uuid4())
    run_row = LogicRunRow(
        id=run_id,
        tenant_id=tenant_id,
        function_id=function_id,
        function_version=fn_row.version or 1,
        inputs=body.inputs,
        status="running",
        triggered_by=body.triggered_by,
        started_at=datetime.now(timezone.utc),
    )
    db.add(run_row)
    await db.commit()

    outcome = await execute_function(
        function_id,
        fn_row.blocks or [],
        fn_row.output_block or "",
        body.inputs,
        tenant_id,
    )

    run_row.status = "failed" if outcome.get("error") else "completed"
    run_row.trace = outcome.get("trace")
    run_row.output = outcome.get("output")
    run_row.error = outcome.get("error")
    run_row.finished_at = datetime.now(timezone.utc)
    await db.commit()

    return {**_run_to_dict(run_row), **outcome}
