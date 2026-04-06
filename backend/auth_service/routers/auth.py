"""
Email/password login + token refresh endpoints.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, get_or_create_tenant_for_domain
from jwt_utils import (
    create_access_token, create_refresh_token,
    hash_refresh_token, REFRESH_TOKEN_EXPIRE_DAYS, JWKS,
)
from password_utils import verify_password

router = APIRouter()

COOKIE_NAME = "nexus_refresh"


class LoginRequest(BaseModel):
    email: str
    password: str
    tenant_id: str = "tenant-001"  # ignored — derived from email domain


class RefreshRequest(BaseModel):
    refresh_token: Optional[str] = None  # fallback if not in cookie


@router.get("/jwks")
async def jwks():
    return JWKS


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
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

    if not user or not user._mapping.get("password_hash"):
        raise HTTPException(401, "Invalid credentials")

    if not verify_password(body.password, user._mapping["password_hash"]):
        raise HTTPException(401, "Invalid credentials")

    u = user._mapping
    access_token = create_access_token(u["id"], u["email"], u["role"], u["tenant_id"], name=u["name"])
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
        secure=False,   # set True in production with HTTPS
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
    )

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
async def refresh(
    request: RefreshRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    raw_token = request.refresh_token
    if not raw_token:
        raise HTTPException(401, "No refresh token provided")

    token_hash = hash_refresh_token(raw_token)
    now = datetime.now(timezone.utc)

    row = await db.execute(
        text(
            "SELECT rt.*, u.email, u.name, u.role, u.tenant_id, u.is_active "
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

    access_token = create_access_token(r["user_id"], r["email"], r["role"], r["tenant_id"], name=r["name"])

    response.set_cookie(
        key=COOKIE_NAME,
        value=new_raw,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        path="/auth",
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 900,
    }


@router.post("/logout")
async def logout(request: RefreshRequest, response: Response, db: AsyncSession = Depends(get_db)):
    if request.refresh_token:
        token_hash = hash_refresh_token(request.refresh_token)
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
