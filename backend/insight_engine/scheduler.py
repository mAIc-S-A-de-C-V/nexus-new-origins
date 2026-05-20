"""
APScheduler nightly cron. Reads insight_engine_config per tenant; each tenant's
schedule_cron + timezone are honored independently. Reschedules on config
PATCH via the routers.config module calling reload_schedules().
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import text

from database import PgSession
from orchestrator import run as run_discovery

log = logging.getLogger(__name__)
_scheduler: AsyncIOScheduler | None = None


def _make_job_id(tenant_id: str) -> str:
    return f"insights:{tenant_id}"


async def _list_configs():
    async with PgSession() as pg:
        rows = await pg.execute(text(
            "SELECT tenant_id, enabled, schedule_cron, timezone "
            "FROM insight_engine_config"))
        return [dict(r._mapping) for r in rows.fetchall()]


def _parse_cron(spec: str, tz: str) -> CronTrigger:
    parts = (spec or "0 3 * * *").split()
    if len(parts) != 5:
        parts = ["0", "3", "*", "*", "*"]
    return CronTrigger(minute=parts[0], hour=parts[1],
                       day=parts[2], month=parts[3], day_of_week=parts[4],
                       timezone=tz or "UTC")


async def reload_schedules():
    """Re-read config and rewire all jobs."""
    global _scheduler
    if _scheduler is None:
        return
    cfgs = await _list_configs()
    desired = {c["tenant_id"]: c for c in cfgs if c.get("enabled")}
    # Remove jobs for tenants no longer enabled
    for job in list(_scheduler.get_jobs()):
        if job.id.startswith("insights:"):
            tid = job.id.split(":", 1)[1]
            if tid not in desired:
                _scheduler.remove_job(job.id)
    # Add or update jobs
    for tid, c in desired.items():
        trig = _parse_cron(c.get("schedule_cron"), c.get("timezone") or "UTC")
        _scheduler.add_job(run_discovery, trigger=trig, args=[tid],
                           id=_make_job_id(tid), replace_existing=True,
                           coalesce=True, max_instances=1, misfire_grace_time=600)


def start_scheduler():
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler()
    _scheduler.start()
    log.info("insight_engine scheduler started")
    # Kick an async reload after startup
    import asyncio
    asyncio.get_event_loop().create_task(reload_schedules())


def stop_scheduler():
    global _scheduler
    if _scheduler is None:
        return
    _scheduler.shutdown(wait=False)
    _scheduler = None
