"""
Redis-backed result cache for /aggregate (and other expensive read paths).

Cache key: agg:{tenant_id}:{ot_id}:{sha256(query_canonical_json)}

- get_cached(key) -> dict | None
- set_cached(key, value, ttl_seconds)
- invalidate_object_type(tenant_id, ot_id)  — wipes all cached aggregations for an OT
- canonical_query_hash(...)                 — deterministic hash of a query body

The cache is best-effort: every operation swallows redis errors and logs them so
that a Redis outage degrades to a slow-but-correct read path rather than failure.

Single-flight protection (cache stampede): get_or_compute wraps a callable so
the second concurrent caller for the same key waits for the first to finish.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger("query_cache")

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
DEFAULT_TTL_SECONDS = int(os.environ.get("QUERY_CACHE_TTL_SECONDS", "60"))
ROLLUP_TTL_SECONDS = int(os.environ.get("QUERY_CACHE_ROLLUP_TTL_SECONDS", "3600"))

_client = None
_in_flight: dict[str, asyncio.Future] = {}


def _get_client():
    """Lazy singleton — avoids importing redis if the cache is never used."""
    global _client
    if _client is None:
        try:
            import redis.asyncio as aioredis
            _client = aioredis.from_url(REDIS_URL, encoding="utf-8", decode_responses=True)
        except Exception as exc:
            logger.warning("redis client unavailable: %s — cache disabled", exc)
            _client = False  # sentinel: don't keep retrying
    return _client if _client is not False else None


def canonical_query_hash(payload: Any) -> str:
    """Deterministic hash of any JSON-serializable payload.
    Sorts dict keys so semantically-equal queries get the same hash.
    """
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def aggregate_cache_key(tenant_id: str, ot_id: str, query_hash: str) -> str:
    return f"agg:{tenant_id}:{ot_id}:{query_hash}"


def aggregate_index_key(tenant_id: str, ot_id: str) -> str:
    """A redis SET keyed per (tenant, ot) listing all aggregate cache keys for it.
    Used to invalidate everything for one object type in one shot.
    """
    return f"agg-idx:{tenant_id}:{ot_id}"


async def get_cached(key: str) -> Optional[dict]:
    client = _get_client()
    if client is None:
        return None
    try:
        raw = await client.get(key)
    except Exception as exc:
        logger.warning("redis get failed: %s", exc)
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


async def set_cached(
    key: str,
    value: dict,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    *,
    index_key: Optional[str] = None,
) -> None:
    client = _get_client()
    if client is None:
        return
    try:
        await client.set(key, json.dumps(value, default=str), ex=max(1, ttl_seconds))
        if index_key:
            await client.sadd(index_key, key)
            await client.expire(index_key, max(ttl_seconds * 2, 600))
    except Exception as exc:
        logger.warning("redis set failed: %s", exc)


async def invalidate_object_type(tenant_id: str, ot_id: str) -> int:
    """Wipe every aggregate cache entry for one (tenant, ot). Returns the count
    of keys deleted, or 0 if redis is unavailable.

    Called from the records write paths (sync, patch, ingest, delete) so reads
    immediately reflect the new state.
    """
    client = _get_client()
    if client is None:
        return 0
    idx_key = aggregate_index_key(tenant_id, ot_id)
    try:
        members = await client.smembers(idx_key)
        if not members:
            await client.delete(idx_key)
            return 0
        # Pipeline the deletes to avoid N round-trips. We only count actual
        # cache entry deletes — the index-set delete is bookkeeping.
        async with client.pipeline(transaction=False) as pipe:
            for m in members:
                pipe.delete(m)
            pipe.delete(idx_key)
            results = await pipe.execute()
        # Last result is the index-set delete; ignore it.
        return sum(1 for r in results[:-1] if r)
    except Exception as exc:
        logger.warning("invalidate failed for %s/%s: %s", tenant_id, ot_id, exc)
        return 0


async def get_or_compute(
    key: str,
    compute: Callable[[], Awaitable[dict]],
    *,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    index_key: Optional[str] = None,
) -> tuple[dict, bool]:
    """Single-flight fetch: returns (value, from_cache).

    If the value is in cache, returns it. Otherwise runs `compute` once even if
    multiple callers race on the same key, and caches the result.
    """
    cached = await get_cached(key)
    if cached is not None:
        return cached, True

    # Single-flight: dedupe concurrent in-process compute() calls per key.
    in_flight = _in_flight.get(key)
    if in_flight is not None:
        try:
            return await in_flight, False
        except Exception:
            # Fall through and retry on this caller
            pass

    fut: asyncio.Future = asyncio.get_event_loop().create_future()
    _in_flight[key] = fut
    try:
        value = await compute()
        if not fut.done():
            fut.set_result(value)
    except Exception as exc:
        if not fut.done():
            fut.set_exception(exc)
        raise
    finally:
        _in_flight.pop(key, None)

    await set_cached(key, value, ttl_seconds=ttl_seconds, index_key=index_key)
    return value, False
