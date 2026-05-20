"""
CRUD for alert_routing_rules, alert_oncall_schedules, alert_user_preferences.
Internal endpoints used by the on-call / routing settings tabs.
"""
import json
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_pg_session

router = APIRouter()


# ── routing rules ────────────────────────────────────────────────────────────

class RoutingRuleBody(BaseModel):
    name: str
    condition: dict = {}
    target_user_ids: List[str] = []
    channels: List[str] = ["in_app"]
    priority: int = 100
    enabled: bool = True


@router.get("/routing")
async def list_routing(tenant_id: str = "tenant-001",
                       pg: AsyncSession = Depends(get_pg_session)):
    rows = await pg.execute(text(
        "SELECT * FROM alert_routing_rules WHERE tenant_id = :t ORDER BY priority"
    ), {"t": tenant_id})
    return {"rules": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/routing", status_code=201)
async def create_routing(body: RoutingRuleBody, tenant_id: str = "tenant-001",
                          pg: AsyncSession = Depends(get_pg_session)):
    row = await pg.execute(text(
        "INSERT INTO alert_routing_rules "
        "(tenant_id, name, condition, target_user_ids, channels, priority, enabled) "
        "VALUES (:t, :n, CAST(:c AS jsonb), :u, :ch, :p, :e) RETURNING *"
    ), {"t": tenant_id, "n": body.name, "c": json.dumps(body.condition),
        "u": body.target_user_ids, "ch": body.channels,
        "p": body.priority, "e": body.enabled})
    await pg.commit()
    return dict(row.fetchone()._mapping)


@router.patch("/routing/{rule_id}")
async def update_routing(rule_id: str, body: RoutingRuleBody,
                          tenant_id: str = "tenant-001",
                          pg: AsyncSession = Depends(get_pg_session)):
    await pg.execute(text(
        "UPDATE alert_routing_rules SET name=:n, condition=CAST(:c AS jsonb), "
        "  target_user_ids=:u, channels=:ch, priority=:p, enabled=:e "
        "WHERE id=:id AND tenant_id=:t"
    ), {"id": rule_id, "t": tenant_id, "n": body.name, "c": json.dumps(body.condition),
        "u": body.target_user_ids, "ch": body.channels,
        "p": body.priority, "e": body.enabled})
    await pg.commit()
    return {"ok": True}


@router.delete("/routing/{rule_id}", status_code=204)
async def delete_routing(rule_id: str, tenant_id: str = "tenant-001",
                          pg: AsyncSession = Depends(get_pg_session)):
    await pg.execute(text(
        "DELETE FROM alert_routing_rules WHERE id=:id AND tenant_id=:t"
    ), {"id": rule_id, "t": tenant_id})
    await pg.commit()


# ── on-call schedules ────────────────────────────────────────────────────────

class ScheduleBody(BaseModel):
    name: str
    timezone: str = "UTC"
    rotation: dict | list = []


@router.get("/oncall")
async def list_schedules(tenant_id: str = "tenant-001",
                          pg: AsyncSession = Depends(get_pg_session)):
    rows = await pg.execute(text(
        "SELECT * FROM alert_oncall_schedules WHERE tenant_id = :t ORDER BY created_at DESC"
    ), {"t": tenant_id})
    return {"schedules": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/oncall", status_code=201)
async def create_schedule(body: ScheduleBody, tenant_id: str = "tenant-001",
                           pg: AsyncSession = Depends(get_pg_session)):
    row = await pg.execute(text(
        "INSERT INTO alert_oncall_schedules (tenant_id, name, timezone, rotation) "
        "VALUES (:t, :n, :tz, CAST(:r AS jsonb)) RETURNING *"
    ), {"t": tenant_id, "n": body.name, "tz": body.timezone,
        "r": json.dumps(body.rotation)})
    await pg.commit()
    return dict(row.fetchone()._mapping)


@router.patch("/oncall/{schedule_id}")
async def update_schedule(schedule_id: str, body: ScheduleBody,
                           tenant_id: str = "tenant-001",
                           pg: AsyncSession = Depends(get_pg_session)):
    await pg.execute(text(
        "UPDATE alert_oncall_schedules SET name=:n, timezone=:tz, "
        "  rotation=CAST(:r AS jsonb) WHERE id=:id AND tenant_id=:t"
    ), {"id": schedule_id, "t": tenant_id, "n": body.name, "tz": body.timezone,
        "r": json.dumps(body.rotation)})
    await pg.commit()
    return {"ok": True}


@router.delete("/oncall/{schedule_id}", status_code=204)
async def delete_schedule(schedule_id: str, tenant_id: str = "tenant-001",
                           pg: AsyncSession = Depends(get_pg_session)):
    await pg.execute(text(
        "DELETE FROM alert_oncall_schedules WHERE id=:id AND tenant_id=:t"
    ), {"id": schedule_id, "t": tenant_id})
    await pg.commit()


# ── user preferences ─────────────────────────────────────────────────────────

class UserPrefsBody(BaseModel):
    channel_prefs: dict = {}
    quiet_hours: Optional[dict] = None
    do_not_disturb_until: Optional[str] = None


@router.get("/user-prefs/{user_id}")
async def get_user_prefs(user_id: str, tenant_id: str = "tenant-001",
                          pg: AsyncSession = Depends(get_pg_session)):
    row = await pg.execute(text(
        "SELECT * FROM alert_user_preferences WHERE user_id = :u AND tenant_id = :t"
    ), {"u": user_id, "t": tenant_id})
    r = row.fetchone()
    if not r:
        return {"user_id": user_id, "tenant_id": tenant_id,
                "channel_prefs": {}, "quiet_hours": None}
    return dict(r._mapping)


@router.put("/user-prefs/{user_id}")
async def upsert_user_prefs(user_id: str, body: UserPrefsBody,
                             tenant_id: str = "tenant-001",
                             pg: AsyncSession = Depends(get_pg_session)):
    await pg.execute(text(
        "INSERT INTO alert_user_preferences "
        "(user_id, tenant_id, channel_prefs, quiet_hours, do_not_disturb_until, updated_at) "
        "VALUES (:u, :t, CAST(:cp AS jsonb), CAST(:qh AS jsonb), :dnd, NOW()) "
        "ON CONFLICT (user_id) DO UPDATE SET "
        "  channel_prefs = EXCLUDED.channel_prefs, "
        "  quiet_hours = EXCLUDED.quiet_hours, "
        "  do_not_disturb_until = EXCLUDED.do_not_disturb_until, "
        "  updated_at = NOW()"
    ), {"u": user_id, "t": tenant_id,
        "cp": json.dumps(body.channel_prefs),
        "qh": json.dumps(body.quiet_hours) if body.quiet_hours else None,
        "dnd": body.do_not_disturb_until})
    await pg.commit()
    return {"ok": True}
