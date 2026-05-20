"""
Notification read / dismiss endpoints + webhook management.
"""
import secrets
from datetime import datetime
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
    where += " AND (snoozed_until IS NULL OR snoozed_until <= NOW())"
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
        # Derive a run_link from the column or, for older rows, from details payload.
        if not d.get("run_link"):
            details = d.get("details") or {}
            if isinstance(details, dict):
                if details.get("pipeline_run_id"):
                    d["run_link"] = {"kind": "pipeline", "run_id": details["pipeline_run_id"],
                                     "pipeline_id": details.get("pipeline_id")}
                elif details.get("agent_run_id"):
                    d["run_link"] = {"kind": "agent", "run_id": details["agent_run_id"],
                                     "agent_id": details.get("agent_id")}
        notifications.append(d)

    unread_count_row = await pg.execute(
        text("SELECT COUNT(*) FROM alert_notifications WHERE tenant_id = :tid AND read = FALSE"),
        {"tid": tenant_id},
    )
    unread_count = unread_count_row.scalar() or 0

    return {"notifications": notifications, "unread_count": int(unread_count)}


class SystemNotification(BaseModel):
    title: str
    message: str
    details: dict = {}
    severity: str = "info"


@router.post("/system", status_code=201)
async def post_system_notification(
    body: SystemNotification,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    """Internal endpoint used by insight_engine to push nightly summaries.
    Inserts a synthetic notification under a per-tenant 'system' rule that is
    upserted lazily — keeps the FK contract intact while letting external
    services post notifications without owning a real rule."""
    import json
    # Upsert system rule for this tenant. ON CONFLICT uses (tenant_id, name)
    # — the unique index added in Phase 1.
    row = await pg.execute(text(
        "INSERT INTO alert_rules "
        "(tenant_id, name, rule_type, object_type_id, config, cooldown_minutes, enabled) "
        "VALUES (:tid, 'System', 'system', NULL, '{}'::jsonb, 0, FALSE) "
        "ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name "
        "RETURNING id"
    ), {"tid": tenant_id})
    rule_id = row.fetchone()._mapping["id"]
    await pg.execute(text(
        "INSERT INTO alert_notifications "
        "(tenant_id, rule_id, rule_name, rule_type, severity, message, details) "
        "VALUES (:tid, :rid, :rname, 'system', :sev, :msg, CAST(:det AS jsonb))"
    ), {
        "tid": tenant_id, "rid": rule_id,
        "rname": body.title, "sev": body.severity,
        "msg": body.message,
        "det": json.dumps(body.details),
    })
    await pg.commit()
    return {"ok": True}


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


class SnoozeBody(BaseModel):
    until: datetime


@router.post("/{notification_id}/snooze")
async def snooze_notification(
    notification_id: str,
    body: SnoozeBody,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    result = await pg.execute(
        text(
            "UPDATE alert_notifications SET snoozed_until = :until "
            "WHERE id = :id AND tenant_id = :tid"
        ),
        {"until": body.until, "id": notification_id, "tid": tenant_id},
    )
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Notification not found")
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
