"""
Materializes per-tenant working tables for the duration of a run so that
heavy analysis doesn't hammer the live ontology_service / event_log_service
indexes. Tables are prefixed _wk_<run_id>_ and dropped in the orchestrator's
finally block. A weekly janitor (see scripts/) drops any orphans older than
24h if a run was killed.
"""
import logging
from sqlalchemy import text

from database import PgSession, TsSession

log = logging.getLogger(__name__)


def wk_records_table(run_id: str) -> str:
    return f"_wk_{run_id.replace('-', '')[:24]}_records"


def wk_events_table(run_id: str) -> str:
    return f"_wk_{run_id.replace('-', '')[:24]}_events"


async def snapshot_records(run_id: str, tenant_id: str) -> str:
    """Copy a tenant's object_records into a working table. Returns the
    fully-qualified working table name (postgres)."""
    table = wk_records_table(run_id)
    async with PgSession() as pg:
        await pg.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        await pg.execute(text(
            f'CREATE UNLOGGED TABLE "{table}" AS '
            f'SELECT id, tenant_id, object_type_id, source_id, data '
            f'FROM object_records WHERE tenant_id = :t'
        ), {"t": tenant_id})
        await pg.execute(text(f'CREATE INDEX ON "{table}" (object_type_id)'))
        await pg.commit()
    log.info("snapshot_records: %s populated", table)
    return table


async def snapshot_events(run_id: str, tenant_id: str, days: int = 180) -> str:
    """Copy recent events for the tenant into a working table on TimescaleDB.
    UNLOGGED for write speed; dropped at end of run."""
    table = wk_events_table(run_id)
    async with TsSession() as ts:
        await ts.execute(text(f'DROP TABLE IF EXISTS "{table}"'))
        await ts.execute(text(
            f'CREATE UNLOGGED TABLE "{table}" AS '
            f'SELECT id, tenant_id, case_id, activity, timestamp, '
            f'       object_type_id, object_id, attributes, cost '
            f'FROM events WHERE tenant_id = :t '
            f'  AND timestamp >= NOW() - (:d || \' days\')::INTERVAL'
        ), {"t": tenant_id, "d": days})
        await ts.execute(text(f'CREATE INDEX ON "{table}" (object_type_id, case_id, timestamp)'))
        await ts.commit()
    log.info("snapshot_events: %s populated", table)
    return table


async def drop_snapshots(run_id: str) -> None:
    rt = wk_records_table(run_id)
    et = wk_events_table(run_id)
    try:
        async with PgSession() as pg:
            await pg.execute(text(f'DROP TABLE IF EXISTS "{rt}"'))
            await pg.commit()
    except Exception as exc:
        log.warning("drop pg snapshot %s: %s", rt, exc)
    try:
        async with TsSession() as ts:
            await ts.execute(text(f'DROP TABLE IF EXISTS "{et}"'))
            await ts.commit()
    except Exception as exc:
        log.warning("drop ts snapshot %s: %s", et, exc)
