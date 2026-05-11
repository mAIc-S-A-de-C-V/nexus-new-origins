"""
App marketplace catalog.

Endpoints:
  GET  /app-registry/apps              — list catalog entries
  GET  /app-registry/apps/{id}         — one entry + its versions
  POST /app-registry/publish           — publish a new version (multipart: manifest + bundle)
  POST /app-registry/{id}/yank/{ver}   — yank a version (still installed for tenants who chose it,
                                          but new tenants can't install)
  GET  /apps/bundles/{path}            — static serve of extracted bundle assets

Auth: publishing requires platform-admin role; reading is open within auth.
"""
from __future__ import annotations
import io
import json
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Header, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth_middleware import require_auth, AuthUser
from database import ExternalAppRow, ExternalAppVersionRow, get_session
from manifest_schema import validate_manifest
from scopes import validate_scope_list
import storage
import audit as audit_helper

router = APIRouter()


class AppCatalogEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    app_id: str
    publisher_id: str
    display_name: str
    description: Optional[str] = None
    icon_url: Optional[str] = None
    homepage_url: Optional[str] = None
    latest_version: Optional[str] = None
    visibility: str
    tenant_allowlist: list[str] = []
    created_at: datetime
    updated_at: datetime


def _is_visible_to(app_row: ExternalAppRow, user) -> bool:
    """Catalog visibility check.

    - Superadmin sees everything (so they can manage the allowlist).
    - Non-public visibility hides from everyone except superadmin.
    - Empty allowlist = visible to every tenant (default).
    - Non-empty allowlist = only listed tenants see it.
    """
    if user.is_superadmin():
        return True
    if (app_row.visibility or "public") != "public":
        return False
    allow = list(app_row.tenant_allowlist or [])
    if not allow:
        return True
    return user.tenant_id in allow


class AppVersionEntry(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    app_id: str
    version: str
    manifest: dict
    bundle_sha256: str
    bundle_size_bytes: int
    entry_url: str
    scopes_required: list[str]
    surfaces: list[dict]
    config_schema: Optional[dict] = None
    functions: list[dict]
    event_subscriptions: list[dict]
    published_at: datetime
    yanked: bool


@router.get("/apps", response_model=list[AppCatalogEntry])
async def list_catalog(
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    rows = (await db.execute(select(ExternalAppRow).order_by(ExternalAppRow.display_name))).scalars().all()
    return [r for r in rows if _is_visible_to(r, user)]


@router.get("/apps/{app_id}")
async def get_app_with_versions(
    app_id: str,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    app_row = (await db.execute(select(ExternalAppRow).where(ExternalAppRow.app_id == app_id))).scalar_one_or_none()
    if not app_row:
        raise HTTPException(404, f"App '{app_id}' not found")
    if not _is_visible_to(app_row, user):
        # Same response as not-found — don't leak existence to non-allowed tenants
        raise HTTPException(404, f"App '{app_id}' not found")
    versions = (await db.execute(
        select(ExternalAppVersionRow).where(ExternalAppVersionRow.app_id == app_id)
        .order_by(desc(ExternalAppVersionRow.published_at))
    )).scalars().all()
    return {
        "app": AppCatalogEntry.model_validate(app_row),
        "versions": [AppVersionEntry.model_validate(v) for v in versions],
    }


class AppPatchBody(BaseModel):
    visibility: Optional[str] = None
    tenant_allowlist: Optional[list[str]] = None


@router.patch("/apps/{app_id}", response_model=AppCatalogEntry)
async def patch_app(
    app_id: str,
    body: AppPatchBody,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    """
    Manage who can see an app. Superadmin-only — this is a platform-level
    decision, not a per-tenant one.

    - visibility: "public" | "private" | "unlisted"
    - tenant_allowlist: list of tenant_id strings. Empty = public to all.
    """
    if not user.is_superadmin():
        raise HTTPException(403, "Only superadmins can change app visibility")
    row = (await db.execute(select(ExternalAppRow).where(ExternalAppRow.app_id == app_id))).scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"App '{app_id}' not found")
    if body.visibility is not None:
        if body.visibility not in ("public", "private", "unlisted"):
            raise HTTPException(400, "visibility must be public | private | unlisted")
        row.visibility = body.visibility
    if body.tenant_allowlist is not None:
        # de-dupe + drop empty strings
        cleaned = sorted({t.strip() for t in body.tenant_allowlist if t and t.strip()})
        row.tenant_allowlist = cleaned
    await db.commit()
    await db.refresh(row)

    await audit_helper.write_audit(
        db, tenant_id="platform", install_id=None, app_id=app_id,
        user_id=user.id, event_type="catalog.patch", status="ok",
        extras={"visibility": row.visibility, "tenant_allowlist": row.tenant_allowlist},
    )
    return row


@router.post("/publish")
async def publish_version(
    request: Request,
    manifest_json: str = Form(...),
    bundle: UploadFile = File(...),
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    """
    Publish a new immutable version. Caller must be admin or superadmin.

    Form fields:
      manifest_json — the full app manifest as a JSON string
      bundle        — gzipped tarball of the built app (index.html + assets)
    """
    if not user.is_admin():
        raise HTTPException(403, "Only platform admins can publish apps")

    try:
        manifest = json.loads(manifest_json)
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"manifest_json is not valid JSON: {e}")

    errs = validate_manifest(manifest)
    if errs:
        raise HTTPException(400, {"manifest_errors": errs})

    bad_scopes = validate_scope_list(manifest.get("scopes") or [])
    if bad_scopes:
        raise HTTPException(400, {"unknown_scopes": bad_scopes})

    app_id = manifest["id"]
    version = manifest["version"]
    publisher_id = manifest["publisher_id"]

    # Reject duplicate version (immutability)
    existing = (await db.execute(
        select(ExternalAppVersionRow).where(
            ExternalAppVersionRow.app_id == app_id,
            ExternalAppVersionRow.version == version,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Version {version} of {app_id} already exists. Bump the version.")

    data = await bundle.read()
    try:
        digest, rel_path, size = storage.stage_and_persist(app_id, version, data)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Verify the bundle contains index.html at the top level
    files = storage.list_bundle_files(rel_path)
    if "index.html" not in files and not any(f.endswith("/index.html") for f in files):
        storage.delete_bundle(rel_path)
        raise HTTPException(400, "bundle must contain index.html at root")

    entry_url = manifest["entry"]

    # Upsert the catalog row
    app_row = (await db.execute(select(ExternalAppRow).where(ExternalAppRow.app_id == app_id))).scalar_one_or_none()
    if not app_row:
        app_row = ExternalAppRow(
            app_id=app_id,
            publisher_id=publisher_id,
            display_name=manifest["display_name"],
            description=manifest.get("description"),
            icon_url=manifest.get("icon"),
            homepage_url=manifest.get("homepage"),
            latest_version=version,
            visibility="public",
        )
        db.add(app_row)
    else:
        if app_row.publisher_id != publisher_id:
            raise HTTPException(403, "publisher_id mismatch")
        app_row.display_name = manifest["display_name"]
        app_row.description = manifest.get("description")
        app_row.icon_url = manifest.get("icon")
        app_row.homepage_url = manifest.get("homepage")
        app_row.latest_version = version

    version_row = ExternalAppVersionRow(
        id=str(uuid.uuid4()),
        app_id=app_id,
        version=version,
        manifest=manifest,
        bundle_sha256=digest,
        bundle_path=rel_path,
        bundle_size_bytes=size,
        entry_url=entry_url,
        scopes_required=manifest.get("scopes") or [],
        surfaces=manifest.get("surfaces") or [],
        config_schema=manifest.get("config_schema"),
        functions=manifest.get("functions") or [],
        event_subscriptions=manifest.get("event_subscriptions") or [],
        published_by=user.email,
    )
    db.add(version_row)
    await db.commit()

    await audit_helper.write_audit(
        db, tenant_id="platform", install_id=None, app_id=app_id,
        user_id=user.id, event_type="publish", status="ok",
        extras={"version": version, "size_bytes": size, "sha256": digest},
    )

    return {
        "app_id": app_id,
        "version": version,
        "sha256": digest,
        "size_bytes": size,
        "bundle_url": storage.public_url(rel_path),
    }


@router.post("/apps/{app_id}/yank/{version}")
async def yank_version(
    app_id: str,
    version: str,
    reason: str = "",
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_admin():
        raise HTTPException(403, "Only platform admins can yank")
    row = (await db.execute(
        select(ExternalAppVersionRow).where(
            ExternalAppVersionRow.app_id == app_id,
            ExternalAppVersionRow.version == version,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "version not found")
    row.yanked = True
    row.yanked_reason = reason
    await db.commit()
    return {"yanked": True}


@router.get("/bundles/{app_id}/{version}/{filename:path}")
async def serve_bundle_asset(
    app_id: str,
    version: str,
    filename: str,
    db: AsyncSession = Depends(get_session),
):
    """
    Static-serve the extracted contents of a published bundle.

    For dev: serves at http://localhost:8028/apps/bundles/<app_id>/<version>/<file>.
    Production should put a CDN in front of this or swap storage for S3+CloudFront.

    Auth: open, because iframe origin needs to load these without credentials.
    The bundle itself is just static UI — security is enforced at the RPC gateway,
    not at asset load.
    """
    row = (await db.execute(
        select(ExternalAppVersionRow).where(
            ExternalAppVersionRow.app_id == app_id,
            ExternalAppVersionRow.version == version,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(404, "version not found")

    extracted = storage.extract_dir_for(app_id, version, row.bundle_sha256)
    target = (extracted / filename).resolve()
    try:
        target.relative_to(extracted.resolve())
    except ValueError:
        raise HTTPException(400, "path escapes bundle")
    if not target.exists() or not target.is_file():
        # SPA fallback — return index.html for unknown routes
        index = extracted / "index.html"
        if index.exists():
            return FileResponse(index)
        raise HTTPException(404, "file not found")
    return FileResponse(target)
