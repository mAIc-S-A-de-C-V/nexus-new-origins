"""
Tier-based install / publish caps per tenant.

Each tenant has a row in `tenant_app_quotas` with a tier label + numeric
caps. A new tenant lazily gets a "free" row at first quota check (3
installs, 1 published app). Superadmins bump tiers via PATCH
/app-quotas/{tenant_id}.

Negative cap = unlimited. Useful for the enterprise tier or internal
operator tenants.
"""
from __future__ import annotations
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import TenantAppQuotaRow, ExternalAppInstallRow, ExternalAppRow


# Built-in presets. PATCH /app-quotas/{tid} with {"tier": "<name>"}
# auto-applies these limits unless explicit max_* values are also passed.
TIER_PRESETS: dict[str, dict[str, int]] = {
    "free":         {"max_apps_installed":  3, "max_apps_published":  1},
    "starter":      {"max_apps_installed": 10, "max_apps_published":  5},
    "professional": {"max_apps_installed": 50, "max_apps_published": 25},
    "enterprise":   {"max_apps_installed": -1, "max_apps_published": -1},
}


async def get_or_create_quota(db: AsyncSession, tenant_id: str) -> TenantAppQuotaRow:
    """Look up the tenant's quota row, lazily creating a "free" one if missing."""
    row = (await db.execute(
        select(TenantAppQuotaRow).where(TenantAppQuotaRow.tenant_id == tenant_id)
    )).scalar_one_or_none()
    if row:
        return row
    preset = TIER_PRESETS["free"]
    row = TenantAppQuotaRow(
        tenant_id=tenant_id,
        tier="free",
        max_apps_installed=preset["max_apps_installed"],
        max_apps_published=preset["max_apps_published"],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def count_enabled_installs(db: AsyncSession, tenant_id: str) -> int:
    return (await db.execute(
        select(func.count()).select_from(ExternalAppInstallRow).where(
            ExternalAppInstallRow.tenant_id == tenant_id,
            ExternalAppInstallRow.enabled.is_(True),
        )
    )).scalar() or 0


async def count_published_apps(db: AsyncSession, publisher_tenant_id: str) -> int:
    """
    Count apps whose `publisher_id` matches this tenant. We use
    `publisher_id` rather than tenant-of-publish because manifests
    declare the publisher explicitly — a single tenant might publish
    under multiple publisher_ids (rare, but allowed).

    For the common case (one publisher_id per tenant, set at install.sh
    login time and reused), this returns the right count.
    """
    return (await db.execute(
        select(func.count()).select_from(ExternalAppRow).where(
            ExternalAppRow.publisher_id == publisher_tenant_id,
        )
    )).scalar() or 0


class QuotaExceeded(Exception):
    def __init__(self, tier: str, current: int, limit: int, kind: str):
        self.tier = tier
        self.current = current
        self.limit = limit
        self.kind = kind
        super().__init__(self._msg())

    def _msg(self) -> str:
        return (
            f"Tier '{self.tier}' limit reached: "
            f"{self.current}/{self.limit} {self.kind}. "
            f"Disable or uninstall an app to free a slot, or upgrade the tier."
        )


async def check_install_quota(db: AsyncSession, tenant_id: str) -> None:
    quota = await get_or_create_quota(db, tenant_id)
    if quota.max_apps_installed < 0:
        return  # unlimited
    current = await count_enabled_installs(db, tenant_id)
    if current >= quota.max_apps_installed:
        raise QuotaExceeded(quota.tier, current, quota.max_apps_installed, "apps installed")


async def check_publish_quota(db: AsyncSession, publisher_id: str, is_new_app: bool) -> None:
    """
    Only counts NEW publishes. Bumping a version on an existing app
    doesn't consume an additional slot — that'd be infuriating during
    iteration. Slot is consumed once per unique app_id in the catalog.
    """
    if not is_new_app:
        return
    quota = await get_or_create_quota(db, publisher_id)
    if quota.max_apps_published < 0:
        return
    current = await count_published_apps(db, publisher_id)
    if current >= quota.max_apps_published:
        raise QuotaExceeded(quota.tier, current, quota.max_apps_published, "apps published")
