"""
External app sharing — share links for forms (submit-mode) and dashboards
(view-mode), with password / expiry / max-uses / scope / branding controls.

Two surfaces:

Authenticated (creator side, JWT + tenant header required, mounted at /shares
via main.py with require_auth dependency):
    POST   /shares/apps/{app_id}/shares     create
    GET    /shares/apps/{app_id}/shares     list
    PATCH  /shares/{share_id}               update
    DELETE /shares/{share_id}               revoke

Public (no JWT — token IS the auth, mounted at /s without dependency):
    GET    /s/{token}                       gate metadata
    POST   /s/{token}/auth                  exchange password -> session JWT
    GET    /s/{token}/app                   resolve pinned snapshot
    GET    /s/{token}/records               proxy list_records w/ scope
    POST   /s/{token}/aggregate             proxy aggregate_records w/ scope
    POST   /s/{token}/submit                run a submit-mode action
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    AppRow,
    AppShareRedemptionRow,
    AppShareRow,
    AppVersionRow,
    ObjectRecordRow,
    get_session,
)
from shared.auth_middleware import AuthUser, require_auth
from routers.records import (
    _build_jsonb_filters,
    AggregateRequest,
    build_aggregate_sql,
)
import share_utils as su

log = logging.getLogger("ontology.shares")


# ── Authenticated (creator) router ─────────────────────────────────────────

creator_router = APIRouter()


class ShareCreateRequest(BaseModel):
    name: str
    mode: str = "submit"  # 'submit' | 'view'
    access_mode: str = "public"  # 'public' | 'password' | 'email_whitelist' | 'nexus_user'
    password: Optional[str] = None  # plain — hashed before storage
    whitelist_emails: list[str] = Field(default_factory=list)
    max_uses: Optional[int] = None
    count_what: str = "submissions"
    expires_at: Optional[datetime] = None
    data_scope: Optional[dict] = None
    branding: Optional[dict] = None
    rate_limit_qps: int = 10


class ShareUpdateRequest(BaseModel):
    name: Optional[str] = None
    access_mode: Optional[str] = None
    password: Optional[str] = None
    whitelist_emails: Optional[list[str]] = None
    max_uses: Optional[int] = None
    expires_at: Optional[datetime] = None
    data_scope: Optional[dict] = None
    branding: Optional[dict] = None
    rate_limit_qps: Optional[int] = None
    revoked: Optional[bool] = None


def _share_to_dict(row: AppShareRow, include_token: bool = True) -> dict:
    out = {
        "id": row.id,
        "app_id": row.app_id,
        "app_version_id": row.app_version_id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "mode": row.mode,
        "access_mode": row.access_mode,
        "has_password": bool(row.password_hash),
        "whitelist_emails": row.whitelist_emails or [],
        "max_uses": row.max_uses,
        "use_count": row.use_count or 0,
        "count_what": row.count_what,
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "data_scope": row.data_scope or {},
        "branding": row.branding or {},
        "rate_limit_qps": row.rate_limit_qps,
        "created_by_user_id": row.created_by_user_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if include_token:
        out["token"] = row.token
    return out


async def _snapshot_app_version(db: AsyncSession, app_row: AppRow) -> AppVersionRow:
    """Freeze the current app state into a new app_versions row. Lazy: each
    share creates its own snapshot, no continuous version history yet."""
    last = await db.execute(
        select(AppVersionRow.version)
        .where(AppVersionRow.app_id == app_row.id)
        .order_by(AppVersionRow.version.desc())
        .limit(1)
    )
    last_v = last.scalar() or 0
    version = AppVersionRow(
        id=str(uuid4()),
        app_id=app_row.id,
        tenant_id=app_row.tenant_id,
        version=last_v + 1,
        name=app_row.name,
        description=app_row.description,
        icon=app_row.icon,
        object_type_id=app_row.object_type_id or "",
        object_type_ids=app_row.object_type_ids or [],
        components=app_row.components or [],
        settings=app_row.settings or {},
        kind=app_row.kind or "dashboard",
    )
    db.add(version)
    await db.flush()
    return version


@creator_router.post("/apps/{app_id}/shares", status_code=201)
async def create_share(
    app_id: str,
    req: ShareCreateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    tenant_id = x_tenant_id or user.tenant_id or "tenant-001"
    app_result = await db.execute(
        select(AppRow).where(AppRow.id == app_id, AppRow.tenant_id == tenant_id)
    )
    app_row = app_result.scalar_one_or_none()
    if not app_row:
        raise HTTPException(404, "App not found")

    if req.mode not in ("submit", "view"):
        raise HTTPException(400, "mode must be 'submit' or 'view'")
    if req.access_mode not in ("public", "password", "email_whitelist", "nexus_user"):
        raise HTTPException(400, "Invalid access_mode")
    if req.access_mode == "password" and not req.password:
        raise HTTPException(400, "Password required for access_mode='password'")

    version = await _snapshot_app_version(db, app_row)

    row = AppShareRow(
        id=str(uuid4()),
        token=su.new_share_token(),
        app_id=app_id,
        app_version_id=version.id,
        tenant_id=tenant_id,
        name=req.name,
        mode=req.mode,
        access_mode=req.access_mode,
        password_hash=su.hash_password(req.password) if req.password else None,
        whitelist_emails=req.whitelist_emails or [],
        max_uses=req.max_uses,
        use_count=0,
        count_what=req.count_what,
        expires_at=req.expires_at,
        data_scope=req.data_scope or {},
        branding=req.branding or {},
        rate_limit_qps=max(1, min(req.rate_limit_qps, 1000)),
        created_by_user_id=user.id,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _share_to_dict(row)


@creator_router.get("/apps/{app_id}/shares")
async def list_shares(
    app_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    tenant_id = x_tenant_id or user.tenant_id or "tenant-001"
    res = await db.execute(
        select(AppShareRow)
        .where(AppShareRow.app_id == app_id, AppShareRow.tenant_id == tenant_id)
        .order_by(AppShareRow.created_at.desc())
    )
    return [_share_to_dict(r) for r in res.scalars().all()]


@creator_router.patch("/{share_id}")
async def update_share(
    share_id: str,
    req: ShareUpdateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    tenant_id = x_tenant_id or user.tenant_id or "tenant-001"
    res = await db.execute(
        select(AppShareRow).where(
            AppShareRow.id == share_id, AppShareRow.tenant_id == tenant_id
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Share not found")

    if req.name is not None:
        row.name = req.name
    if req.access_mode is not None:
        if req.access_mode not in ("public", "password", "email_whitelist", "nexus_user"):
            raise HTTPException(400, "Invalid access_mode")
        row.access_mode = req.access_mode
    if req.password is not None:
        row.password_hash = su.hash_password(req.password) if req.password else None
    if req.whitelist_emails is not None:
        row.whitelist_emails = req.whitelist_emails
    if req.max_uses is not None:
        row.max_uses = req.max_uses
    if req.expires_at is not None:
        row.expires_at = req.expires_at
    if req.data_scope is not None:
        row.data_scope = req.data_scope
    if req.branding is not None:
        row.branding = req.branding
    if req.rate_limit_qps is not None:
        row.rate_limit_qps = max(1, min(req.rate_limit_qps, 1000))
    if req.revoked is True and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
    elif req.revoked is False:
        row.revoked_at = None

    await db.commit()
    await db.refresh(row)
    return _share_to_dict(row)


@creator_router.delete("/{share_id}", status_code=204)
async def delete_share(
    share_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """Hard delete — also drops redemption rows. Use PATCH revoked=true if
    you want to keep the audit trail."""
    tenant_id = x_tenant_id or user.tenant_id or "tenant-001"
    res = await db.execute(
        select(AppShareRow).where(
            AppShareRow.id == share_id, AppShareRow.tenant_id == tenant_id
        )
    )
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Share not found")
    await db.delete(row)
    await db.commit()


# ── Public (token-only) router ─────────────────────────────────────────────
#
# Mounted WITHOUT require_auth. Tenant comes from the share row itself, never
# from the client. Order of validation in every handler:
#   1. Look up share by token.
#   2. Check revoked / expired / exhausted.
#   3. Check QPS bucket.
#   4. (auth/data/submit) Verify share-session JWT or password.
#   5. Apply scope filters and dispatch.

public_router = APIRouter()


class AuthRequest(BaseModel):
    password: Optional[str] = None
    email: Optional[str] = None


class SubmitRequest(BaseModel):
    action_id: str
    inputs: dict[str, Any] = Field(default_factory=dict)


async def _load_share_by_token(db: AsyncSession, token: str) -> AppShareRow:
    res = await db.execute(select(AppShareRow).where(AppShareRow.token == token))
    row = res.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Share not found")
    return row


async def _load_pinned_version(db: AsyncSession, share: AppShareRow) -> AppVersionRow:
    res = await db.execute(
        select(AppVersionRow).where(AppVersionRow.id == share.app_version_id)
    )
    v = res.scalar_one_or_none()
    if not v:
        raise HTTPException(500, "Pinned version missing")
    return v


def _check_usable_or_400(share: AppShareRow) -> None:
    ok, reason = su.is_share_usable(
        share.revoked_at, share.expires_at, share.use_count or 0, share.max_uses
    )
    if not ok:
        raise HTTPException(410, f"Share unavailable: {reason}")


def _require_qps(share: AppShareRow, kind: str) -> None:
    if not su.take_qps_token(share.id, kind, share.rate_limit_qps or 10):
        raise HTTPException(429, "Rate limit exceeded")


def _require_session_for_share(
    share: AppShareRow, x_share_session: Optional[str]
) -> dict:
    """Validate the share-session JWT, ensure it matches this share, and
    return the decoded payload. Public-mode shares get an implicit session
    to keep the calling pattern uniform."""
    if share.access_mode == "public" and not x_share_session:
        # Fast-path: anyone with the token has access.
        return {"share_id": share.id, "tenant_id": share.tenant_id, "mode": share.mode, "app_id": share.app_id}
    if not x_share_session:
        raise HTTPException(401, "Share session required")
    payload = su.decode_share_session(x_share_session)
    if not payload or payload.get("share_id") != share.id:
        raise HTTPException(401, "Invalid share session")
    return payload


@public_router.get("/{token}")
async def share_gate(token: str, db: AsyncSession = Depends(get_session)):
    """Initial probe — tells the public viewer what to render (password gate,
    expired screen, etc.). Returns NO app contents."""
    share = await _load_share_by_token(db, token)
    ok, reason = su.is_share_usable(
        share.revoked_at, share.expires_at, share.use_count or 0, share.max_uses
    )
    return {
        "ok": ok,
        "reason": reason,
        "mode": share.mode,
        "access_mode": share.access_mode,
        "name": share.name,
        "branding": share.branding or {},
        "expires_at": share.expires_at.isoformat() if share.expires_at else None,
    }


@public_router.post("/{token}/auth")
async def share_auth(
    token: str,
    body: AuthRequest,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    share = await _load_share_by_token(db, token)
    _check_usable_or_400(share)

    if su.is_auth_locked(share.auth_locked_until):
        raise HTTPException(429, "Too many failed attempts — try again later")

    # Per-share QPS bucket — protects against credential-stuffing bursts.
    _require_qps(share, "auth")

    if share.access_mode == "public":
        # No challenge needed; still mint a session to give viewers a token
        # they can pass with subsequent requests if they want consistency.
        session = su.issue_share_session(share.id, share.tenant_id, share.mode, share.app_id)
        return {"session": session, "ttl_min": su.SHARE_SESSION_TTL_MIN}

    if share.access_mode == "password":
        if not body.password or not share.password_hash:
            raise HTTPException(400, "Password required")
        if not su.verify_password(body.password, share.password_hash):
            share.auth_failures = (share.auth_failures or 0) + 1
            if share.auth_failures >= su.AUTH_LOCKOUT_THRESHOLD:
                share.auth_locked_until = su.next_lockout_until()
                share.auth_failures = 0
            await db.commit()
            raise HTTPException(401, "Wrong password")
        share.auth_failures = 0
        share.auth_locked_until = None
        await db.commit()
        session = su.issue_share_session(share.id, share.tenant_id, share.mode, share.app_id)
        return {"session": session, "ttl_min": su.SHARE_SESSION_TTL_MIN}

    if share.access_mode == "email_whitelist":
        # v1: trust the email field. Magic-link delivery is Phase 4 from the plan.
        if not body.email:
            raise HTTPException(400, "Email required")
        if body.email.lower() not in [e.lower() for e in (share.whitelist_emails or [])]:
            raise HTTPException(403, "Email not on whitelist")
        session = su.issue_share_session(share.id, share.tenant_id, share.mode, share.app_id)
        return {"session": session, "ttl_min": su.SHARE_SESSION_TTL_MIN}

    raise HTTPException(400, f"Unsupported access_mode: {share.access_mode}")


def _strip_admin_fields(version: AppVersionRow) -> dict:
    """Send the snapshot to the public viewer with only what the client needs
    to render. Internal IDs (parent_app_id, generated_from_widget_id, etc.)
    aren't on the version row by design — keeps the surface narrow."""
    return {
        "id": version.app_id,  # the share viewer sees app_id, not version id
        "name": version.name,
        "description": version.description or "",
        "icon": version.icon or "",
        "components": version.components or [],
        "object_type_ids": version.object_type_ids or [],
        "settings": version.settings or {},
        "kind": version.kind or "dashboard",
    }


@public_router.get("/{token}/app")
async def share_app(
    token: str,
    x_share_session: Optional[str] = Header(None, alias="X-Share-Session"),
    db: AsyncSession = Depends(get_session),
):
    share = await _load_share_by_token(db, token)
    _check_usable_or_400(share)
    _require_qps(share, "app")
    _require_session_for_share(share, x_share_session)
    version = await _load_pinned_version(db, share)
    return _strip_admin_fields(version)


@public_router.get("/{token}/records")
async def share_records(
    token: str,
    ot: str = Query(..., description="Object type id"),
    filter: Optional[str] = Query(None),
    sort_field: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query("asc"),
    limit: int = Query(50, ge=1, le=10000),
    offset: int = Query(0, ge=0),
    x_share_session: Optional[str] = Header(None, alias="X-Share-Session"),
    db: AsyncSession = Depends(get_session),
):
    """Public proxy for list_records. Re-implemented inline to keep the
    surface tight — we never hand the share session to the underlying handler.
    Scope filters are merged BEFORE the JSONB parse."""
    share = await _load_share_by_token(db, token)
    _check_usable_or_400(share)
    _require_qps(share, "data")
    _require_session_for_share(share, x_share_session)

    if share.mode != "view":
        raise HTTPException(403, "This share is submit-only")

    version = await _load_pinned_version(db, share)
    if not su.scope_allows_object_type(version.object_type_ids or [], ot):
        raise HTTPException(403, "Object type not in this share's scope")

    # Merge data_scope filters (server-side, after auth, before query).
    scope = share.data_scope or {}
    merged_filter = su.merge_filter_json(filter, scope.get("filters"))

    # Reuse the existing list_records implementation logic. Inline the parts
    # we need rather than re-call to avoid the require_auth dependency.
    from sqlalchemy import func as sa_func, text

    base_where = [
        ObjectRecordRow.object_type_id == ot,
        ObjectRecordRow.tenant_id == share.tenant_id,
    ]
    if merged_filter:
        base_where.extend(_build_jsonb_filters(merged_filter))

    count_q = select(sa_func.count(ObjectRecordRow.id)).where(*base_where)
    total = (await db.execute(count_q)).scalar() or 0

    q = select(ObjectRecordRow).where(*base_where)
    if sort_field:
        safe_sort = sort_field.replace("'", "''")
        direction = "DESC" if sort_dir and sort_dir.lower() == "desc" else "ASC"
        q = q.order_by(text(f"data->>'{safe_sort}' {direction}"))
    else:
        q = q.order_by(ObjectRecordRow.updated_at.desc())
    q = q.limit(limit).offset(offset)

    res = await db.execute(q)
    rows = res.scalars().all()
    return {
        "records": [r.data for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@public_router.post("/{token}/aggregate")
async def share_aggregate(
    token: str,
    request: Request,
    ot: str = Query(...),
    x_share_session: Optional[str] = Header(None, alias="X-Share-Session"),
    db: AsyncSession = Depends(get_session),
):
    """Public proxy for the aggregate endpoint. Re-uses the same builder, but
    merges scope filters into the body before dispatch."""
    share = await _load_share_by_token(db, token)
    _check_usable_or_400(share)
    _require_qps(share, "data")
    _require_session_for_share(share, x_share_session)

    if share.mode != "view":
        raise HTTPException(403, "This share is submit-only")

    version = await _load_pinned_version(db, share)
    if not su.scope_allows_object_type(version.object_type_ids or [], ot):
        raise HTTPException(403, "Object type not in this share's scope")

    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "Invalid body")

    # Merge scope filters into the body.filters dict (scope wins).
    scope = share.data_scope or {}
    scope_filters = scope.get("filters") or {}
    user_filters = body.get("filters") or {}
    if isinstance(user_filters, dict):
        merged = {**user_filters, **scope_filters}
    else:
        merged = scope_filters
    body["filters"] = merged

    try:
        agg_req = AggregateRequest(**body)
    except Exception as e:
        raise HTTPException(400, f"Invalid aggregate request: {e}")

    sql, params = build_aggregate_sql(agg_req, share.tenant_id, ot)
    from sqlalchemy import text as sa_text
    res = await db.execute(sa_text(sql), params)
    rows = [dict(r._mapping) for r in res.all()]
    return {"rows": rows}


@public_router.post("/{token}/submit")
async def share_submit(
    token: str,
    body: SubmitRequest,
    request: Request,
    x_share_session: Optional[str] = Header(None, alias="X-Share-Session"),
    db: AsyncSession = Depends(get_session),
):
    """Submit-mode action runner. Atomically:
       1. Re-checks usability under a row lock.
       2. Validates action_id is present in the snapshot's settings.actions.
       3. Executes a 'createObject' (only kind supported in v1).
       4. Inserts a redemption row + bumps use_count in the same transaction.
    """
    share = await _load_share_by_token(db, token)
    _check_usable_or_400(share)
    _require_qps(share, "submit")
    _require_session_for_share(share, x_share_session)

    if share.mode != "submit":
        raise HTTPException(403, "This share is view-only")

    version = await _load_pinned_version(db, share)
    actions = (version.settings or {}).get("actions", []) or []
    action = next((a for a in actions if a.get("id") == body.action_id), None)
    if not action:
        raise HTTPException(404, "Action not found in this share's snapshot")

    kind = action.get("kind")
    if kind != "createObject":
        # Other kinds (updateObject, deleteObject, callUtility, runWorkflow,
        # webhook) are deferred — they need more careful gating before we
        # let public callers fire them.
        raise HTTPException(400, f"Action kind '{kind}' not supported in shares yet")

    target_ot = action.get("objectTypeId")
    if not su.scope_allows_object_type(version.object_type_ids or [], target_ot):
        raise HTTPException(403, "Action target outside share scope")

    # Re-lock the share row + atomic increment. Rejects bypass of single-use.
    locked = await db.execute(
        select(AppShareRow).where(AppShareRow.id == share.id).with_for_update()
    )
    locked_share = locked.scalar_one()
    ok, reason = su.is_share_usable(
        locked_share.revoked_at, locked_share.expires_at,
        locked_share.use_count or 0, locked_share.max_uses,
    )
    if not ok:
        raise HTTPException(410, f"Share unavailable: {reason}")

    # Translate inputs through the action's field mappings into the record
    # data dict. Same shape the in-app form path uses. Variables (e.g. the
    # process-flow widget's serialized JSON) arrive merged into body.inputs
    # keyed by variable id; transform='fromVariable' resolves them.
    field_mappings = action.get("fieldMappings") or []
    record_data: dict[str, Any] = {}
    for fm in field_mappings:
        target = fm.get("targetProperty")
        if not target:
            continue
        transform = fm.get("transform")
        if transform == "literal":
            record_data[target] = fm.get("literalValue")
            continue
        if transform == "fromVariable":
            var_id = fm.get("sourceVariableId") or fm.get("formField")
            record_data[target] = body.inputs.get(var_id) if var_id else None
            continue
        form_field = fm.get("formField")
        if not form_field:
            continue
        v = body.inputs.get(form_field)
        if transform == "asNumber":
            try:
                v = float(v) if v not in (None, "") else None
            except (TypeError, ValueError):
                v = None
        elif transform == "asDate":
            v = str(v) if v else None
        record_data[target] = v
    # Preserve any inputs that didn't match a mapping — same as the in-app form,
    # which sends inputs through unmodified when no mappings are declared.
    if not field_mappings:
        record_data = dict(body.inputs)

    submission_id = str(uuid4())
    new_record = ObjectRecordRow(
        id=submission_id,
        object_type_id=target_ot,
        tenant_id=share.tenant_id,
        source_id=submission_id,
        data=record_data,
    )
    db.add(new_record)

    redemption = AppShareRedemptionRow(
        id=str(uuid4()),
        share_id=share.id,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        email=body.inputs.get("email") if isinstance(body.inputs.get("email"), str) else None,
        submission_id=submission_id,
        extra={"action_id": body.action_id, "action_kind": kind},
    )
    db.add(redemption)
    locked_share.use_count = (locked_share.use_count or 0) + 1
    await db.commit()

    log.info(
        "share_submit_ok",
        extra={
            "share_id": share.id,
            "submission_id": submission_id,
            "ot": target_ot,
            "action_id": body.action_id,
        },
    )
    return {
        "ok": True,
        "submission_id": submission_id,
        "use_count": locked_share.use_count,
        "max_uses": locked_share.max_uses,
    }
