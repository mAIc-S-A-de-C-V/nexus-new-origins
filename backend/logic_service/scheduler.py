"""
APScheduler integration for Logic Function recurring schedules.
"""
import uuid
import logging
from datetime import datetime, timezone
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

_scheduler = AsyncIOScheduler(timezone="UTC")


def get_scheduler() -> AsyncIOScheduler:
    return _scheduler


def _parse_cron(cron: str) -> CronTrigger:
    """Parse a 5-part cron string into an APScheduler CronTrigger."""
    parts = cron.strip().split()
    if len(parts) != 5:
        raise ValueError(f"Invalid cron expression (need 5 fields): {cron}")
    minute, hour, day, month, day_of_week = parts
    return CronTrigger(
        minute=minute, hour=hour, day=day,
        month=month, day_of_week=day_of_week,
        timezone="UTC",
    )


def register_schedule(row) -> None:
    """Add or replace an APScheduler job for a LogicScheduleRow."""
    job_id = f"schedule:{row.id}"

    async def _run():
        from database import AsyncSessionLocal, LogicScheduleRow, LogicFunctionRow
        from runner import execute_function
        from sqlalchemy import select
        import uuid as _uuid

        async with AsyncSessionLocal() as session:
            try:
                sched = await session.get(LogicScheduleRow, row.id)
                if not sched or not sched.enabled:
                    return

                fn = await session.get(LogicFunctionRow, sched.function_id)
                if not fn:
                    logger.warning("Schedule %s: function %s not found", row.id, sched.function_id)
                    return

                logger.info("Running scheduled function %s (%s)", fn.name, fn.id)
                result = await execute_function(
                    function_id=fn.id,
                    blocks=fn.blocks or [],
                    output_block=fn.output_block or "",
                    inputs=sched.inputs or {},
                    tenant_id=sched.tenant_id,
                )

                # Record the run
                from database import LogicRunRow
                run_row = LogicRunRow(
                    id=str(_uuid.uuid4()),
                    tenant_id=sched.tenant_id,
                    function_id=fn.id,
                    function_version=fn.version,
                    inputs=sched.inputs or {},
                    status="completed" if not result.get("error") else "failed",
                    trace=result.get("trace"),
                    output=result.get("output"),
                    error=result.get("error"),
                    triggered_by=f"schedule:{sched.id}",
                    started_at=datetime.now(timezone.utc),
                    finished_at=datetime.now(timezone.utc),
                )
                session.add(run_row)

                sched.last_run_at = datetime.now(timezone.utc)
                await session.commit()
                logger.info("Scheduled run complete for %s — status: %s", fn.name, run_row.status)

            except Exception as e:
                logger.error("Scheduled run error for schedule %s: %s", row.id, e)

    try:
        trigger = _parse_cron(row.cron)
        _scheduler.add_job(_run, trigger, id=job_id, replace_existing=True)
        logger.info("Registered schedule %s: %s", row.id, row.cron)
    except Exception as e:
        logger.error("Failed to register schedule %s: %s", row.id, e)


def remove_schedule(schedule_id: str) -> None:
    job_id = f"schedule:{schedule_id}"
    if _scheduler.get_job(job_id):
        _scheduler.remove_job(job_id)


async def load_schedules_from_db() -> None:
    """On startup, reload all enabled schedules from the DB."""
    from database import AsyncSessionLocal, LogicScheduleRow
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        rows = await session.execute(
            select(LogicScheduleRow).where(LogicScheduleRow.enabled == True)
        )
        schedules = rows.scalars().all()
        for row in schedules:
            register_schedule(row)
        logger.info("Loaded %d schedules from DB", len(schedules))
