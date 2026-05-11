"""
APScheduler glue. Registers cron-trigger functions when installs are created
(or the service starts up), and tears them down on uninstall.
"""
from __future__ import annotations
import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    AsyncSessionLocal, ExternalAppFunctionRow, ExternalAppRunRow,
    ExternalAppInstallRow,
)
from runtime.python_sandbox import execute_function_code, NexusServerClient

log = logging.getLogger("apps_service.scheduler")
_scheduler: AsyncIOScheduler | None = None


def get_scheduler() -> AsyncIOScheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = AsyncIOScheduler(timezone="UTC")
    return _scheduler


async def run_function_now(
    function_id: str,
    trigger: str = "manual",
    inputs: dict | None = None,
    event: dict | None = None,
) -> str:
    """
    Execute one function. Returns the run_id. Always writes an ExternalAppRunRow.
    """
    async with AsyncSessionLocal() as db:
        fn = (await db.execute(
            select(ExternalAppFunctionRow).where(ExternalAppFunctionRow.id == function_id)
        )).scalar_one_or_none()
        if not fn or not fn.enabled:
            return ""
        install = (await db.execute(
            select(ExternalAppInstallRow).where(ExternalAppInstallRow.id == fn.install_id)
        )).scalar_one_or_none()
        if not install or not install.enabled:
            return ""

        run_id = str(uuid.uuid4())
        run_row = ExternalAppRunRow(
            id=run_id, function_id=fn.id, install_id=fn.install_id, tenant_id=fn.tenant_id,
            trigger=trigger, input=inputs, status="running",
        )
        db.add(run_row)
        await db.commit()

        # Build a system-tier payload to drive the RPC dispatcher in-process.
        from jwt_app import mint_app_token, decode_app_token
        from urllib.parse import urlparse
        # Use mint+decode roundtrip so the payload format matches HTTP RPC exactly.
        # For server-side runs, the "user" identity is "system:<app_id>".
        token, _ = mint_app_token(
            install_id=install.id,
            app_id=install.app_id,
            tenant_id=install.tenant_id,
            user_id=f"system:{install.app_id}",
            user_email="system@nexus.internal",
            user_role="system",
            scopes=install.scopes_granted,
            origin="system",
        )
        payload = decode_app_token(token, expected_install_id=install.id)

        # Inline dispatcher that mirrors the HTTP one but bypasses jwt verify
        # and rate limits (system runs are bounded by APScheduler concurrency).
        from routers.rpc import DISPATCH

        async def _dispatch(p: dict, method: str, args: dict, db_) -> dict:
            handler = DISPATCH.get(method)
            if not handler:
                return {"ok": False, "error": "unknown_method"}
            try:
                result = await handler(p, args, db_)
                return {"ok": True, "result": result}
            except Exception as e:
                return {"ok": False, "error": "internal_error", "detail": str(e)}

        client = NexusServerClient(_dispatch, payload, db)

        t0 = time.monotonic()
        result = await execute_function_code(
            fn.code, nexus=client, inputs=inputs, event=event, timeout_ms=fn.timeout_ms,
        )
        elapsed = int((time.monotonic() - t0) * 1000)

        run_row.duration_ms = elapsed
        run_row.finished_at = datetime.now(timezone.utc)
        run_row.logs = "\n".join(result.logs)[:32000]
        if result.error:
            run_row.status = "error" if "timeout" not in (result.error or "") else "timeout"
            run_row.error_message = result.error
        else:
            run_row.status = "ok"
            try:
                run_row.output = result.return_value if isinstance(result.return_value, (dict, list, str, int, float, bool, type(None))) else str(result.return_value)
            except Exception:
                run_row.output = {"_repr": str(result.return_value)[:8000]}

        fn.last_run_at = run_row.finished_at
        fn.last_run_status = run_row.status
        await db.commit()
        return run_id


def _job_id(function_id: str) -> str:
    return f"apps.fn.{function_id}"


async def register_install_schedules(install_id: str, db: AsyncSession) -> None:
    """Register all schedule-triggered functions for one install."""
    sched = get_scheduler()
    if not sched.running:
        return
    rows = (await db.execute(
        select(ExternalAppFunctionRow).where(ExternalAppFunctionRow.install_id == install_id)
    )).scalars().all()
    for fn in rows:
        if fn.trigger_type != "schedule":
            continue
        cron = fn.trigger_config.get("cron") if isinstance(fn.trigger_config, dict) else None
        if not cron:
            continue
        try:
            trigger = CronTrigger.from_crontab(cron, timezone="UTC")
        except Exception as e:
            log.warning(f"bad cron '{cron}' for function {fn.id}: {e}")
            continue
        job_id = _job_id(fn.id)
        try:
            sched.remove_job(job_id)
        except Exception:
            pass
        sched.add_job(
            run_function_now, trigger=trigger, id=job_id,
            args=[fn.id, "schedule", None, None],
            max_instances=1, coalesce=True, misfire_grace_time=300,
        )


async def load_all_schedules() -> None:
    sched = get_scheduler()
    if not sched.running:
        sched.start()
    async with AsyncSessionLocal() as db:
        installs = (await db.execute(
            select(ExternalAppInstallRow).where(ExternalAppInstallRow.enabled.is_(True))
        )).scalars().all()
        for inst in installs:
            await register_install_schedules(inst.id, db)


async def unregister_install_schedules(install_id: str) -> None:
    sched = get_scheduler()
    if not sched.running:
        return
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(ExternalAppFunctionRow).where(ExternalAppFunctionRow.install_id == install_id)
        )).scalars().all()
        for fn in rows:
            try:
                sched.remove_job(_job_id(fn.id))
            except Exception:
                pass
