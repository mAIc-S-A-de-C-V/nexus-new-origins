"""
In-product Studio: build + publish an app without leaving the host UI.

Endpoints (admin-only, same auth as the marketplace publish endpoint):

  POST /app-studio/validate-code  Compile-check user TSX without publishing.
  POST /app-studio/publish        Compile + publish in one shot. Optionally
                                  also auto-install in the caller's tenant.

The Studio's wire shape mirrors the manifest schema with two studio-specific
extras: `main_tsx` and `extra_css`. The server fills in `entry` so the user
never has to compute the bundle URL.
"""
from __future__ import annotations
import json
import os
import uuid
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from shared.auth_middleware import require_auth, AuthUser
from database import (
    ExternalAppRow, ExternalAppVersionRow, ExternalAppInstallRow,
    ExternalAppFunctionRow, get_session,
)
from manifest_schema import validate_manifest
from scopes import validate_scope_list, CATALOG as SCOPES_CATALOG
import storage
import audit as audit_helper
import studio_builder

ONTOLOGY_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
AGENT_URL    = os.environ.get("AGENT_SERVICE_URL",    "http://agent-service:8013")

# Path to the AI_CONTEXT.md template inside the SDK source (mounted at image build time)
AI_CONTEXT_PATH = Path(os.environ.get("AI_CONTEXT_PATH", "/opt/nexus-apps-sdk/AI_CONTEXT.md"))

router = APIRouter()


APPS_PUBLIC_BASE = os.environ.get(
    "APP_BUNDLE_PUBLIC_BASE", "http://localhost:8028/apps/bundles"
)


class StudioPublishBody(BaseModel):
    app_id: str
    version: str
    display_name: str
    description: Optional[str] = ""
    icon: Optional[str] = ""
    publisher_id: Optional[str] = "studio"
    scopes: list[str] = []
    surfaces: list[dict] = []
    config_schema: Optional[dict] = None
    functions: list[dict] = []
    event_subscriptions: list[dict] = []

    # Studio-only
    main_tsx: str
    extra_css: Optional[str] = ""
    minify: bool = True
    install_after_publish: bool = False
    install_scopes_granted: Optional[list[str]] = None


class StudioValidateBody(BaseModel):
    main_tsx: str
    extra_css: Optional[str] = ""


@router.get("/ai-context", response_class=PlainTextResponse)
async def get_ai_context(
    user: AuthUser = Depends(require_auth),
):
    """
    Markdown brief for an LLM building a Nexus app. The static template lives
    in AI_CONTEXT.md (shipped with the SDK); this endpoint interpolates three
    live-tenant sections — object types, actions, agents — so the LLM has
    accurate ground truth instead of generic placeholders.

    Returned as text/markdown so it pastes cleanly into Claude/Cursor/ChatGPT.
    """
    if not AI_CONTEXT_PATH.exists():
        raise HTTPException(500, f"AI_CONTEXT.md not found at {AI_CONTEXT_PATH}")
    template = AI_CONTEXT_PATH.read_text(encoding="utf-8")

    # ── 1. Scope catalog table ────────────────────────────────────────
    scope_rows = []
    for s in SCOPES_CATALOG:
        scope_rows.append(f"| `{s.name}` | {s.description} | {'**SENSITIVE**' if s.sensitive else ''} |")
    template = template.replace("<!--SCOPES_TABLE-->", "\n".join(scope_rows))

    # ── 2. Live tenant: object types, actions, agents ──────────────────
    headers = {"x-tenant-id": user.tenant_id}
    obj_types_text = "(failed to load — service unreachable)"
    actions_text = "(failed to load — service unreachable)"
    agents_text = "(failed to load — service unreachable)"

    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
            if r.is_success:
                ots = r.json()
                obj_types_text = "\n".join([
                    f"- {ot.get('name'):<40s}  ({ot.get('display_name') or ot.get('name')})"
                    for ot in ots
                ]) or "(none in this tenant yet)"
        except Exception:
            pass

        try:
            r = await client.get(f"{ONTOLOGY_URL}/actions", headers=headers)
            if r.is_success:
                acts = r.json()
                lines = []
                for a in acts:
                    name = a.get("name") or ""
                    desc = (a.get("description") or "").replace("\n", " ").strip()
                    conf = " (requires_confirmation)" if a.get("requires_confirmation") else ""
                    lines.append(f"- {name}{conf}\n    {desc[:140]}")
                actions_text = "\n".join(lines) or "(none in this tenant yet)"
        except Exception:
            pass

        try:
            r = await client.get(f"{AGENT_URL}/agents", headers=headers)
            if r.is_success:
                ags = r.json() if isinstance(r.json(), list) else r.json().get("agents", [])
                lines = []
                for a in ags:
                    name = a.get("name") or a.get("id") or ""
                    desc = (a.get("description") or "").replace("\n", " ").strip()
                    lines.append(f"- {name}\n    {desc[:140]}")
                agents_text = "\n".join(lines) or "(none in this tenant yet)"
        except Exception:
            pass

    template = template.replace("<!--OBJECT_TYPES-->", obj_types_text)
    template = template.replace("<!--ACTIONS-->", actions_text)
    template = template.replace("<!--AGENTS-->", agents_text)

    # Stamp the tenant + generation time so the LLM knows when this was captured
    from datetime import datetime, timezone
    stamp = (
        f"\n\n---\n"
        f"_Generated for tenant `{user.tenant_id}` by `{user.email}` at "
        f"{datetime.now(timezone.utc).isoformat()}._\n"
    )

    return template + stamp


@router.post("/validate-code")
async def validate_code(
    body: StudioValidateBody,
    user: AuthUser = Depends(require_auth),
):
    """Compile-check TSX without writing anything. Cheap feedback loop for the editor."""
    try:
        result = studio_builder.build_bundle(
            main_tsx=body.main_tsx, extra_css=body.extra_css or "",
            title="Validate", minify=False,
        )
        return {
            "ok": True,
            "bundle_js_size": result.bundle_js_size,
            "warnings": result.warnings,
        }
    except studio_builder.BuildError as e:
        return {"ok": False, "error": str(e)}


@router.post("/publish")
async def studio_publish(
    body: StudioPublishBody,
    user: AuthUser = Depends(require_auth),
    db: AsyncSession = Depends(get_session),
):
    if not user.is_admin():
        raise HTTPException(403, "Only platform admins can publish apps")

    # Construct manifest from body, server-fills entry
    entry_url = f"{APPS_PUBLIC_BASE}/{body.app_id}/{body.version}/index.html"
    manifest = {
        "id": body.app_id,
        "version": body.version,
        "publisher_id": body.publisher_id or user.email or "studio",
        "display_name": body.display_name,
        "description": body.description or "",
        "entry": entry_url,
        "scopes": body.scopes or [],
        "surfaces": body.surfaces or [],
        "functions": body.functions or [],
        "event_subscriptions": body.event_subscriptions or [],
    }
    if body.icon:
        manifest["icon"] = body.icon
    if body.config_schema is not None:
        manifest["config_schema"] = body.config_schema

    errs = validate_manifest(manifest)
    if errs:
        raise HTTPException(400, {"manifest_errors": errs})

    bad_scopes = validate_scope_list(manifest.get("scopes") or [])
    if bad_scopes:
        raise HTTPException(400, {"unknown_scopes": bad_scopes})

    # Refuse duplicate version
    existing = (await db.execute(
        select(ExternalAppVersionRow).where(
            ExternalAppVersionRow.app_id == body.app_id,
            ExternalAppVersionRow.version == body.version,
        )
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(409, f"Version {body.version} of {body.app_id} already exists. Bump the version.")

    # Build the bundle
    try:
        result = studio_builder.build_bundle(
            main_tsx=body.main_tsx,
            extra_css=body.extra_css or "",
            title=body.display_name,
            minify=body.minify,
        )
    except studio_builder.BuildError as e:
        raise HTTPException(400, {"build_error": str(e)})

    tarball = studio_builder.pack_tarball(result.files)
    try:
        digest, rel_path, size = storage.stage_and_persist(body.app_id, body.version, tarball)
    except ValueError as e:
        raise HTTPException(400, str(e))

    # Upsert catalog
    app_row = (await db.execute(select(ExternalAppRow).where(ExternalAppRow.app_id == body.app_id))).scalar_one_or_none()
    if not app_row:
        app_row = ExternalAppRow(
            app_id=body.app_id,
            publisher_id=manifest["publisher_id"],
            display_name=body.display_name,
            description=body.description,
            icon_url=body.icon or None,
            latest_version=body.version,
            visibility="public",
        )
        db.add(app_row)
    else:
        app_row.display_name = body.display_name
        app_row.description = body.description
        app_row.icon_url = body.icon or None
        app_row.latest_version = body.version

    version_row = ExternalAppVersionRow(
        id=str(uuid.uuid4()),
        app_id=body.app_id,
        version=body.version,
        manifest=manifest,
        bundle_sha256=digest,
        bundle_path=rel_path,
        bundle_size_bytes=size,
        entry_url=entry_url,
        scopes_required=manifest["scopes"],
        surfaces=manifest["surfaces"],
        config_schema=manifest.get("config_schema"),
        functions=manifest["functions"],
        event_subscriptions=manifest["event_subscriptions"],
        published_by=user.email,
    )
    db.add(version_row)
    await db.commit()

    await audit_helper.write_audit(
        db, tenant_id="platform", install_id=None, app_id=body.app_id,
        user_id=user.id, event_type="publish", status="ok",
        extras={"version": body.version, "size_bytes": size, "via": "studio"},
    )

    install_id: Optional[str] = None
    if body.install_after_publish:
        # If the user didn't specify which scopes to grant, default to ALL requested.
        granted = body.install_scopes_granted if body.install_scopes_granted is not None else (manifest.get("scopes") or [])
        invalid = [s for s in granted if s not in (manifest.get("scopes") or [])]
        if invalid:
            raise HTTPException(400, {"unknown_scopes_for_install": invalid})

        existing_inst = (await db.execute(
            select(ExternalAppInstallRow).where(
                ExternalAppInstallRow.tenant_id == user.tenant_id,
                ExternalAppInstallRow.app_id == body.app_id,
            )
        )).scalar_one_or_none()
        if existing_inst:
            # Upgrade in-place
            existing_inst.version_pinned = body.version
            existing_inst.scopes_granted = granted
            existing_inst.scopes_denied = [s for s in (manifest.get("scopes") or []) if s not in granted]
            # Reset functions
            from sqlalchemy import delete as sa_delete
            await db.execute(sa_delete(ExternalAppFunctionRow).where(ExternalAppFunctionRow.install_id == existing_inst.id))
            for fn in manifest.get("functions") or []:
                db.add(ExternalAppFunctionRow(
                    id=str(uuid.uuid4()),
                    install_id=existing_inst.id, tenant_id=user.tenant_id,
                    function_name=fn["name"], trigger_type=fn["trigger"]["type"],
                    trigger_config=fn["trigger"], code=fn["code"],
                    timeout_ms=fn.get("timeout_ms", 30000), enabled=True,
                ))
            install_id = existing_inst.id
        else:
            new_inst = ExternalAppInstallRow(
                id=str(uuid.uuid4()),
                tenant_id=user.tenant_id,
                app_id=body.app_id,
                version_pinned=body.version,
                scopes_granted=granted,
                scopes_denied=[s for s in (manifest.get("scopes") or []) if s not in granted],
                config={}, installed_by=user.id, installed_by_email=user.email,
            )
            db.add(new_inst)
            for fn in manifest.get("functions") or []:
                db.add(ExternalAppFunctionRow(
                    id=str(uuid.uuid4()),
                    install_id=new_inst.id, tenant_id=user.tenant_id,
                    function_name=fn["name"], trigger_type=fn["trigger"]["type"],
                    trigger_config=fn["trigger"], code=fn["code"],
                    timeout_ms=fn.get("timeout_ms", 30000), enabled=True,
                ))
            install_id = new_inst.id
        await db.commit()

        try:
            from scheduler_runtime import register_install_schedules
            await register_install_schedules(install_id, db)
        except Exception:
            pass

    return {
        "ok": True,
        "app_id": body.app_id,
        "version": body.version,
        "sha256": digest,
        "size_bytes": size,
        "bundle_js_size": result.bundle_js_size,
        "warnings": result.warnings,
        "install_id": install_id,
    }
