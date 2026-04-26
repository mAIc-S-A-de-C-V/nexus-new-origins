"""
Materialized rollups via promoted long-TTL cache.

When a (tenant, ot, query) gets hit > N times in a window, we "promote" it:
the cache TTL goes from 60s to 1h, AND a background task refreshes it every
N seconds so dashboards see instant results without ever waiting on Postgres.

This is a poor man's MATERIALIZED VIEW. It's good enough for dashboards
because:
 - We reuse the existing /aggregate code path; no separate DDL or schema
 - Hits are tracked in-memory (per process) — coarse but cheap
 - Refresh runs out-of-band; user requests never wait on it
 - On write events, the long-TTL entry is invalidated like any other
   cache entry (via shared.query_cache.invalidate_object_type)

Tradeoff: a "hot query" that briefly stops being hot will keep refreshing
in the background until its hit count decays. We periodically prune.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import defaultdict
from typing import Awaitable, Callable, Optional

logger = logging.getLogger("rollup_promoter")

PROMOTE_THRESHOLD = int(os.environ.get("ROLLUP_PROMOTE_THRESHOLD", "20"))     # hits to promote
PROMOTE_WINDOW_S = int(os.environ.get("ROLLUP_PROMOTE_WINDOW_SECONDS", "600"))  # 10 minutes
REFRESH_INTERVAL_S = int(os.environ.get("ROLLUP_REFRESH_INTERVAL_SECONDS", "120"))  # 2 minutes
PRUNE_AFTER_S = int(os.environ.get("ROLLUP_PRUNE_AFTER_SECONDS", "1800"))  # 30 min idle


# key -> [(timestamp, ...), ...]
_hits: dict[str, list[float]] = defaultdict(list)
# key -> (recompute_callable, last_refreshed_at, last_seen_at)
_promoted: dict[str, dict] = {}
_refresher_task: Optional[asyncio.Task] = None
_lock = asyncio.Lock()


def record_hit(key: str) -> int:
    """Record one hit for `key`. Returns the count in the current window.
    O(n) prune within the window; n is tiny in practice (≤ threshold).
    """
    now = time.time()
    cutoff = now - PROMOTE_WINDOW_S
    arr = _hits[key]
    # Trim ahead-of-cutoff entries (cheap because list is roughly time-ordered)
    while arr and arr[0] < cutoff:
        arr.pop(0)
    arr.append(now)
    return len(arr)


async def maybe_promote(
    key: str,
    *,
    recompute: Callable[[], Awaitable[dict]],
    index_key: Optional[str] = None,
) -> bool:
    """If the hit count for `key` crosses the threshold, promote it: refresh
    the long-TTL cache entry and register the recompute callable so the
    background refresher can keep it warm.

    Returns True if the key was newly promoted (or its callable was refreshed).
    """
    count = record_hit(key)

    async with _lock:
        seen = _promoted.get(key)
        if count >= PROMOTE_THRESHOLD:
            now = time.time()
            if seen is None:
                _promoted[key] = {
                    "recompute": recompute,
                    "last_refreshed_at": 0.0,  # forces immediate refresh
                    "last_seen_at": now,
                    "index_key": index_key,
                }
                _ensure_refresher_running()
                return True
            seen["recompute"] = recompute
            seen["last_seen_at"] = now
            seen["index_key"] = index_key
            return False
        else:
            if seen is not None:
                seen["last_seen_at"] = time.time()
            return False


def _ensure_refresher_running() -> None:
    global _refresher_task
    if _refresher_task is None or _refresher_task.done():
        try:
            loop = asyncio.get_event_loop()
            _refresher_task = loop.create_task(_refresher_loop())
        except RuntimeError:
            # No running loop; will start lazily when one becomes available
            pass


async def _refresher_loop() -> None:
    from shared.query_cache import set_cached, ROLLUP_TTL_SECONDS

    while True:
        await asyncio.sleep(REFRESH_INTERVAL_S)
        try:
            await _refresh_due(set_cached)
            _prune_idle()
        except Exception as exc:
            logger.warning("rollup refresher tick failed: %s", exc)


async def _refresh_due(set_cached_fn) -> None:
    from shared.query_cache import ROLLUP_TTL_SECONDS

    now = time.time()
    due: list[tuple[str, dict]] = []
    async with _lock:
        for key, info in _promoted.items():
            if now - info["last_refreshed_at"] >= REFRESH_INTERVAL_S:
                due.append((key, info))

    for key, info in due:
        try:
            value = await info["recompute"]()
            await set_cached_fn(
                key,
                value,
                ttl_seconds=ROLLUP_TTL_SECONDS,
                index_key=info.get("index_key"),
            )
            info["last_refreshed_at"] = time.time()
        except Exception as exc:
            logger.warning("rollup refresh failed for %s: %s", key, exc)


def _prune_idle() -> None:
    """Drop promoted entries that haven't been requested in PRUNE_AFTER_S."""
    now = time.time()
    stale = [k for k, info in _promoted.items() if now - info["last_seen_at"] > PRUNE_AFTER_S]
    for k in stale:
        _promoted.pop(k, None)
        _hits.pop(k, None)


def is_promoted(key: str) -> bool:
    return key in _promoted


def stats() -> dict:
    """Diagnostic — count of hot queries currently promoted, in-flight, etc."""
    return {
        "promoted_count": len(_promoted),
        "tracked_keys": len(_hits),
        "promote_threshold": PROMOTE_THRESHOLD,
        "promote_window_seconds": PROMOTE_WINDOW_S,
        "refresh_interval_seconds": REFRESH_INTERVAL_S,
    }
