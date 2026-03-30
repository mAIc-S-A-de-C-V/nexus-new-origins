"""
OIDC Authorization Code Flow endpoints.
GET  /auth/oidc/{provider}          → redirect to provider
GET  /auth/oidc/{provider}/callback → exchange code, upsert user, issue tokens
"""
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from jwt_utils import create_access_token, create_refresh_token, REFRESH_TOKEN_EXPIRE_DAYS
from oidc import get_authorization_url, exchange_code, PROVIDERS

router = APIRouter()
COOKIE_NAME = "nexus_refresh"

# In-memory state store (fine for single instance; replace with Redis for HA)
_state_store: dict[str, str] = {}


@router.get("/{provider}")
async def oidc_login(provider: str, tenant_id: str = "tenant-001"):
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    cfg = PROVIDERS[provider]
    if not cfg.get("client_id"):
        raise HTTPException(501, f"{provider} OIDC not configured (missing CLIENT_ID)")

    state = secrets.token_urlsafe(16)
    _state_store[state] = tenant_id  # associate state with tenant

    url = get_authorization_url(provider, state)
    return RedirectResponse(url=url)


@router.get("/{provider}/callback")
async def oidc_callback(
    provider: str,
    code: str,
    state: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    tenant_id = _state_store.pop(state, "tenant-001")

    try:
        user_info = await exchange_code(provider, code)
    except Exception as exc:
        raise HTTPException(400, f"OIDC exchange failed: {exc}")

    email = user_info["email"].lower().strip()
    name = user_info["name"] or email
    oidc_sub = user_info["sub"]

    # Upsert user
    row = await db.execute(
        text(
            "SELECT * FROM auth_users WHERE tenant_id = :tid AND email = :email"
        ),
        {"tid": tenant_id, "email": email},
    )
    existing = row.fetchone()

    if existing:
        # Update OIDC info if needed
        await db.execute(
            text(
                "UPDATE auth_users SET oidc_provider = :prov, oidc_subject = :sub, updated_at = NOW() "
                "WHERE id = :id"
            ),
            {"prov": provider, "sub": oidc_sub, "id": existing._mapping["id"]},
        )
        user_id = existing._mapping["id"]
        role = existing._mapping["role"]
    else:
        # New user — default role viewer
        ins = await db.execute(
            text(
                "INSERT INTO auth_users (tenant_id, email, name, role, oidc_provider, oidc_subject) "
                "VALUES (:tid, :email, :name, 'viewer', :prov, :sub) "
                "RETURNING id, role"
            ),
            {"tid": tenant_id, "email": email, "name": name, "prov": provider, "sub": oidc_sub},
        )
        created = ins.fetchone()
        user_id = created._mapping["id"]
        role = created._mapping["role"]

    await db.commit()

    # Issue tokens
    access_token = create_access_token(user_id, email, role, tenant_id)
    raw_refresh, hashed_refresh = create_refresh_token()
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)

    await db.execute(
        text(
            "INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at) "
            "VALUES (:uid, :hash, :exp)"
        ),
        {"uid": user_id, "hash": hashed_refresh, "exp": expires_at},
    )
    await db.commit()

    response.set_cookie(
        key=COOKIE_NAME,
        value=raw_refresh,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
    )

    # Redirect frontend with access token in fragment (never in query param)
    from oidc import APP_BASE_URL as FRONT_URL
    return RedirectResponse(
        url=f"{FRONT_URL}/auth/callback?token={access_token}&provider={provider}",
        status_code=302,
    )
