"""
User management — admin-only CRUD.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db, get_or_create_tenant_for_domain
from password_utils import hash_password

router = APIRouter()

VALID_ROLES = {"admin", "analyst", "viewer"}


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


def _row_to_dict(r) -> dict:
    d = dict(r._mapping)
    d.pop("password_hash", None)
    if d.get("created_at"):
        d["created_at"] = d["created_at"].isoformat()
    if d.get("updated_at"):
        d["updated_at"] = d["updated_at"].isoformat()
    return d


@router.get("")
async def list_users(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = x_tenant_id or "tenant-001"
    rows = await db.execute(
        text(
            "SELECT id, tenant_id, email, name, role, oidc_provider, is_active, created_at, updated_at "
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
):
    # Derive tenant_id from email domain so users always land in the right tenant
    email_lower = body.email.lower().strip()
    if "@" in email_lower:
        domain = email_lower.split("@")[1]
        tenant_id = await get_or_create_tenant_for_domain(db, domain)
        await db.commit()
    else:
        tenant_id = x_tenant_id or body.tenant_id

    if body.role not in VALID_ROLES:
        raise HTTPException(400, f"role must be one of {VALID_ROLES}")

    pw_hash = hash_password(body.password) if body.password else None

    row = await db.execute(
        text(
            "INSERT INTO auth_users (tenant_id, email, name, role, password_hash) "
            "VALUES (:tid, :email, :name, :role, :pw) "
            "RETURNING id, tenant_id, email, name, role, oidc_provider, is_active, created_at, updated_at"
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
    return _row_to_dict(row.fetchone())


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = await db.execute(
        text(
            "SELECT id, tenant_id, email, name, role, oidc_provider, is_active, created_at, updated_at "
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
):
    tenant_id = x_tenant_id or "tenant-001"
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
        sets.append("password_hash = :pw")
        params["pw"] = hash_password(body.password)

    await db.execute(
        text(f"UPDATE auth_users SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"),
        params,
    )
    await db.commit()
    return await get_user(user_id, x_tenant_id, db)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = x_tenant_id or "tenant-001"
    await db.execute(
        text("DELETE FROM auth_users WHERE id = :id AND tenant_id = :tid"),
        {"id": user_id, "tid": tenant_id},
    )
    await db.commit()
