"""
APScheduler wrapper — runs the alert evaluation cycle every 60 seconds.
"""
import asyncio
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from evaluator import run_evaluation_cycle

log = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def start_scheduler():
    scheduler.add_job(
        run_evaluation_cycle,
        trigger="interval",
        seconds=60,
        id="alert_evaluation",
        replace_existing=True,
        misfire_grace_time=30,
    )
    scheduler.start()
    log.info("Alert scheduler started — evaluating every 60s")


def stop_scheduler():
    scheduler.shutdown(wait=False)
