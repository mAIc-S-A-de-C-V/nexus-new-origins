"""
Per-tenant app installs.

Endpoints (all require admin):
  GET    /app-installs                 — list installs for current tenant
  POST   /app-installs                 — install an app version (with scope grants + config)
  GET    /app-installs/{id}            — install detail
  PATCH  /app-installs/{id}            — change scopes / enabled / config
  DELETE /app-installs/{id}            — uninstall (cascade deletes KV, functions, runs)
  POST   /app-installs/{id}/token      — issue a fresh app-context JWT (used by host iframe init)
  GET    /app-installs/{id}/audit      — view audit log for this install
  GET    /apps-for-tenant/surfaces     — flat list of surfaces (pages/widgets/actions/slash) for nav rendering
"""
from __future__ import annotations
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, delete, desc
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth_middleware import require_auth, AuthUser
from database import (
    ExternalAppRow, ExternalAppVersionRow, ExternalAppInstallRow,
    ExternalAppKVRow, ExternalAppFunctionRow, ExternalAppAuditRow,
    get_session,
)
import audit as audit_helper
import jwt_app

router = APIRouter()


class InstallCreate(BaseModel):
    app_id: str
    version: str
    scopes_granted: list[str] = []
    scopes_denied: list[str] = []
    config: dict = {}


class InstallPatch(BaseModel):
    scopes_granted: Optional[list[str]] = None
    scopes_denied: Optional[list[str]] = None
    config: Optional[dict] = None
    enabled: Optional[bool] = None
    version: Optional[str] = None     # for upgrade


class InstallEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    tenant_id: str
    app_id: str
    version_pinned: str
    scopes_granted: list[str]
    scopes_denied: list[str]
    config: dict
    enabled: bool
    installed_by: str
    installed_by_email: Optional[str] = None
    installed_at: datetime
    updated_at: datetime


@router.get("/app-installs", response_model=list[InstallEntry])
async def list_installs(
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    rows = (await db.execute(
        select(ExternalAppInstallRow).where(ExternalAppInstallRow.tenant_id == user.tenant_id)
        .order_by(ExternalAppInstallRow.installed_at.desc())
    )).scalars().all()
    return rows


@router.post("/app-installs", response_model=InstallEntry, status_code=201)
async def install_app(
    body: InstallCreate,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_admin():
        raise HTTPException(403, "Only tenant admins can install apps")

    version_row = (await db.execute(
        select(ExternalAppVersionRow).where(
            ExternalAppVersionRow.app_id == body.app_id,
            ExternalAppVersionRow.version == body.version,
        )
    )).scalar_one_or_none()
    if not version_row:
        raise HTTPException(404, "Version not found")
    if version_row.yanked:
        raise HTTPException(400, f"Version {body.version} is yanked: {version_row.yanked_reason}")

    # Granted scopes must be a subset of required
    invalid = [s for s in body.scopes_granted if s not in (version_row.scopes_required or [])]
    if invalid:
        raise HTTPException(400, {"unknown_scopes": invalid, "allowed": version_row.scopes_required})

    # Reject reinstall — caller should upgrade or uninstall+install
    existing = (await db.execute(
        select(ExternalAppInstallRow).where(
            ExternalAppInstallRow.tenant_id == user.tenant_id,
            ExternalAppInstallRow.app_id == body.app_id,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, "App already installed in this tenant")

    install = ExternalAppInstallRow(
        id=str(uuid.uuid4()),
        tenant_id=user.tenant_id,
        app_id=body.app_id,
        version_pinned=body.version,
        scopes_granted=body.scopes_granted,
        scopes_denied=body.scopes_denied or
            [s for s in (version_row.scopes_required or []) if s not in body.scopes_granted],
        config=body.config,
        installed_by=user.id,
        installed_by_email=user.email,
    )
    db.add(install)

    # Materialize this version's server-side functions into our scheduler/registry
    for fn in version_row.functions or []:
        fn_row = ExternalAppFunctionRow(
            id=str(uuid.uuid4()),
            install_id=install.id,
            tenant_id=user.tenant_id,
            function_name=fn["name"],
            trigger_type=fn["trigger"]["type"],
            trigger_config=fn["trigger"],
            code=fn["code"],
            timeout_ms=fn.get("timeout_ms", 30000),
            enabled=True,
        )
        db.add(fn_row)

    await db.commit()
    await audit_helper.write_audit(
        db, tenant_id=user.tenant_id, install_id=install.id, app_id=body.app_id,
        user_id=user.id, event_type="install", status="ok",
        extras={"version": body.version, "scopes_granted": body.scopes_granted},
    )

    # Register schedules immediately
    try:
        from scheduler_runtime import register_install_schedules
        await register_install_schedules(install.id, db)
    except Exception:
        pass

    return install


@router.get("/app-installs/{install_id}", response_model=InstallEntry)
async def get_install(
    install_id: str,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    row = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == install_id,
        ExternalAppInstallRow.tenant_id == user.tenant_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Install not found")
    return row


@router.patch("/app-installs/{install_id}", response_model=InstallEntry)
async def patch_install(
    install_id: str,
    body: InstallPatch,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_admin():
        raise HTTPException(403, "Only tenant admins can modify installs")
    row = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == install_id,
        ExternalAppInstallRow.tenant_id == user.tenant_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Install not found")

    if body.version and body.version != row.version_pinned:
        # Upgrade path — load new version, clear/reload functions
        new_ver = (await db.execute(
            select(ExternalAppVersionRow).where(
                ExternalAppVersionRow.app_id == row.app_id,
                ExternalAppVersionRow.version == body.version,
            )
        )).scalar_one_or_none()
        if not new_ver:
            raise HTTPException(404, "Target version not found")
        if new_ver.yanked:
            raise HTTPException(400, "Target version is yanked")
        # New scopes_required may include extras — admin must explicitly grant
        invalid = [s for s in (body.scopes_granted or row.scopes_granted)
                   if s not in (new_ver.scopes_required or [])]
        if invalid:
            raise HTTPException(400, {"unknown_scopes": invalid})
        row.version_pinned = body.version
        await db.execute(delete(ExternalAppFunctionRow).where(ExternalAppFunctionRow.install_id == row.id))
        for fn in new_ver.functions or []:
            db.add(ExternalAppFunctionRow(
                id=str(uuid.uuid4()),
                install_id=row.id,
                tenant_id=user.tenant_id,
                function_name=fn["name"],
                trigger_type=fn["trigger"]["type"],
                trigger_config=fn["trigger"],
                code=fn["code"],
                timeout_ms=fn.get("timeout_ms", 30000),
                enabled=True,
            ))

    if body.scopes_granted is not None:
        row.scopes_granted = body.scopes_granted
    if body.scopes_denied is not None:
        row.scopes_denied = body.scopes_denied
    if body.config is not None:
        row.config = body.config
    if body.enabled is not None:
        row.enabled = body.enabled
    await db.commit()
    # onupdate=func.now() on updated_at means the server populates the new
    # value at commit time; we have to refresh so the response_model can
    # read it without triggering a lazy fetch outside the greenlet context.
    await db.refresh(row)

    await audit_helper.write_audit(
        db, tenant_id=user.tenant_id, install_id=row.id, app_id=row.app_id,
        user_id=user.id, event_type="patch", status="ok",
        extras=body.model_dump(exclude_none=True),
    )
    return row


@router.delete("/app-installs/{install_id}", status_code=204)
async def uninstall(
    install_id: str,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_admin():
        raise HTTPException(403, "Only tenant admins can uninstall")
    row = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == install_id,
        ExternalAppInstallRow.tenant_id == user.tenant_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Install not found")
    await db.execute(delete(ExternalAppKVRow).where(ExternalAppKVRow.install_id == install_id))
    await db.execute(delete(ExternalAppFunctionRow).where(ExternalAppFunctionRow.install_id == install_id))
    await db.delete(row)
    await db.commit()
    await audit_helper.write_audit(
        db, tenant_id=user.tenant_id, install_id=install_id, app_id=row.app_id,
        user_id=user.id, event_type="uninstall", status="ok",
    )


@router.post("/app-installs/{install_id}/token")
async def issue_token(
    install_id: str,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    """
    Mint a fresh app-context JWT for the iframe to use as its RPC credential.

    Flow:
      1. Host frontend renders iframe with NO token in URL
      2. iframe's <NexusProvider> posts {type:"ready"} via postMessage
      3. Host calls this endpoint, gets token + entry_url
      4. Host posts {type:"init", token, ...} into the iframe
    """
    row = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == install_id,
        ExternalAppInstallRow.tenant_id == user.tenant_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Install not found")
    if not row.enabled:
        raise HTTPException(403, "Install is disabled")

    version_row = (await db.execute(
        select(ExternalAppVersionRow).where(
            ExternalAppVersionRow.app_id == row.app_id,
            ExternalAppVersionRow.version == row.version_pinned,
        )
    )).scalar_one_or_none()
    if not version_row:
        raise HTTPException(500, "version_pinned no longer exists")
    if version_row.yanked:
        raise HTTPException(403, f"Version yanked: {version_row.yanked_reason}")

    # Derive iframe origin from entry_url (used for postMessage targetOrigin)
    from urllib.parse import urlparse
    parsed = urlparse(version_row.entry_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    token, exp = jwt_app.mint_app_token(
        install_id=row.id,
        app_id=row.app_id,
        tenant_id=user.tenant_id,
        user_id=user.id,
        user_email=user.email,
        user_role=user.role,
        scopes=row.scopes_granted,
        origin=origin,
    )
    return {
        "token": token,
        "expires_at": exp.isoformat(),
        "entry_url": version_row.entry_url,
        "origin": origin,
        "install_id": row.id,
        "app_id": row.app_id,
        "version": row.version_pinned,
        "config": row.config,
        "scopes_granted": row.scopes_granted,
    }


@router.get("/app-installs/{install_id}/audit")
async def get_install_audit(
    install_id: str,
    limit: int = 100,
    offset: int = 0,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    row = (await db.execute(select(ExternalAppInstallRow).where(
        ExternalAppInstallRow.id == install_id,
        ExternalAppInstallRow.tenant_id == user.tenant_id,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Install not found")
    rows = (await db.execute(
        select(ExternalAppAuditRow).where(ExternalAppAuditRow.install_id == install_id)
        .order_by(desc(ExternalAppAuditRow.occurred_at)).limit(min(limit, 1000)).offset(offset)
    )).scalars().all()
    return [{
        "id": r.id,
        "occurred_at": r.occurred_at.isoformat(),
        "event_type": r.event_type,
        "method": r.method,
        "scope_used": r.scope_used,
        "status": r.status,
        "latency_ms": r.latency_ms,
        "error_message": r.error_message,
        "user_id": r.user_id,
        "extras": r.extras,
    } for r in rows]


@router.get("/apps-for-tenant/surfaces")
async def tenant_surfaces(
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    """
    Flat list of (surface, install) pairs for the current tenant's installed,
    enabled apps. Used by NavRail / AppEditor widget catalog / object menus.
    """
    rows = (await db.execute(
        select(ExternalAppInstallRow, ExternalAppVersionRow)
        .join(
            ExternalAppVersionRow,
            (ExternalAppVersionRow.app_id == ExternalAppInstallRow.app_id) &
            (ExternalAppVersionRow.version == ExternalAppInstallRow.version_pinned),
        )
        .where(
            ExternalAppInstallRow.tenant_id == user.tenant_id,
            ExternalAppInstallRow.enabled.is_(True),
        )
    )).all()

    surfaces: list[dict] = []
    for install, version in rows:
        for s in version.surfaces or []:
            surfaces.append({
                "install_id": install.id,
                "app_id": install.app_id,
                "version": install.version_pinned,
                "display_name": version.manifest.get("display_name") or install.app_id,
                "icon": version.manifest.get("icon"),
                "surface": s,
            })
    return surfaces
