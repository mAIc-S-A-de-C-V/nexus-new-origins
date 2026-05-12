"""
Tenant quota management endpoints.

Reads:
  GET /app-quotas/me              — caller's effective tenant quota + usage
  GET /app-quotas                 — list all tenant quotas (superadmin)
  GET /app-quotas/{tenant_id}     — one tenant's quota (superadmin)

Writes (superadmin only):
  PATCH /app-quotas/{tenant_id}   — set tier and/or explicit limits
  GET   /app-quotas/tiers         — known tier presets (anyone)
"""
from __future__ import annotations
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth_middleware import AuthUser
from auth_dep import require_apps_auth as require_auth
from database import TenantAppQuotaRow, get_session
from quotas import (
    TIER_PRESETS, get_or_create_quota, count_enabled_installs,
    count_published_apps,
)

router = APIRouter()


class QuotaResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    tenant_id: str
    tier: str
    max_apps_installed: int
    max_apps_published: int
    apps_installed: int = 0
    apps_published: int = 0
    notes: Optional[str] = None


async def _quota_with_usage(db: AsyncSession, tenant_id: str) -> QuotaResponse:
    q = await get_or_create_quota(db, tenant_id)
    installed = await count_enabled_installs(db, tenant_id)
    published = await count_published_apps(db, tenant_id)
    return QuotaResponse(
        tenant_id=q.tenant_id, tier=q.tier,
        max_apps_installed=q.max_apps_installed,
        max_apps_published=q.max_apps_published,
        apps_installed=installed,
        apps_published=published,
        notes=q.notes,
    )


@router.get("/me", response_model=QuotaResponse)
async def my_quota(
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    return await _quota_with_usage(db, user.tenant_id)


@router.get("/tiers")
async def list_tiers(user: AuthUser = Depends(require_auth)):
    """Anyone can see what tiers exist + their preset caps."""
    return TIER_PRESETS


@router.get("", response_model=list[QuotaResponse])
async def list_quotas(
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_superadmin():
        raise HTTPException(403, "Only superadmins can list all tenant quotas")
    rows = (await db.execute(select(TenantAppQuotaRow).order_by(TenantAppQuotaRow.tenant_id))).scalars().all()
    out = []
    for r in rows:
        installed = await count_enabled_installs(db, r.tenant_id)
        published = await count_published_apps(db, r.tenant_id)
        out.append(QuotaResponse(
            tenant_id=r.tenant_id, tier=r.tier,
            max_apps_installed=r.max_apps_installed,
            max_apps_published=r.max_apps_published,
            apps_installed=installed,
            apps_published=published,
            notes=r.notes,
        ))
    return out


@router.get("/{tenant_id}", response_model=QuotaResponse)
async def get_quota(
    tenant_id: str,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_superadmin() and user.tenant_id != tenant_id:
        raise HTTPException(403, "Only superadmins can read other tenants' quotas")
    return await _quota_with_usage(db, tenant_id)


class QuotaPatch(BaseModel):
    tier: Optional[str] = None
    max_apps_installed: Optional[int] = None
    max_apps_published: Optional[int] = None
    notes: Optional[str] = None


@router.patch("/{tenant_id}", response_model=QuotaResponse)
async def patch_quota(
    tenant_id: str,
    body: QuotaPatch,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_superadmin():
        raise HTTPException(403, "Only superadmins can change tenant quotas")
    row = await get_or_create_quota(db, tenant_id)
    if body.tier is not None:
        if body.tier not in TIER_PRESETS:
            raise HTTPException(400, f"Unknown tier '{body.tier}'. Known: {sorted(TIER_PRESETS)}")
        row.tier = body.tier
        preset = TIER_PRESETS[body.tier]
        # Auto-apply preset values unless explicit overrides are also sent.
        if body.max_apps_installed is None:
            row.max_apps_installed = preset["max_apps_installed"]
        if body.max_apps_published is None:
            row.max_apps_published = preset["max_apps_published"]
    if body.max_apps_installed is not None:
        row.max_apps_installed = body.max_apps_installed
    if body.max_apps_published is not None:
        row.max_apps_published = body.max_apps_published
    if body.notes is not None:
        row.notes = body.notes
    row.updated_by = user.email
    await db.commit()
    await db.refresh(row)
    return await _quota_with_usage(db, tenant_id)
