from typing import Optional
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from database import AppRow, get_session

router = APIRouter()


class AppCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    object_type_id: str
    components: list[dict] = []


class AppUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    components: Optional[list[dict]] = None


def _row_to_dict(row: AppRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "icon": row.icon,
        "object_type_id": row.object_type_id,
        "components": row.components or [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
async def list_apps(
    object_type_id: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(AppRow).where(AppRow.tenant_id == tenant_id)
    if object_type_id:
        stmt = stmt.where(AppRow.object_type_id == object_type_id)
    stmt = stmt.order_by(AppRow.created_at.desc())
    result = await db.execute(stmt)
    return [_row_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_app(
    req: AppCreateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = AppRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=req.name,
        description=req.description,
        icon=req.icon,
        object_type_id=req.object_type_id,
        components=req.components,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.get("/{app_id}")
async def get_app(
    app_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AppRow).where(AppRow.id == app_id, AppRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="App not found")
    return _row_to_dict(row)


@router.put("/{app_id}")
async def update_app(
    app_id: str,
    req: AppUpdateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AppRow).where(AppRow.id == app_id, AppRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="App not found")

    if req.name is not None:
        row.name = req.name
    if req.description is not None:
        row.description = req.description
    if req.icon is not None:
        row.icon = req.icon
    if req.components is not None:
        row.components = req.components

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{app_id}", status_code=204)
async def delete_app(
    app_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AppRow).where(AppRow.id == app_id, AppRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="App not found")
    await db.delete(row)
    await db.commit()
