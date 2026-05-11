"""
apps-service auth dependency with superadmin tenant impersonation.

A superadmin authenticated against ANY tenant can pass an
`x-impersonate-tenant` header to operate as if they were in that tenant
for the duration of the request. Without the header (or for non-
superadmins) this falls through to the standard `require_auth`.

Every endpoint that touches tenant-scoped data should use
`require_apps_auth` instead of `shared.auth_middleware.require_auth`.

Audit: when impersonation is in effect, the dependency leaves the
original user_id + role on the returned object and adds an
`impersonated_from` field pointing at the user's home tenant. The audit
helpers downstream pick this up and stamp every emitted row with both
tenants, so the trail records "who" (the real superadmin) and "where"
(the impersonated tenant) cleanly.
"""
from __future__ import annotations
from typing import Optional

from fastapi import Depends, Header

from shared.auth_middleware import require_auth, AuthUser


class AppsAuthUser(AuthUser):
    """AuthUser with optional impersonation context."""

    def __init__(self, base: AuthUser, impersonated_from: Optional[str] = None):
        super().__init__(
            user_id=base.id,
            email=base.email,
            role=base.role,
            tenant_id=base.tenant_id,
            impersonated_by=base.impersonated_by,
        )
        self.impersonated_from = impersonated_from

    def is_impersonating(self) -> bool:
        return self.impersonated_from is not None


async def require_apps_auth(
    user: AuthUser = Depends(require_auth),
    x_impersonate_tenant: Optional[str] = Header(None),
) -> AppsAuthUser:
    """
    Authenticate + optionally impersonate a different tenant.

    Honors `x-impersonate-tenant` only when:
      - the header is non-empty
      - the requested tenant differs from the caller's home tenant
      - the caller is a superadmin (role == "superadmin")

    Anyone else who sends the header is silently treated as their normal
    tenant — the header is a no-op, not a forbidden response, so honest
    clients can include it without breaking when they're not a
    superadmin.
    """
    if (x_impersonate_tenant
        and x_impersonate_tenant.strip()
        and x_impersonate_tenant.strip() != user.tenant_id
        and user.is_superadmin()):
        impersonated_from = user.tenant_id
        # Build a modified AuthUser with the new tenant_id but keep the
        # real identity for audit.
        impersonated = AuthUser(
            user_id=user.id,
            email=user.email,
            role=user.role,
            tenant_id=x_impersonate_tenant.strip(),
            impersonated_by=user.impersonated_by,
        )
        return AppsAuthUser(impersonated, impersonated_from=impersonated_from)
    return AppsAuthUser(user)
