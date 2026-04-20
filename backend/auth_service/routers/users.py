"""
User management — admin-only CRUD.
"""
import json
import os
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, get_or_create_tenant_for_domain
from jwt_utils import decode_access_token
from password_utils import hash_password

router = APIRouter()

SKIP_AUTH = os.environ.get("SKIP_AUTH", "true").lower() == "true"


class _AuthUser:
    def __init__(self, user_id: str, email: str, role: str, tenant_id: str):
        self.id = user_id
        self.email = email
        self.role = role
        self.tenant_id = tenant_id

    def is_admin(self) -> bool:
        return self.role in ("admin", "superadmin")

    def is_superadmin(self) -> bool:
        return self.role == "superadmin"


_SKIP_USER = _AuthUser("skip-user", "dev@nexus.internal", "admin", "tenant-001")


async def require_auth(
    authorization: Optional[str] = Header(None),
) -> _AuthUser:
    if SKIP_AUTH:
        return _SKIP_USER
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_access_token(token)
    except Exception as exc:
        raise HTTPException(401, f"Invalid token: {exc}")
    return _AuthUser(
        user_id=payload["sub"],
        email=payload["email"],
        role=payload["role"],
        tenant_id=payload["tenant_id"],
    )

VALID_ROLES = {"superadmin", "admin", "analyst", "viewer"}


def _validate_password(password: str) -> None:
    """Enforce password policy: min 12 chars, uppercase, lowercase, digit, special char."""
    if len(password) < 12:
        raise HTTPException(400, "Password must be at least 12 characters")
    if not re.search(r"[A-Z]", password):
        raise HTTPException(400, "Password must contain at least one uppercase letter")
    if not re.search(r"[a-z]", password):
        raise HTTPException(400, "Password must contain at least one lowercase letter")
    if not re.search(r"\d", password):
        raise HTTPException(400, "Password must contain at least one digit")
    if not re.search(r"[^A-Za-z0-9]", password):
        raise HTTPException(400, "Password must contain at least one special character")


class UserCreate(BaseModel):
    email: str
    name: str
    role: str = "viewer"
    password: Optional[str] = None
    tenant_id: str = "tenant-001"


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None
    allowed_modules: Optional[List[str]] = None


def _row_to_dict(r) -> dict:
    d = dict(r._mapping)
    d.pop("password_hash", None)
    if d.get("created_at"):
        d["created_at"] = d["created_at"].isoformat()
    if d.get("updated_at"):
        d["updated_at"] = d["updated_at"].isoformat()
    d["allowed_modules"] = json.loads(d.get("allowed_modules") or "[]")
    return d


@router.get("")
async def list_users(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    auth_user: _AuthUser = Depends(require_auth),
):
    tenant_id = x_tenant_id or auth_user.tenant_id
    rows = await db.execute(
        text(
            "SELECT id, tenant_id, email, name, role, oidc_provider, is_active, "
            "allowed_modules, created_at, updated_at "
            "FROM auth_users WHERE tenant_id = :tid ORDER BY created_at"
        ),
        {"tid": tenant_id},
    )
    return {"users": [_row_to_dict(r) for r in rows.fetchall()]}


@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    auth_user: _AuthUser = Depends(require_auth),
):
    if not auth_user.is_admin():
        raise HTTPException(403, "Admin only")
    email_lower = body.email.lower().strip()
    # Superadmin with explicit x-tenant-id: place user in the requested tenant
    if auth_user.is_superadmin() and x_tenant_id:
        tenant_id = x_tenant_id
    elif "@" in email_lower:
        # Derive tenant_id from email domain so users always land in the right tenant
        domain = email_lower.split("@")[1]
        tenant_id = await get_or_create_tenant_for_domain(db, domain)
        await db.commit()
    else:
        tenant_id = x_tenant_id or body.tenant_id

    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {VALID_ROLES}")

    if body.password:
        _validate_password(body.password)
    pw_hash = hash_password(body.password) if body.password else None

    try:
        row = await db.execute(
            text(
                "INSERT INTO auth_users (tenant_id, email, name, role, password_hash) "
                "VALUES (:tid, :email, :name, :role, :pw) "
                "RETURNING id, tenant_id, email, name, role, oidc_provider, is_active, "
                "allowed_modules, created_at, updated_at"
            ),
            {
                "tid": tenant_id,
                "email": email_lower,
                "name": body.name,
                "role": body.role,
                "pw": pw_hash,
            },
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        if "unique" in str(exc).lower() or "duplicate" in str(exc).lower():
            raise HTTPException(409, f"User {email_lower} already exists in tenant {tenant_id}")
        raise HTTPException(500, f"Failed to create user: {exc}")
    return _row_to_dict(row.fetchone())


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    auth_user: _AuthUser = Depends(require_auth),
):
    tenant_id = x_tenant_id or auth_user.tenant_id
    row = await db.execute(
        text(
            "SELECT id, tenant_id, email, name, role, oidc_provider, is_active, "
            "allowed_modules, created_at, updated_at "
            "FROM auth_users WHERE id = :id AND tenant_id = :tid"
        ),
        {"id": user_id, "tid": tenant_id},
    )
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "User not found")
    return _row_to_dict(r)


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    auth_user: _AuthUser = Depends(require_auth),
):
    if not auth_user.is_admin():
        raise HTTPException(403, "Admin only")
    tenant_id = x_tenant_id or auth_user.tenant_id
    if body.role and body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {VALID_ROLES}")

    sets = ["updated_at = NOW()"]
    params: dict = {"id": user_id, "tid": tenant_id}

    if body.name is not None:
        sets.append("name = :name")
        params["name"] = body.name
    if body.role is not None:
        sets.append("role = :role")
        params["role"] = body.role
    if body.is_active is not None:
        sets.append("is_active = :active")
        params["active"] = body.is_active
    if body.password is not None:
        _validate_password(body.password)
        sets.append("password_hash = :pw")
        params["pw"] = hash_password(body.password)
    if body.allowed_modules is not None:
        sets.append("allowed_modules = :allowed_modules")
        params["allowed_modules"] = json.dumps(body.allowed_modules)

    await db.execute(
        text(f"UPDATE auth_users SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"),
        params,
    )
    await db.commit()
    return await get_user(user_id, x_tenant_id, db, auth_user)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
    auth_user: _AuthUser = Depends(require_auth),
):
    if not auth_user.is_admin():
        raise HTTPException(403, "Admin only")
    tenant_id = x_tenant_id or auth_user.tenant_id
    await db.execute(
        text("DELETE FROM auth_users WHERE id = :id AND tenant_id = :tid"),
        {"id": user_id, "tid": tenant_id},
    )
    await db.commit()
