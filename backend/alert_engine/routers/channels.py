"""
Per-tenant notification channel configuration (email, Slack).
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import httpx

from database import get_pg_session

router = APIRouter()
log = logging.getLogger(__name__)


# ── Models ─────────────────────────────────────────────────────────────────────

class ChannelConfig(BaseModel):
    email_enabled: bool = False
    email_recipients: str = ""
    slack_enabled: bool = False
    slack_webhook_url: str = ""


# ── Helpers ────────────────────────────────────────────────────────────────────

async def _get_or_create_channel(pg: AsyncSession, tenant_id: str) -> dict:
    """Return the channel row for the tenant, inserting an empty row if missing."""
    row = await pg.execute(
        text("SELECT * FROM alert_channels WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    result = row.fetchone()
    if result:
        return dict(result._mapping)

    # Upsert empty row
    await pg.execute(
        text(
            "INSERT INTO alert_channels (tenant_id) VALUES (:tid) "
            "ON CONFLICT (tenant_id) DO NOTHING"
        ),
        {"tid": tenant_id},
    )
    await pg.commit()

    row = await pg.execute(
        text("SELECT * FROM alert_channels WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    return dict(row.fetchone()._mapping)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/channels")
async def get_channels(
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    channel = await _get_or_create_channel(pg, tenant_id)
    # Convert UUID to string for JSON serialisation
    channel["id"] = str(channel["id"])
    if channel.get("updated_at"):
        channel["updated_at"] = channel["updated_at"].isoformat()
    return channel


@router.put("/channels")
async def update_channels(
    body: ChannelConfig,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    # Ensure a row exists first
    await _get_or_create_channel(pg, tenant_id)

    await pg.execute(
        text(
            "UPDATE alert_channels SET "
            "  email_enabled     = :email_enabled, "
            "  email_recipients  = :email_recipients, "
            "  slack_enabled     = :slack_enabled, "
            "  slack_webhook_url = :slack_webhook_url, "
            "  updated_at        = NOW() "
            "WHERE tenant_id = :tid"
        ),
        {
            "email_enabled": body.email_enabled,
            "email_recipients": body.email_recipients,
            "slack_enabled": body.slack_enabled,
            "slack_webhook_url": body.slack_webhook_url,
            "tid": tenant_id,
        },
    )
    await pg.commit()
    return {"ok": True}


@router.post("/channels/test")
async def test_channels(
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    channel = await _get_or_create_channel(pg, tenant_id)
    results: dict = {}

    # ── Slack ──────────────────────────────────────────────────────────────────
    if channel.get("slack_enabled") and channel.get("slack_webhook_url"):
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    channel["slack_webhook_url"],
                    json={"text": "🔔 Nexus Alert Test — channels are configured correctly"},
                )
            if resp.status_code == 200:
                results["slack"] = "ok"
            else:
                results["slack"] = f"error: HTTP {resp.status_code}"
                log.warning("Slack test delivery returned %s", resp.status_code)
        except Exception as exc:
            results["slack"] = f"error: {exc}"
            log.error("Slack test delivery failed: %s", exc)
    else:
        results["slack"] = "disabled"

    # ── Email ──────────────────────────────────────────────────────────────────
    if channel.get("email_enabled") and channel.get("email_recipients"):
        results["email"] = "not_implemented"
    else:
        results["email"] = "disabled"

    return {"ok": True, **results}
