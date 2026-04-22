"""
Cron-based pipeline scheduler.
Runs alongside the existing poll-frequency scheduler (scheduler.py).
Wakes every 60s, checks all enabled pipeline schedules, fires overdue ones.
"""
import asyncio
import logging
from datetime import datetime, timezone
from uuid import uuid4

from croniter import croniter
from sqlalchemy import select
from database import AsyncSessionLocal, PipelineScheduleRow, PipelineRow

logger = logging.getLogger("cron_scheduler")

TICK_INTERVAL = 60


async def fire_pipeline_schedule(pipeline_id: str, schedule_id: str, tenant_id: str) -> None:
    """Trigger a single pipeline run for a schedule (also used by run-now endpoint)."""
    from scheduler import _run_pipeline

    # Check if pipeline is already running — don't update last_run_at if we can't actually run
    async with AsyncSessionLocal() as db:
        p_result = await db.execute(
            select(PipelineRow).where(
                PipelineRow.id == pipeline_id,
                PipelineRow.tenant_id == tenant_id,
            )
        )
        p_row = p_result.scalar_one_or_none()
        if p_row and p_row.status == "RUNNING":
            logger.info("Pipeline %s already running, skipping scheduled fire", pipeline_id)
            return

    # Pipeline is not running — update last_run_at and fire
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PipelineScheduleRow).where(PipelineScheduleRow.id == schedule_id)
        )
        sched = result.scalar_one_or_none()
        if sched:
            sched.last_run_at = datetime.now(timezone.utc)
            await db.commit()
    await _run_pipeline(pipeline_id, tenant_id)


async def _cron_tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PipelineScheduleRow).where(PipelineScheduleRow.enabled == True)
        )
        schedules = result.scalars().all()

    for sched in schedules:
        try:
            cron = croniter(sched.cron_expression, start_time=sched.last_run_at or now)
            next_run = cron.get_next(datetime)
            if next_run.tzinfo is None:
                next_run = next_run.replace(tzinfo=timezone.utc)
            if next_run <= now:
                logger.info("Firing cron schedule %s for pipeline %s", sched.id, sched.pipeline_id)
                asyncio.create_task(fire_pipeline_schedule(sched.pipeline_id, sched.id, sched.tenant_id))
        except Exception:
            logger.exception("Error evaluating schedule %s", sched.id)


async def cron_scheduler_loop() -> None:
    await asyncio.sleep(15)  # slight offset from the poll scheduler
    logger.info("Cron pipeline scheduler started")
    while True:
        try:
            await _cron_tick()
        except Exception:
            logger.exception("Cron scheduler tick error")
        await asyncio.sleep(TICK_INTERVAL)
