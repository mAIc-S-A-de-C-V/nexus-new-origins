"""
Unit tests for shared.rollup_promoter — hit counting, promotion threshold,
idle pruning. The background refresher loop is tested separately by
exercising _refresh_due directly with a stub set_cached.
"""
import asyncio
import os
import sys
import time

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from shared import rollup_promoter  # noqa: E402


@pytest.fixture(autouse=True)
def reset_state():
    rollup_promoter._hits.clear()
    rollup_promoter._promoted.clear()
    yield
    rollup_promoter._hits.clear()
    rollup_promoter._promoted.clear()


def test_record_hit_returns_count():
    assert rollup_promoter.record_hit("k") == 1
    assert rollup_promoter.record_hit("k") == 2
    assert rollup_promoter.record_hit("k") == 3


def test_record_hit_prunes_outside_window():
    # Manually push old hits into the deque
    arr = rollup_promoter._hits["k"]
    old = time.time() - rollup_promoter.PROMOTE_WINDOW_S - 100
    arr.extend([old, old, old])
    # New hit should evict the old ones
    n = rollup_promoter.record_hit("k")
    assert n == 1


@pytest.mark.asyncio
async def test_below_threshold_does_not_promote():
    async def recompute():
        return {"x": 1}

    # Threshold is configurable; test by setting a high count just below it.
    for _ in range(rollup_promoter.PROMOTE_THRESHOLD - 1):
        promoted = await rollup_promoter.maybe_promote("k", recompute=recompute)
        assert promoted is False
    assert not rollup_promoter.is_promoted("k")


@pytest.mark.asyncio
async def test_threshold_crossing_promotes():
    async def recompute():
        return {"x": 1}

    promoted = False
    for _ in range(rollup_promoter.PROMOTE_THRESHOLD):
        promoted = await rollup_promoter.maybe_promote("hot", recompute=recompute)
    # The exact call where promoted=True is the threshold-crossing one
    assert rollup_promoter.is_promoted("hot")


@pytest.mark.asyncio
async def test_already_promoted_returns_false():
    async def recompute():
        return {"x": 1}

    for _ in range(rollup_promoter.PROMOTE_THRESHOLD):
        await rollup_promoter.maybe_promote("hot", recompute=recompute)

    # Subsequent calls return False but keep the entry alive.
    promoted_again = await rollup_promoter.maybe_promote("hot", recompute=recompute)
    assert promoted_again is False
    assert rollup_promoter.is_promoted("hot")


def test_prune_idle_removes_stale_promotions():
    rollup_promoter._promoted["stale"] = {
        "recompute": lambda: None,
        "last_refreshed_at": 0.0,
        "last_seen_at": time.time() - rollup_promoter.PRUNE_AFTER_S - 1,
    }
    rollup_promoter._promoted["fresh"] = {
        "recompute": lambda: None,
        "last_refreshed_at": 0.0,
        "last_seen_at": time.time(),
    }
    rollup_promoter._prune_idle()
    assert "stale" not in rollup_promoter._promoted
    assert "fresh" in rollup_promoter._promoted


@pytest.mark.asyncio
async def test_refresh_due_calls_set_cached_for_each():
    refreshed: list[tuple[str, dict]] = []

    async def fake_set_cached(key, value, ttl_seconds=None, index_key=None):
        refreshed.append((key, value))

    async def recompute_a():
        return {"label": "a"}

    async def recompute_b():
        return {"label": "b"}

    # Manually seed two promoted keys both due for refresh.
    rollup_promoter._promoted["a"] = {
        "recompute": recompute_a,
        "last_refreshed_at": 0.0,
        "last_seen_at": time.time(),
        "index_key": None,
    }
    rollup_promoter._promoted["b"] = {
        "recompute": recompute_b,
        "last_refreshed_at": 0.0,
        "last_seen_at": time.time(),
        "index_key": None,
    }
    await rollup_promoter._refresh_due(fake_set_cached)
    refreshed_keys = sorted(k for k, _ in refreshed)
    assert refreshed_keys == ["a", "b"]


def test_stats_returns_expected_shape():
    s = rollup_promoter.stats()
    assert "promoted_count" in s
    assert "tracked_keys" in s
    assert "promote_threshold" in s
    assert "promote_window_seconds" in s
    assert "refresh_interval_seconds" in s
