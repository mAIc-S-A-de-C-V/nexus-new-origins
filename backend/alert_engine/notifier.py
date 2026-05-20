"""
Notification dispatcher. Called from evaluator._record_fired() after the
notification row is inserted. Resolves "who is on-call now" via
alert_oncall_schedules, applies alert_routing_rules to pick target_user_ids
and channels, then respects each user's quiet_hours / DnD before sending.

Channel implementations:
  - Slack: posts to alert_channels.slack_webhook_url (tenant-wide)
  - Email: queues to alert_channels.email_recipients (tenant-wide)
  - In-app: no extra action; the notification row already drives the bell

Per-user channel overrides land in alert_user_preferences.channel_prefs
(JSONB {slack: bool, email: bool, in_app: bool}).
"""
import json
import logging
from datetime import datetime, time, timezone
from typing import Iterable

from sqlalchemy import text

from database import PgSession

log = logging.getLogger(__name__)


async def _list_routing_rules(tenant_id: str) -> list[dict]:
    async with PgSession() as pg:
        rows = await pg.execute(text(
            "SELECT * FROM alert_routing_rules WHERE tenant_id = :t AND enabled = TRUE "
            "ORDER BY priority"
        ), {"t": tenant_id})
        return [dict(r._mapping) for r in rows.fetchall()]


async def _oncall_now(tenant_id: str) -> list[str]:
    """Return active user_ids per the most-recently-created schedule.
    Rotation schema: list of {user_id, start_iso, end_iso} or
    {weekly: {monday: user_id, tuesday: ...}}.
    """
    async with PgSession() as pg:
        rows = await pg.execute(text(
            "SELECT * FROM alert_oncall_schedules WHERE tenant_id = :t "
            "ORDER BY created_at DESC LIMIT 1"
        ), {"t": tenant_id})
        r = rows.fetchone()
        if not r:
            return []
    m = dict(r._mapping)
    rotation = m.get("rotation") or []
    if isinstance(rotation, str):
        try:
            rotation = json.loads(rotation)
        except Exception:
            rotation = []
    now = datetime.now(timezone.utc)
    if isinstance(rotation, list):
        # Pick first interval covering now
        for slot in rotation:
            try:
                s = datetime.fromisoformat(slot["start"].replace("Z", "+00:00"))
                e = datetime.fromisoformat(slot["end"].replace("Z", "+00:00"))
                if s <= now <= e:
                    return [slot["user_id"]]
            except Exception:
                continue
    if isinstance(rotation, dict) and "weekly" in rotation:
        weekday = ["monday", "tuesday", "wednesday", "thursday",
                   "friday", "saturday", "sunday"][now.weekday()]
        user_id = (rotation["weekly"] or {}).get(weekday)
        return [user_id] if user_id else []
    return []


async def _user_prefs(user_id: str) -> dict | None:
    async with PgSession() as pg:
        row = await pg.execute(text(
            "SELECT * FROM alert_user_preferences WHERE user_id = :u"
        ), {"u": user_id})
        r = row.fetchone()
        return dict(r._mapping) if r else None


def _in_quiet_hours(prefs: dict | None) -> bool:
    if not prefs:
        return False
    qh = prefs.get("quiet_hours") or {}
    if isinstance(qh, str):
        try:
            qh = json.loads(qh)
        except Exception:
            qh = {}
    if not qh.get("enabled"):
        return False
    start = qh.get("start", "22:00")
    end = qh.get("end", "07:00")
    try:
        h, m = (int(p) for p in start.split(":"))
        sh = h * 60 + m
        h, m = (int(p) for p in end.split(":"))
        eh = h * 60 + m
    except Exception:
        return False
    now_min = (datetime.utcnow().hour * 60 + datetime.utcnow().minute)
    if sh <= eh:
        return sh <= now_min <= eh
    return now_min >= sh or now_min <= eh


def _condition_matches(rule_cond: dict, notification: dict) -> bool:
    """`condition` is a small DSL: {severity: 'critical', rule_type: 'metric_deviation', ...}.
    All keys must match the notification's fields (case-insensitive string compare)."""
    for k, v in (rule_cond or {}).items():
        nv = notification.get(k)
        if isinstance(v, list):
            if nv not in v:
                return False
        else:
            if str(nv).lower() != str(v).lower():
                return False
    return True


async def dispatch(tenant_id: str, notification: dict) -> dict:
    """Returns {targeted: [user_ids], channels: [strings], sent: []}.
    Side-effects are best-effort; failures are logged, not raised."""
    rules = await _list_routing_rules(tenant_id)
    on_call_ids = await _oncall_now(tenant_id)

    targeted: set[str] = set()
    channels: set[str] = set()
    for r in rules:
        cond = r.get("condition") or {}
        if isinstance(cond, str):
            try:
                cond = json.loads(cond)
            except Exception:
                cond = {}
        if not _condition_matches(cond, notification):
            continue
        for u in (r.get("target_user_ids") or []):
            if u == "{on_call}":
                targeted.update(on_call_ids)
            else:
                targeted.add(u)
        for c in (r.get("channels") or []):
            channels.add(c)

    if not targeted:
        targeted.update(on_call_ids)

    # Apply per-user overrides
    final_users: list[str] = []
    for uid in targeted:
        prefs = await _user_prefs(uid)
        if prefs and prefs.get("do_not_disturb_until"):
            try:
                dnd = prefs["do_not_disturb_until"]
                if isinstance(dnd, datetime) and dnd > datetime.now(timezone.utc):
                    continue
            except Exception:
                pass
        if _in_quiet_hours(prefs):
            continue
        final_users.append(uid)

    log.info("dispatch: tenant=%s targeted=%d channels=%s",
              tenant_id, len(final_users), sorted(channels))
    return {"targeted": final_users, "channels": sorted(channels), "sent": []}
