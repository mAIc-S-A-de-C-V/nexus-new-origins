from typing import Optional
from datetime import datetime, timezone, timedelta
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from pydantic import BaseModel
from database import AppRow, get_session

router = APIRouter()

EPHEMERAL_TTL_DAYS = 7


class AppCreateRequest(BaseModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    object_type_id: str = ""
    object_type_ids: list[str] = []
    components: list[dict] = []
    # Phase G — distinguishes 'dashboard' vs 'app'. Defaults to 'dashboard'.
    kind: Optional[str] = "dashboard"
    # Phase H/I — declared actions / variables / events live in settings,
    # but accept them at the top level for convenience and stash on save.
    settings: Optional[dict] = None
    # Phase E — flag to mark a generated dashboard as ephemeral. The
    # backend computes expires_at from EPHEMERAL_TTL_DAYS.
    is_ephemeral: Optional[bool] = False
    parent_app_id: Optional[str] = None
    generated_from_widget_id: Optional[str] = None
    # Phase J — system dashboards.
    is_system: Optional[bool] = False
    slug: Optional[str] = None


class AppUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    object_type_ids: Optional[list[str]] = None
    components: Optional[list[dict]] = None
    settings: Optional[dict] = None
    kind: Optional[str] = None
    is_ephemeral: Optional[bool] = None
    expires_at: Optional[datetime] = None


def _row_to_dict(row: AppRow) -> dict:
    ot_ids = row.object_type_ids or ([row.object_type_id] if row.object_type_id else [])
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "icon": row.icon,
        "object_type_id": ot_ids[0] if ot_ids else "",
        "object_type_ids": ot_ids,
        "components": row.components or [],
        "settings": row.settings or {},
        "kind": row.kind or "dashboard",
        "is_ephemeral": bool(row.is_ephemeral),
        "parent_app_id": row.parent_app_id,
        "generated_from_widget_id": row.generated_from_widget_id,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "is_system": bool(row.is_system),
        "slug": row.slug,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
async def list_apps(
    object_type_id: Optional[str] = None,
    kind: Optional[str] = None,
    include_ephemeral: bool = False,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(AppRow).where(AppRow.tenant_id == tenant_id)
    if object_type_id:
        stmt = stmt.where(AppRow.object_type_id == object_type_id)
    if kind:
        stmt = stmt.where(AppRow.kind == kind)
    if not include_ephemeral:
        # Hide ephemeral generated dashboards from the main list — they
        # surface in their own "Recently generated" section instead.
        stmt = stmt.where(or_(AppRow.is_ephemeral == False, AppRow.is_ephemeral.is_(None)))  # noqa: E712
    stmt = stmt.order_by(AppRow.created_at.desc())
    result = await db.execute(stmt)
    return [_row_to_dict(r) for r in result.scalars().all()]


@router.get("/recent-generated")
async def list_recent_generated(
    limit: int = 20,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Phase E — recently generated ephemeral dashboards, newest first."""
    tenant_id = x_tenant_id or "tenant-001"
    stmt = (
        select(AppRow)
        .where(AppRow.tenant_id == tenant_id, AppRow.is_ephemeral == True)  # noqa: E712
        .order_by(AppRow.created_at.desc())
        .limit(max(1, min(limit, 100)))
    )
    result = await db.execute(stmt)
    return [_row_to_dict(r) for r in result.scalars().all()]


@router.get("/by-slug/{slug}")
async def get_app_by_slug(
    slug: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Phase J — fetch a system dashboard by slug (e.g. 'dashboards-home')."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AppRow).where(AppRow.tenant_id == tenant_id, AppRow.slug == slug)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="App not found")
    return _row_to_dict(row)


@router.post("", status_code=201)
async def create_app(
    req: AppCreateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    ot_ids = req.object_type_ids or ([req.object_type_id] if req.object_type_id else [])
    expires_at = None
    if req.is_ephemeral:
        expires_at = datetime.now(timezone.utc) + timedelta(days=EPHEMERAL_TTL_DAYS)
    row = AppRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=req.name,
        description=req.description,
        icon=req.icon,
        object_type_id=ot_ids[0] if ot_ids else "",
        object_type_ids=ot_ids,
        components=req.components,
        settings=req.settings or {},
        kind=req.kind or "dashboard",
        is_ephemeral=bool(req.is_ephemeral),
        parent_app_id=req.parent_app_id,
        generated_from_widget_id=req.generated_from_widget_id,
        expires_at=expires_at,
        is_system=bool(req.is_system),
        slug=req.slug,
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
    if req.object_type_ids is not None:
        row.object_type_ids = req.object_type_ids
        row.object_type_id = req.object_type_ids[0] if req.object_type_ids else row.object_type_id
    if req.components is not None:
        row.components = req.components
    if req.settings is not None:
        row.settings = req.settings
    if req.kind is not None:
        row.kind = req.kind
    if req.is_ephemeral is not None:
        row.is_ephemeral = req.is_ephemeral
        # Clearing the ephemeral flag also clears the expiry so cron sweeps
        # don't reap a freshly-promoted dashboard.
        if not req.is_ephemeral:
            row.expires_at = None
    if req.expires_at is not None:
        row.expires_at = req.expires_at

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.post("/{app_id}/save-permanently")
async def save_permanently(
    app_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Phase E — promote an ephemeral generated dashboard to permanent."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AppRow).where(AppRow.id == app_id, AppRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="App not found")
    row.is_ephemeral = False
    row.expires_at = None
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
    if row.is_system:
        raise HTTPException(status_code=403, detail="System dashboards cannot be deleted")
    await db.delete(row)
    await db.commit()
