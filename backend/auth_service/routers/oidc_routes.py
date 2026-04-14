"""
OIDC Authorization Code Flow endpoints.
GET  /auth/oidc/{provider}          → redirect to provider
GET  /auth/oidc/{provider}/callback → exchange code, upsert user, issue tokens
"""
import hashlib
import base64
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import RedirectResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from jwt_utils import create_access_token, create_refresh_token, REFRESH_TOKEN_EXPIRE_DAYS
from oidc import get_authorization_url, exchange_code, PROVIDERS

router = APIRouter()
COOKIE_NAME = "nexus_refresh"

# Redis-backed state store
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/1")
_redis: aioredis.Redis | None = None

OIDC_STATE_TTL = 600  # 10 minutes


async def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    return _redis


async def _store_state(state: str, tenant_id: str) -> None:
    r = await _get_redis()
    await r.setex(f"oidc:state:{state}", OIDC_STATE_TTL, tenant_id)


async def _consume_state(state: str) -> str:
    r = await _get_redis()
    tenant_id = await r.getdel(f"oidc:state:{state}")
    return tenant_id or "tenant-001"


def _generate_pkce():
    """Generate PKCE code_verifier and code_challenge (S256 method)."""
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


@router.get("/{provider}")
async def oidc_login(provider: str, tenant_id: str = "tenant-001"):
    if provider not in PROVIDERS:
        raise HTTPException(400, f"Unknown provider: {provider}")
    cfg = PROVIDERS[provider]
    if not cfg.get("client_id"):
        raise HTTPException(501, f"{provider} OIDC not configured (missing CLIENT_ID)")

    state = secrets.token_urlsafe(16)
    code_verifier, code_challenge = _generate_pkce()
    await _store_state(state, f"{tenant_id}|{code_verifier}")

    url = get_authorization_url(provider, state, code_challenge=code_challenge, code_challenge_method="S256")
    return RedirectResponse(url=url)


@router.get("/{provider}/callback")
async def oidc_callback(
    provider: str,
    code: str,
    state: str,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    stored = await _consume_state(state)
    if "|" in stored:
        tenant_id, code_verifier = stored.split("|", 1)
    else:
        tenant_id = stored
        code_verifier = ""

    try:
        user_info = await exchange_code(provider, code, code_verifier=code_verifier)
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
        secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
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
