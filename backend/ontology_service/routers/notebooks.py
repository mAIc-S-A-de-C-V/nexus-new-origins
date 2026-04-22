from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from database import NotebookRow, get_session

router = APIRouter()


class NotebookCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    cells: list[dict] = []


class NotebookUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    cells: Optional[list[dict]] = None


def _row_to_dict(row: NotebookRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "cells": row.cells or [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
async def list_notebooks(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(NotebookRow).where(NotebookRow.tenant_id == tenant_id).order_by(NotebookRow.updated_at.desc())
    result = await db.execute(stmt)
    return [_row_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_notebook(
    req: NotebookCreateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = NotebookRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=req.name,
        description=req.description,
        cells=req.cells,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.get("/{notebook_id}")
async def get_notebook(
    notebook_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(NotebookRow).where(NotebookRow.id == notebook_id, NotebookRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return _row_to_dict(row)


@router.put("/{notebook_id}")
async def update_notebook(
    notebook_id: str,
    req: NotebookUpdateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(NotebookRow).where(NotebookRow.id == notebook_id, NotebookRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Notebook not found")

    if req.name is not None:
        row.name = req.name
    if req.description is not None:
        row.description = req.description
    if req.cells is not None:
        row.cells = req.cells

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(NotebookRow).where(NotebookRow.id == notebook_id, NotebookRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Notebook not found")
    await db.delete(row)
    await db.commit()
