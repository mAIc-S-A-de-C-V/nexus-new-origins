"""
Pipeline Scheduler — auto-triggers pipeline runs based on each SOURCE node's poll_frequency.

Frequency syntax (same as configured in the NodeConfigPanel):
  15m  → every 15 minutes
  1h   → every hour
  6h   → every 6 hours
  1d   → every day
  30s  → every 30 seconds (for development/testing)

On startup the scheduler waits 10 s for the DB to be ready, then enters a tight loop that
checks every 60 s whether any pipeline is overdue for a run.
"""
import asyncio
import logging
import os
import re
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from sqlalchemy import select
from database import AsyncSessionLocal, PipelineRow, PipelineRunRow
from shared.models import Pipeline
from shared.enums import NodeType

logger = logging.getLogger("scheduler")

# How often the scheduler wakes up to check pipelines (seconds)
TICK_INTERVAL = 60

# Any pipeline in RUNNING state longer than this is considered hung and auto-reset.
# Can be overridden per-deployment via env.
STUCK_RUN_TIMEOUT_S = int(os.environ.get("PIPELINE_STUCK_TIMEOUT_S", "1800"))


def _parse_frequency(freq: str) -> int | None:
    """
    Convert a poll_frequency string to seconds.
    Returns None if the frequency is unrecognised or represents 'manual'.
    """
    if not freq or freq.lower() in ("manual", "none", ""):
        return None
    m = re.fullmatch(r"(\d+)\s*(s|m|h|d)", freq.strip().lower())
    if not m:
        return None
    value, unit = int(m.group(1)), m.group(2)
    return value * {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]


def _get_poll_interval(pipeline: Pipeline) -> int | None:
    """Extract the poll_frequency from the first SOURCE node and convert to seconds."""
    for node in pipeline.nodes:
        if node.type == NodeType.SOURCE:
            freq = node.config.get("poll_frequency") or node.config.get("pollFrequency", "")
            return _parse_frequency(str(freq))
    return None


async def _run_pipeline(pipeline_id: str, tenant_id: str) -> None:
    """Trigger a single scheduled pipeline run."""
    from routers.pipelines import _execute_and_persist, _emit_event
    from shared.models import Pipeline

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PipelineRow).where(
                PipelineRow.id == pipeline_id,
                PipelineRow.tenant_id == tenant_id,
            )
        )
        row = result.scalar_one_or_none()
        if not row:
            return

        # Don't start a new run if one is already running
        if row.status == "RUNNING":
            return

        pipeline = Pipeline.model_validate(row.data)
        run_id = str(uuid4())
        now = datetime.now(timezone.utc)

        run_row = PipelineRunRow(
            id=run_id,
            pipeline_id=pipeline_id,
            tenant_id=tenant_id,
            status="RUNNING",
            triggered_by="scheduler",
            rows_in=0,
            rows_out=0,
            started_at=now,
        )
        db.add(run_row)
        row.status = "RUNNING"
        row.data = {**row.data, "status": "RUNNING"}
        await db.commit()

    run_dict = {
        "id": run_id,
        "pipeline_id": pipeline_id,
        "started_at": now.isoformat(),
        "status": "RUNNING",
        "rows_in": 0,
        "rows_out": 0,
        "triggered_by": "scheduler",
    }

    asyncio.create_task(_emit_event({
        "id": str(uuid4()),
        "case_id": run_id,
        "activity": "PIPELINE_RUN_STARTED",
        "timestamp": now.isoformat(),
        "object_type_id": pipeline.target_object_type_id or "",
        "object_id": pipeline_id,
        "pipeline_id": pipeline_id,
        "connector_id": pipeline.connector_ids[0] if pipeline.connector_ids else "",
        "tenant_id": tenant_id,
        "attributes": {"triggered_by": "scheduler"},
    }))

    asyncio.create_task(_execute_and_persist(pipeline, run_dict, run_id, pipeline_id, tenant_id))
    logger.info("Scheduled run started: pipeline=%s run=%s", pipeline_id, run_id)


async def _reset_orphaned_on_boot() -> None:
    """At service startup, any RUNNING run is orphaned (its task didn't survive the restart)."""
    async with AsyncSessionLocal() as db:
        run_result = await db.execute(
            select(PipelineRunRow).where(PipelineRunRow.status == "RUNNING")
        )
        orphaned = run_result.scalars().all()
        if not orphaned:
            return

        pipeline_ids = set()
        for run in orphaned:
            run.status = "FAILED"
            run.finished_at = datetime.now(timezone.utc)
            run.error_message = "Process restarted — run orphaned"
            pipeline_ids.add(run.pipeline_id)

        p_result = await db.execute(select(PipelineRow).where(PipelineRow.id.in_(pipeline_ids)))
        for p_row in p_result.scalars().all():
            if p_row.status == "RUNNING":
                p_row.status = "IDLE"
                p_row.data = {**p_row.data, "status": "IDLE"}

        await db.commit()
        logger.warning("Boot cleanup: reset %d orphaned run(s) across %d pipeline(s)",
                       len(orphaned), len(pipeline_ids))


async def scheduler_loop() -> None:
    """Main scheduler loop. Runs forever, waking up every TICK_INTERVAL seconds."""
    # Give the DB/other services a moment to initialise on cold start
    await asyncio.sleep(10)
    try:
        await _reset_orphaned_on_boot()
    except Exception:
        logger.exception("Boot cleanup failed")
    logger.info("Pipeline scheduler started (tick=%ds)", TICK_INTERVAL)

    while True:
        try:
            await _tick()
        except Exception:
            logger.exception("Scheduler tick error")
        await asyncio.sleep(TICK_INTERVAL)


async def _reset_stuck_runs() -> int:
    """Detect pipelines stuck in RUNNING beyond STUCK_RUN_TIMEOUT_S and auto-fail them."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=STUCK_RUN_TIMEOUT_S)
    reset_count = 0
    async with AsyncSessionLocal() as db:
        run_result = await db.execute(
            select(PipelineRunRow).where(
                PipelineRunRow.status == "RUNNING",
                PipelineRunRow.started_at < cutoff,
            )
        )
        stuck_runs = run_result.scalars().all()
        stuck_pipeline_ids = set()
        for run in stuck_runs:
            run.status = "FAILED"
            run.finished_at = datetime.now(timezone.utc)
            run.error_message = f"Watchdog: run exceeded {STUCK_RUN_TIMEOUT_S}s, auto-reset"
            stuck_pipeline_ids.add(run.pipeline_id)
            reset_count += 1

        if stuck_pipeline_ids:
            p_result = await db.execute(
                select(PipelineRow).where(PipelineRow.id.in_(stuck_pipeline_ids))
            )
            for p_row in p_result.scalars().all():
                if p_row.status == "RUNNING":
                    p_row.status = "IDLE"
                    p_row.data = {**p_row.data, "status": "IDLE"}
                    logger.warning("Watchdog reset stuck pipeline %s", p_row.id)

        if reset_count:
            await db.commit()
    return reset_count


async def _tick() -> None:
    """Check every non-DRAFT pipeline and trigger any that are overdue."""
    now = datetime.now(timezone.utc)

    # Watchdog first so stuck pipelines don't block their own next tick
    try:
        reset = await _reset_stuck_runs()
        if reset:
            logger.info("Watchdog auto-reset %d stuck run(s)", reset)
    except Exception:
        logger.exception("Watchdog error")

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(PipelineRow))
        rows = result.scalars().all()

    for row in rows:
        try:
            pipeline = Pipeline.model_validate(row.data)
        except Exception:
            continue

        # Skip drafts and already-running pipelines
        if pipeline.status in ("DRAFT", "RUNNING"):
            continue

        interval_s = _get_poll_interval(pipeline)
        if not interval_s:
            continue  # manual-only pipeline

        # Determine when the next run is due
        last_run = pipeline.last_run_at
        if last_run is None:
            # Never run before → run immediately
            due = True
        else:
            due = (now - last_run) >= timedelta(seconds=interval_s)

        if due:
            await _run_pipeline(pipeline.id, pipeline.tenant_id)
