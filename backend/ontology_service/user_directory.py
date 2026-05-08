"""
Thin client for auth_service's /users API + a per-tenant cache.

The workflow engine + assignee resolver need to convert between user_id ↔
email ↔ name. We don't want to denormalize user data into ontology_service,
so we proxy and cache. Cache is in-process and TTL'd; on cache miss we hit
auth_service.

Used by:
  - workflow assignee resolution (spec → user record)
  - the /actions/users endpoint that the frontend pickers call
  - notifications enrichment (user_email when only user_id is known)
"""

from __future__ import annotations

import logging
import os
import time
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

AUTH_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")
CACHE_TTL_S = float(os.environ.get("USER_DIRECTORY_CACHE_TTL_S", "60"))

# tenant_id → (cached_at_epoch, [user_dicts])
_cache: dict[str, tuple[float, list[dict]]] = {}


async def list_users(tenant_id: str, *, force_refresh: bool = False) -> list[dict]:
    """All users in the tenant. Cached per tenant for CACHE_TTL_S seconds."""
    now = time.time()
    if not force_refresh:
        hit = _cache.get(tenant_id)
        if hit and (now - hit[0]) < CACHE_TTL_S:
            return hit[1]
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{AUTH_URL}/users",
                headers={"x-tenant-id": tenant_id},
            )
            if not resp.is_success:
                logger.warning("user_directory list_users HTTP %s: %s",
                               resp.status_code, resp.text[:200])
                return _cache.get(tenant_id, (0.0, []))[1]
            body = resp.json() or {}
            users = body.get("users") or []
            normalized = [_normalize(u) for u in users if isinstance(u, dict)]
            _cache[tenant_id] = (now, normalized)
            return normalized
    except Exception:
        logger.exception("user_directory list_users raised")
        return _cache.get(tenant_id, (0.0, []))[1]


def _normalize(u: dict) -> dict:
    return {
        "id": u.get("id"),
        "email": (u.get("email") or "").lower(),
        "name": u.get("name") or "",
        "role": u.get("role") or "viewer",
        "is_active": u.get("is_active", True),
    }


async def lookup_by_id(tenant_id: str, user_id: str) -> Optional[dict]:
    if not user_id:
        return None
    for u in await list_users(tenant_id):
        if str(u.get("id")) == str(user_id):
            return u
    # cache miss path — refresh once and try again
    for u in await list_users(tenant_id, force_refresh=True):
        if str(u.get("id")) == str(user_id):
            return u
    return None


async def lookup_by_email(tenant_id: str, email: str) -> Optional[dict]:
    if not email:
        return None
    em = str(email).lower()
    for u in await list_users(tenant_id):
        if u.get("email") == em:
            return u
    for u in await list_users(tenant_id, force_refresh=True):
        if u.get("email") == em:
            return u
    return None


async def lookup_by_role(tenant_id: str, role: str) -> Optional[dict]:
    """Pick any active user with the given role. Useful when an action
    template assigns 'role: admin' rather than a specific user."""
    if not role:
        return None
    for u in await list_users(tenant_id):
        if u.get("role") == role and u.get("is_active"):
            return u
    return None


async def resolve_assignee(tenant_id: str, spec: dict, payload: dict) -> dict:
    """Turn a workflow assignee spec + payload into {user_id, user_email, name}.
    Returns {} if nothing resolves — caller decides whether to error or
    fall through to the template default."""
    if not spec or not isinstance(spec, dict):
        return {}
    kind = spec.get("kind")
    user: Optional[dict] = None

    if kind == "user_id":
        user = await lookup_by_id(tenant_id, str(spec.get("value") or ""))
    elif kind == "user_email":
        user = await lookup_by_email(tenant_id, str(spec.get("value") or ""))
    elif kind == "role":
        user = await lookup_by_role(tenant_id, str(spec.get("value") or ""))
    elif kind == "from_payload":
        # Walk dot-path inside payload and resolve whatever string lands there
        # — could be user_id (uuid-shaped) or user_email (contains @).
        from jsonlogic import _resolve_var as _rv  # type: ignore[attr-defined]
        v = _rv(spec.get("field") or "", payload, default=None)
        if v:
            v_str = str(v)
            if "@" in v_str:
                user = await lookup_by_email(tenant_id, v_str)
            else:
                user = await lookup_by_id(tenant_id, v_str)

    if not user:
        return {}
    return {"user_id": user.get("id"), "user_email": user.get("email"), "name": user.get("name")}
