"""
Reusable FastAPI auth dependency for all Nexus services.

Usage in any service:
    from shared.auth_middleware import require_auth, require_role

    @router.get("/sensitive")
    async def protected(user = Depends(require_auth)):
        ...

    @router.delete("/admin-only")
    async def admin_endpoint(user = Depends(require_role("admin"))):
        ...

Environment variables (set per service):
    AUTH_SERVICE_URL  — e.g. http://auth-service:8011
    SKIP_AUTH         — set to "true" to bypass auth (migration mode)
"""
import os
from functools import lru_cache
from typing import Optional

import httpx
from fastapi import Depends, Header, HTTPException
from jose import jwt, JWTError

AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")
SKIP_AUTH = os.environ.get("SKIP_AUTH", "true").lower() == "true"
ALGORITHM = "RS256"
ISSUER = os.environ.get("JWT_ISSUER", "https://nexus.internal/auth")

# In-memory JWKS cache — refreshed on first request and on key errors
_cached_public_key: Optional[str] = None


async def _fetch_public_key() -> str:
    global _cached_public_key
    if _cached_public_key:
        return _cached_public_key
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{AUTH_SERVICE_URL}/.well-known/jwks.json")
            resp.raise_for_status()
            jwks = resp.json()
            # Build PEM from JWKS n/e values
            from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
            from cryptography.hazmat.backends import default_backend
            from cryptography.hazmat.primitives import serialization
            from base64 import urlsafe_b64decode
            import struct

            key = jwks["keys"][0]

            def b64url_to_int(s: str) -> int:
                # Pad to multiple of 4
                padded = s + "=" * (4 - len(s) % 4)
                return int.from_bytes(urlsafe_b64decode(padded), "big")

            n = b64url_to_int(key["n"])
            e = b64url_to_int(key["e"])
            pub_numbers = RSAPublicNumbers(e, n)
            pub_key = pub_numbers.public_key(default_backend())
            pem = pub_key.public_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            ).decode()
            _cached_public_key = pem
            return pem
    except Exception as exc:
        raise HTTPException(503, f"Auth service unavailable: {exc}")


class AuthUser:
    def __init__(self, user_id: str, email: str, role: str, tenant_id: str,
                 impersonated_by: str | None = None):
        self.id = user_id
        self.email = email
        self.role = role
        self.tenant_id = tenant_id
        self.impersonated_by = impersonated_by

    def is_admin(self) -> bool:
        return self.role in ("admin", "superadmin")

    def is_superadmin(self) -> bool:
        return self.role == "superadmin"

    def is_at_least_analyst(self) -> bool:
        return self.role in ("superadmin", "admin", "analyst")

    def __repr__(self):
        return f"<AuthUser {self.email} role={self.role}>"


# Synthetic user for SKIP_AUTH mode
_SKIP_USER = AuthUser("skip-user", "dev@nexus.internal", "admin", "tenant-001")


async def require_auth(
    authorization: Optional[str] = Header(None),
    x_tenant_id: Optional[str] = Header(None),
) -> AuthUser:
    if SKIP_AUTH:
        return _SKIP_USER

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header")

    token = authorization.removeprefix("Bearer ").strip()

    try:
        public_key = await _fetch_public_key()
        payload = jwt.decode(token, public_key, algorithms=[ALGORITHM], issuer=ISSUER)
    except JWTError:
        # Key may have rotated — clear cache, re-fetch, and retry once
        global _cached_public_key
        _cached_public_key = None
        try:
            public_key = await _fetch_public_key()
            payload = jwt.decode(token, public_key, algorithms=[ALGORITHM], issuer=ISSUER)
        except JWTError as exc:
            _cached_public_key = None
            raise HTTPException(401, f"Invalid token: {exc}")

    return AuthUser(
        user_id=payload["sub"],
        email=payload["email"],
        role=payload["role"],
        tenant_id=payload["tenant_id"],
        impersonated_by=payload.get("impersonated_by"),
    )


def require_role(*roles: str):
    """
    FastAPI dependency factory.
    Usage: Depends(require_role("admin", "analyst"))
    """
    async def _dep(user: AuthUser = Depends(require_auth)) -> AuthUser:
        if user.role not in roles:
            raise HTTPException(403, f"Requires role: {' or '.join(roles)}")
        return user
    return _dep


async def require_superadmin(user: AuthUser = Depends(require_auth)) -> AuthUser:
    """Dependency that enforces superadmin role."""
    if not user.is_superadmin():
        raise HTTPException(403, "Superadmin access required")
    return user
