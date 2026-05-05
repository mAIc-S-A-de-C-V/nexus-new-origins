"""
Slow-query → auto-index. The /aggregate endpoint records query latencies; when
a query crosses a threshold AND its groupBy / time_bucket / filter fields lack
an index, this module schedules a background CREATE INDEX CONCURRENTLY on the
records table.

Idempotent and bounded: we keep an in-memory set of fields we've already
attempted to index for this process, plus we use IF NOT EXISTS in the SQL.

Doesn't try to be clever about composite indexes — Postgres can combine
single-column expression indexes via bitmap heap scan, which is good enough.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Iterable, Optional

logger = logging.getLogger("index_advisor")

SLOW_QUERY_MS = int(os.environ.get("AGGREGATE_SLOW_THRESHOLD_MS", "500"))
AUTO_INDEX_ENABLED = os.environ.get("AGGREGATE_AUTO_INDEX", "true").lower() == "true"

_SAFE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_attempted: set[str] = set()
_attempted_ts: set[str] = set()  # separate tracking for timestamptz indexes
_lock = asyncio.Lock()


def _index_name(field: str) -> str:
    return f"idx_or_data_{field.lower()}"[:63]


def _ts_index_name(field: str) -> str:
    return f"idx_or_data_{field.lower()}_ts"[:63]


def _ts_index_expression(field: str) -> str:
    """The exact CASE expression that records.py emits for time_bucket fields.
    Index expression and query expression MUST match character-for-character
    for the planner to substitute the index — keep this string in lockstep
    with build_aggregate_sql's `ts_safe` template.
    """
    return (
        f"(CASE WHEN data->>'{field}' ~ "
        f"'^[[:digit:]]{{4}}-[[:digit:]]{{2}}-[[:digit:]]{{2}}' "
        f"THEN NULLIF(data->>'{field}', '')::timestamptz "
        f"ELSE NULL END)"
    )


async def maybe_create_indexes_for(
    *,
    engine,
    fields: Iterable[str],
    elapsed_ms: float,
    threshold_ms: Optional[int] = None,
) -> list[str]:
    """If `elapsed_ms` exceeded the slow threshold, schedule CREATE INDEX
    CONCURRENTLY for any fields we haven't already tried.

    Returns the list of fields for which a creation was scheduled.
    Runs the DDL in a background asyncio task so the request thread doesn't wait.
    """
    if not AUTO_INDEX_ENABLED:
        return []

    threshold = threshold_ms if threshold_ms is not None else SLOW_QUERY_MS
    if elapsed_ms < threshold:
        return []

    fresh: list[str] = []
    async with _lock:
        for f in fields:
            if not f or not _SAFE.match(f):
                continue
            if f in _attempted:
                continue
            _attempted.add(f)
            fresh.append(f)

    if not fresh:
        return []

    asyncio.create_task(_create_indexes(engine, fresh))
    logger.info(
        "scheduled CREATE INDEX CONCURRENTLY for %s (slow query %.0fms)",
        ",".join(fresh),
        elapsed_ms,
    )
    return fresh


async def _create_indexes(engine, fields: list[str]) -> None:
    from sqlalchemy import text
    try:
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            for f in fields:
                idx_name = _index_name(f)
                sql = (
                    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {idx_name} "
                    f"ON object_records ((data->>'{f}'))"
                )
                try:
                    await conn.execute(text(sql))
                    logger.info("created index %s on data->>'%s'", idx_name, f)
                except Exception as exc:
                    logger.warning("CREATE INDEX %s failed: %s — will retry next session", idx_name, exc)
                    # Forget this attempt so a future slow query can retry.
                    async with _lock:
                        _attempted.discard(f)
    except Exception as exc:
        logger.warning("auto-index DDL connection failed: %s", exc)
        # Forget all attempts so we retry next time
        async with _lock:
            for f in fields:
                _attempted.discard(f)


async def maybe_create_timestamp_index(
    *,
    engine,
    field: Optional[str],
    elapsed_ms: float,
    threshold_ms: Optional[int] = None,
) -> bool:
    """Slow time-bucket query → CREATE INDEX on the timestamptz CASE
    expression. The text-column index from `maybe_create_indexes_for` doesn't
    help when the query filters by `(...)::timestamptz >= $3` — the planner
    can't substitute a text index for a timestamptz comparison. This builds
    an expression index whose body matches the SQL builder's ts_safe template
    exactly, so the planner can do an index range scan over time windows.

    Returns True if the build was scheduled.
    """
    if not AUTO_INDEX_ENABLED or not field or not _SAFE.match(field):
        return False
    threshold = threshold_ms if threshold_ms is not None else SLOW_QUERY_MS
    if elapsed_ms < threshold:
        return False
    async with _lock:
        if field in _attempted_ts:
            return False
        _attempted_ts.add(field)

    asyncio.create_task(_create_timestamp_index(engine, field))
    logger.info(
        "scheduled timestamptz index for %s (slow time-bucket query %.0fms)",
        field, elapsed_ms,
    )
    return True


async def _create_timestamp_index(engine, field: str) -> None:
    """Build the partial expression index. Failure is non-fatal — queries fall
    back to seqscan + CASE, same as before the index existed.

    Bad rows are the main risk: if `data->>'{field}'` matches the regex but
    fails the timestamptz cast (e.g. "2025-13-99"), the build aborts. We log
    and clear the attempted-set so a future slow query can retry once the
    bad rows are cleaned. Postgres' CONCURRENTLY mode means the failed build
    leaves no half-formed index behind.
    """
    from sqlalchemy import text
    idx_name = _ts_index_name(field)
    expr = _ts_index_expression(field)
    sql = (
        f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {idx_name} "
        f"ON object_records ({expr})"
    )
    try:
        async with engine.connect() as conn:
            await conn.execution_options(isolation_level="AUTOCOMMIT")
            await conn.execute(text(sql))
            logger.info("created timestamptz index %s on %s", idx_name, field)
    except Exception as exc:
        logger.warning(
            "CREATE INDEX %s (timestamptz) failed: %s — will retry next session",
            idx_name, exc,
        )
        async with _lock:
            _attempted_ts.discard(field)
