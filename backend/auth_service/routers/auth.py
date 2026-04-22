"""
Email/password login + token refresh endpoints.
"""
import json as _json
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx as _httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, get_or_create_tenant_for_domain
from jwt_utils import (
    create_access_token, create_refresh_token,
    hash_refresh_token, decode_access_token, REFRESH_TOKEN_EXPIRE_DAYS, JWKS,
)
from password_utils import verify_password

router = APIRouter()

COOKIE_NAME = "nexus_refresh"
AUDIT_SERVICE_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")

limiter = Limiter(key_func=get_remote_address)


class LoginRequest(BaseModel):
    email: str
    password: str
    tenant_id: str = "tenant-001"  # ignored — derived from email domain
    totp_code: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None  # fallback if not in cookie


async def _audit(action: str, actor_id: str, actor_email: str, tenant_id: str,
                  resource: str, ip: str = "", success: bool = True, detail: str = ""):
    """Fire-and-forget audit log entry."""
    try:
        async with _httpx.AsyncClient(timeout=2.0) as ac:
            await ac.post(f"{AUDIT_SERVICE_URL}/audit/events", json={
                "actor_id": actor_id,
                "actor_email": actor_email,
                "tenant_id": tenant_id,
                "action": action,
                "resource_type": "auth",
                "resource_id": resource,
                "success": success,
                "detail": detail,
                "ip_address": ip,
            }, headers={"x-internal": "nexus-internal"})
    except Exception:
        pass  # audit must never block auth


@router.get("/jwks")
async def jwks():
    return JWKS


@router.post("/login")
@limiter.limit("10/minute")
async def login(request: Request, body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    email = body.email.lower().strip()

    # Derive tenant_id from email domain
    if "@" in email:
        domain = email.split("@")[1]
        tenant_id = await get_or_create_tenant_for_domain(db, domain)
        await db.commit()
    else:
        tenant_id = "tenant-001"

    row = await db.execute(
        text(
            "SELECT * FROM auth_users WHERE email = :email AND tenant_id = :tid AND is_active = TRUE"
        ),
        {"email": email, "tid": tenant_id},
    )
    user = row.fetchone()

    # Fallback: if no user found with derived tenant, search by email only.
    # This handles users placed in a specific tenant by superadmin whose
    # email domain doesn't match the tenant's domain mapping.
    if not user:
        row2 = await db.execute(
            text("SELECT * FROM auth_users WHERE email = :email AND is_active = TRUE"),
            {"email": email},
        )
        user = row2.fetchone()
        if user:
            tenant_id = user._mapping["tenant_id"]

    # Account lockout check
    if user:
        u_map = user._mapping
        locked_until = u_map.get("locked_until")
        if locked_until and locked_until > datetime.now(timezone.utc):
            await _audit("login.blocked", str(u_map["id"]), email, u_map["tenant_id"],
                         "session", success=False, detail="account locked",
                         ip=request.client.host if request.client else "")
            raise HTTPException(429, "Account temporarily locked. Try again later.")

    if not user or not user._mapping.get("password_hash"):
        await _audit("login.failed", "", email, tenant_id, "session", success=False,
                     detail="invalid credentials", ip=request.client.host if request.client else "")
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(body.password, user._mapping["password_hash"]):
        # Increment failure counter
        await db.execute(
            text("UPDATE auth_users SET failed_attempts = failed_attempts + 1, "
                 "locked_until = CASE WHEN failed_attempts + 1 >= 5 "
                 "THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END "
                 "WHERE id = :uid"),
            {"uid": user._mapping["id"]},
        )
        await db.commit()
        await _audit("login.failed", "", email, tenant_id, "session", success=False,
                     detail="invalid credentials", ip=request.client.host if request.client else "")
        raise HTTPException(401, "Invalid credentials")

    u = user._mapping

    # Reset failed attempts on successful password verification
    await db.execute(
        text("UPDATE auth_users SET failed_attempts = 0, locked_until = NULL WHERE id = :uid"),
        {"uid": u["id"]},
    )

    # Enforce MFA for admin accounts
    if u["role"] == "admin" and u.get("mfa_enabled"):
        # MFA is enabled — require totp_code in the request body
        totp_code = getattr(body, "totp_code", None)
        if not totp_code:
            raise HTTPException(401, "MFA required — provide totp_code in request body")
        from mfa_utils import verify_totp
        if not verify_totp(u["mfa_secret"], totp_code):
            await _audit("login.mfa_failed", u["id"], email, u["tenant_id"], "session",
                         success=False, detail="invalid MFA code",
                         ip=request.client.host if request.client else "")
            raise HTTPException(401, "Invalid MFA code")

    import json as _json
    _modules = _json.loads(u.get("allowed_modules") or "[]")
    access_token = create_access_token(u["id"], u["email"], u["role"], u["tenant_id"], name=u["name"], modules=_modules)
    raw_refresh, hashed_refresh = create_refresh_token()

    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    await db.execute(
        text(
            "INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at) "
            "VALUES (:uid, :hash, :exp)"
        ),
        {"uid": u["id"], "hash": hashed_refresh, "exp": expires_at},
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

    await _audit("login.success", u["id"], u["email"], u["tenant_id"], "session",
                 ip=request.client.host if request.client else "")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 900,
        "user": {
            "id": u["id"],
            "email": u["email"],
            "name": u["name"],
            "role": u["role"],
            "tenant_id": u["tenant_id"],
        },
    }


@router.post("/refresh")
@limiter.limit("20/minute")
async def refresh(
    request: Request,
    body: RefreshRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    raw_token = body.refresh_token or request.cookies.get(COOKIE_NAME)
    if not raw_token:
        raise HTTPException(401, "No refresh token provided")

    token_hash = hash_refresh_token(raw_token)
    now = datetime.now(timezone.utc)

    row = await db.execute(
        text(
            "SELECT rt.*, u.email, u.name, u.role, u.tenant_id, u.is_active, u.allowed_modules "
            "FROM auth_refresh_tokens rt "
            "JOIN auth_users u ON u.id = rt.user_id "
            "WHERE rt.token_hash = :hash AND rt.expires_at > :now"
        ),
        {"hash": token_hash, "now": now},
    )
    record = row.fetchone()
    if not record:
        raise HTTPException(401, "Invalid or expired refresh token")

    r = record._mapping
    if not r["is_active"]:
        raise HTTPException(401, "User account deactivated")

    # Rotate refresh token
    await db.execute(
        text("DELETE FROM auth_refresh_tokens WHERE token_hash = :hash"),
        {"hash": token_hash},
    )

    new_raw, new_hash = create_refresh_token()
    new_expires = now + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    await db.execute(
        text(
            "INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at) "
            "VALUES (:uid, :hash, :exp)"
        ),
        {"uid": r["user_id"], "hash": new_hash, "exp": new_expires},
    )
    await db.commit()

    import json as _json
    _modules = _json.loads(r.get("allowed_modules") or "[]")
    access_token = create_access_token(r["user_id"], r["email"], r["role"], r["tenant_id"], name=r["name"], modules=_modules)

    response.set_cookie(
        key=COOKIE_NAME,
        value=new_raw,
        httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
    )

    await _audit("token.refresh", r["user_id"], r["email"], r["tenant_id"], "session",
                 ip=request.client.host if request.client else "")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 900,
    }


@router.post("/logout")
async def logout(request: Request, body: RefreshRequest, response: Response, db: AsyncSession = Depends(get_db)):
    raw_token = body.refresh_token or request.cookies.get(COOKIE_NAME)
    if raw_token:
        token_hash = hash_refresh_token(raw_token)
        await db.execute(
            text("DELETE FROM auth_refresh_tokens WHERE token_hash = :hash"),
            {"hash": token_hash},
        )
        await db.commit()

    response.delete_cookie(key=COOKIE_NAME, path="/auth")
    return {"ok": True}


@router.get("/me")
async def me():
    raise HTTPException(501, "Use the Authorization header validation in your service")


# ── MFA endpoints (ISO 27001 Annex A.8.5 — Secure authentication) ────────────

class MFASetupResponse(BaseModel):
    totp_uri: str
    secret: str  # shown once for backup


class MFAVerifyRequest(BaseModel):
    user_id: str
    totp_code: str


@router.post("/mfa/setup")
async def setup_mfa(body: RefreshRequest, req: Request, response: Response, db: AsyncSession = Depends(get_db)):
    """
    Generate a TOTP secret for the authenticated user and return the provisioning URI.
    The caller must call /mfa/verify to confirm and enable MFA.
    """
    # Get user from cookie/token
    raw_token = body.refresh_token or req.cookies.get(COOKIE_NAME)
    if not raw_token:
        raise HTTPException(401, "Not authenticated")

    from mfa_utils import generate_totp_secret, get_totp_uri
    secret = generate_totp_secret()
    uri = get_totp_uri(secret, "user@example.com")  # placeholder — real impl would decode token

    return MFASetupResponse(totp_uri=uri, secret=secret)


@router.post("/mfa/verify")
async def verify_mfa(req_body: MFAVerifyRequest, db: AsyncSession = Depends(get_db)):
    """Verify a TOTP code for a user."""
    from mfa_utils import verify_totp
    from sqlalchemy import text

    row = await db.execute(
        text("SELECT mfa_secret FROM auth_users WHERE id = :uid"),
        {"uid": req_body.user_id},
    )
    user = row.fetchone()
    if not user:
        raise HTTPException(404, "User not found")

    secret = user._mapping.get("mfa_secret")
    if not secret:
        raise HTTPException(400, "MFA not configured for this user")

    if not verify_totp(secret, req_body.totp_code):
        raise HTTPException(401, "Invalid MFA code")

    return {"verified": True}


# ── Impersonation (superadmin only) ──────────────────────────────────────────

class ImpersonateRequest(BaseModel):
    target_user_id: str
    target_tenant_id: str


@router.post("/impersonate")
async def impersonate(
    body: ImpersonateRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    """Create an impersonation JWT for a target user. Requires superadmin."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization")

    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_access_token(token)
    except Exception as exc:
        raise HTTPException(401, f"Invalid token: {exc}")

    if payload.get("role") != "superadmin":
        raise HTTPException(403, "Superadmin access required")

    # Look up target user
    row = await db.execute(
        text("SELECT * FROM auth_users WHERE id = :uid AND tenant_id = :tid AND is_active = TRUE"),
        {"uid": body.target_user_id, "tid": body.target_tenant_id},
    )
    target = row.fetchone()
    if not target:
        raise HTTPException(404, "Target user not found")

    t = target._mapping
    modules = _json.loads(t.get("allowed_modules") or "[]")
    access_token = create_access_token(
        t["id"], t["email"], t["role"], t["tenant_id"],
        name=t["name"], modules=modules,
        impersonated_by=payload["email"],
    )

    await _audit(
        "impersonation.start", payload["sub"], payload["email"],
        body.target_tenant_id, f"user:{body.target_user_id}",
        ip=request.client.host if request.client else "",
        detail=f"impersonating {t['email']} in {body.target_tenant_id}",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 900,
        "impersonating": {
            "id": t["id"],
            "email": t["email"],
            "name": t["name"],
            "role": t["role"],
            "tenant_id": t["tenant_id"],
        },
    }
