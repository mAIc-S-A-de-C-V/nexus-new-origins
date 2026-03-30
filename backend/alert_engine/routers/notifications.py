"""
Notification read / dismiss endpoints + webhook management.
"""
import secrets
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_pg_session

router = APIRouter()


# ── Notifications ──────────────────────────────────────────────────────────────

@router.get("")
async def list_notifications(
    tenant_id: str = "tenant-001",
    unread_only: bool = False,
    limit: int = 50,
    pg: AsyncSession = Depends(get_pg_session),
):
    where = "WHERE tenant_id = :tid"
    if unread_only:
        where += " AND read = FALSE"
    rows = await pg.execute(
        text(f"SELECT * FROM alert_notifications {where} ORDER BY fired_at DESC LIMIT :lim"),
        {"tid": tenant_id, "lim": limit},
    )
    notifications = []
    for r in rows.fetchall():
        d = dict(r._mapping)
        d["fired_at"] = d["fired_at"].isoformat()
        notifications.append(d)

    unread_count_row = await pg.execute(
        text("SELECT COUNT(*) FROM alert_notifications WHERE tenant_id = :tid AND read = FALSE"),
        {"tid": tenant_id},
    )
    unread_count = unread_count_row.scalar() or 0

    return {"notifications": notifications, "unread_count": int(unread_count)}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    await pg.execute(
        text(
            "UPDATE alert_notifications SET read = TRUE "
            "WHERE id = :id AND tenant_id = :tid"
        ),
        {"id": notification_id, "tid": tenant_id},
    )
    await pg.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    await pg.execute(
        text("UPDATE alert_notifications SET read = TRUE WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    await pg.commit()
    return {"ok": True}


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: str,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    await pg.execute(
        text("DELETE FROM alert_notifications WHERE id = :id AND tenant_id = :tid"),
        {"id": notification_id, "tid": tenant_id},
    )
    await pg.commit()


# ── Webhooks ───────────────────────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    url: str
    enabled: bool = True


@router.get("/webhooks")
async def list_webhooks(
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    rows = await pg.execute(
        text("SELECT id, url, enabled, created_at FROM alert_webhooks WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    )
    webhooks = []
    for r in rows.fetchall():
        d = dict(r._mapping)
        d["created_at"] = d["created_at"].isoformat()
        webhooks.append(d)
    return {"webhooks": webhooks}


@router.post("/webhooks", status_code=201)
async def create_webhook(
    body: WebhookCreate,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    wh_secret = secrets.token_hex(32)
    row = await pg.execute(
        text(
            "INSERT INTO alert_webhooks (tenant_id, url, secret, enabled) "
            "VALUES (:tid, :url, :secret, :enabled) "
            "RETURNING id, url, enabled, created_at"
        ),
        {"tid": tenant_id, "url": body.url, "secret": wh_secret, "enabled": body.enabled},
    )
    await pg.commit()
    result = dict(row.fetchone()._mapping)
    result["created_at"] = result["created_at"].isoformat()
    result["secret"] = wh_secret  # Only returned once
    return result


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: str,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    await pg.execute(
        text("DELETE FROM alert_webhooks WHERE id = :id AND tenant_id = :tid"),
        {"id": webhook_id, "tid": tenant_id},
    )
    await pg.commit()
