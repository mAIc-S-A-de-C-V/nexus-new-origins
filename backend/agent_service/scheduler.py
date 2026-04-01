"""
Agent Scheduler — polls AgentScheduleRow for due jobs and fires autonomous agent runs.
Uses APScheduler with a cron trigger per schedule. Each run creates a thread, sends the
prompt, and persists messages. Because agents have action_propose enabled they will
naturally push proposed writes to the Human Actions queue.
"""
import asyncio
import logging
from datetime import datetime, timezone
from uuid import uuid4

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    AgentConfigRow, AgentScheduleRow, AgentThreadRow, AgentRunRow,
    AsyncSessionLocal,
)
from runtime import run_agent

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None


async def fire_schedule(schedule_id: str, tenant_id: str = "tenant-001") -> None:
    """Run the agent for a given schedule row. Called by APScheduler or manually."""
    async with AsyncSessionLocal() as db:
        sched_result = await db.execute(
            select(AgentScheduleRow).where(AgentScheduleRow.id == schedule_id)
        )
        schedule = sched_result.scalar_one_or_none()
        if not schedule or not schedule.enabled:
            return

        agent_result = await db.execute(
            select(AgentConfigRow).where(AgentConfigRow.id == schedule.agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent or not agent.enabled:
            return

        # Create a thread to hold this scheduled run
        thread = AgentThreadRow(
            id=str(uuid4()),
            tenant_id=tenant_id,
            agent_id=agent.id,
            title=f"[Auto] {schedule.name} — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
            created_by="scheduler",
        )
        db.add(thread)
        await db.flush()  # get thread.id before commit

        logger.info("Scheduler firing agent=%s schedule=%s thread=%s", agent.id, schedule_id, thread.id)

        # Build system prompt (same knowledge-scope injection as threads.py)
        system_prompt = agent.system_prompt
        knowledge_scope = agent.knowledge_scope
        if knowledge_scope:
            scope_lines = "\n".join(
                f"  - {e.get('label', e.get('object_type_id', '?'))}" for e in knowledge_scope
            )
            system_prompt = system_prompt.rstrip() + f"\n\nDATA SCOPE:\n{scope_lines}"

        try:
            outcome = await run_agent(
                agent_id=agent.id,
                system_prompt=system_prompt,
                model=agent.model,
                enabled_tools=agent.enabled_tools or [],
                max_iterations=agent.max_iterations,
                conversation_history=[],
                new_user_message=schedule.prompt,
                tenant_id=tenant_id,
                knowledge_scope=knowledge_scope,
            )

            # Persist run record
            tool_calls = []
            for msg in outcome.get("new_messages", []):
                content = msg.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_use":
                            tool_calls.append({"tool": block.get("name")})

            db.add(AgentRunRow(
                id=str(uuid4()),
                agent_id=agent.id,
                thread_id=thread.id,
                tenant_id=tenant_id,
                iterations=outcome.get("iterations", 0),
                tool_calls=tool_calls,
                final_text_len=len(outcome.get("final_text", "")),
                is_test=False,
                error=outcome.get("error"),
            ))
        except Exception as e:
            logger.error("Scheduler error agent=%s: %s", agent.id, e)
            db.add(AgentRunRow(
                id=str(uuid4()), agent_id=agent.id, thread_id=thread.id,
                tenant_id=tenant_id, iterations=0, tool_calls=[],
                final_text_len=0, is_test=False, error=str(e),
            ))

        # Update last_run_at
        schedule.last_run_at = datetime.now(timezone.utc)
        await db.commit()


async def _reload_jobs(scheduler: AsyncIOScheduler) -> None:
    """Fetch all enabled schedules from DB and sync APScheduler jobs."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AgentScheduleRow).where(AgentScheduleRow.enabled == True)  # noqa: E712
        )
        schedules = result.scalars().all()

    # Remove jobs no longer in DB
    active_ids = {s.id for s in schedules}
    for job in scheduler.get_jobs():
        if job.id not in active_ids:
            job.remove()

    # Add / update jobs
    for sched in schedules:
        try:
            trigger = CronTrigger.from_crontab(sched.cron_expression, timezone="UTC")
            if scheduler.get_job(sched.id):
                scheduler.reschedule_job(sched.id, trigger=trigger)
            else:
                scheduler.add_job(
                    fire_schedule,
                    trigger=trigger,
                    id=sched.id,
                    args=[sched.id, sched.tenant_id],
                    replace_existing=True,
                    misfire_grace_time=300,
                )
        except Exception as e:
            logger.warning("Bad cron for schedule %s: %s", sched.id, e)


def start_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is not None:
        return _scheduler

    scheduler = AsyncIOScheduler()

    # Reload jobs from DB every 60 seconds so newly created schedules are picked up
    scheduler.add_job(
        _reload_jobs,
        trigger="interval",
        seconds=60,
        id="_reload_jobs",
        args=[scheduler],
    )

    scheduler.start()
    _scheduler = scheduler

    # Do an immediate load
    asyncio.ensure_future(_reload_jobs(scheduler))

    logger.info("Agent scheduler started.")
    return scheduler


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None
