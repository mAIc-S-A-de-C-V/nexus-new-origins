"""
Logic Run history endpoints.
"""
from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import LogicRunRow, get_session

router = APIRouter()


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


@router.get("")
async def list_runs(
    function_id: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 50,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    q = select(LogicRunRow).where(LogicRunRow.tenant_id == tenant_id)
    if function_id:
        q = q.where(LogicRunRow.function_id == function_id)
    if status:
        q = q.where(LogicRunRow.status == status)
    q = q.order_by(LogicRunRow.created_at.desc()).limit(limit)
    result = await db.execute(q)
    return [_run_to_dict(r) for r in result.scalars().all()]


@router.get("/{run_id}")
async def get_run(
    run_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(LogicRunRow).where(
            LogicRunRow.id == run_id,
            LogicRunRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Run not found")
    return _run_to_dict(row)
