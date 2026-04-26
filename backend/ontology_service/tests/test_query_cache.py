"""
Unit tests for shared.query_cache.

We exercise the pure helpers (canonical hash, cache key builders, fallback
behavior when redis is unavailable). The redis-dependent paths (get/set/
invalidate / get_or_compute) are covered with a fake redis client so we
don't need a live server.
"""
import asyncio
import os
import sys
from unittest.mock import patch

import pytest

# Ensure backend root is on sys.path so `shared.*` imports work.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from shared import query_cache  # noqa: E402


# ── Pure helpers ─────────────────────────────────────────────────────────


def test_canonical_query_hash_is_stable():
    a = query_cache.canonical_query_hash({"x": 1, "y": [1, 2, 3]})
    b = query_cache.canonical_query_hash({"y": [1, 2, 3], "x": 1})
    assert a == b


def test_canonical_query_hash_differs_on_change():
    a = query_cache.canonical_query_hash({"x": 1})
    b = query_cache.canonical_query_hash({"x": 2})
    assert a != b


def test_canonical_query_hash_handles_nested_dicts():
    h = query_cache.canonical_query_hash({"filters": {"$gt": 5}, "group_by": "status"})
    assert isinstance(h, str)
    assert len(h) == 64


def test_aggregate_cache_key_format():
    k = query_cache.aggregate_cache_key("tenant-1", "ot-99", "abc123")
    assert k == "agg:tenant-1:ot-99:abc123"


def test_aggregate_index_key_format():
    k = query_cache.aggregate_index_key("tenant-1", "ot-99")
    assert k == "agg-idx:tenant-1:ot-99"


# ── Cache get/set with fake redis ────────────────────────────────────────


class FakeRedis:
    """Minimal in-memory async stub that mimics the surface query_cache uses."""

    def __init__(self):
        self.kv: dict[str, str] = {}
        self.sets: dict[str, set] = {}
        self.expirations: dict[str, int] = {}
        self.fail_next = False

    async def get(self, key):
        if self.fail_next:
            self.fail_next = False
            raise RuntimeError("redis simulated outage")
        return self.kv.get(key)

    async def set(self, key, value, ex=None):
        self.kv[key] = value
        if ex is not None:
            self.expirations[key] = ex
        return True

    async def sadd(self, key, member):
        s = self.sets.setdefault(key, set())
        s.add(member)
        return 1

    async def expire(self, key, seconds):
        self.expirations[key] = seconds
        return True

    async def smembers(self, key):
        return self.sets.get(key, set())

    async def delete(self, key):
        existed = 1 if key in self.kv or key in self.sets else 0
        self.kv.pop(key, None)
        self.sets.pop(key, None)
        return existed

    def pipeline(self, transaction=False):
        return _FakePipeline(self)


class _FakePipeline:
    def __init__(self, parent: FakeRedis):
        self.parent = parent
        self.ops: list = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def delete(self, key):
        self.ops.append(("delete", key))
        return self

    async def execute(self):
        results = []
        for op, key in self.ops:
            if op == "delete":
                results.append(await self.parent.delete(key))
        self.ops = []
        return results


@pytest.fixture
def fake_redis(monkeypatch):
    fake = FakeRedis()
    monkeypatch.setattr(query_cache, "_client", fake)
    return fake


@pytest.mark.asyncio
async def test_get_cached_returns_none_when_missing(fake_redis):
    assert await query_cache.get_cached("nope") is None


@pytest.mark.asyncio
async def test_set_then_get(fake_redis):
    await query_cache.set_cached("k1", {"hello": "world"})
    got = await query_cache.get_cached("k1")
    assert got == {"hello": "world"}


@pytest.mark.asyncio
async def test_set_with_index_key_records_into_set(fake_redis):
    await query_cache.set_cached("agg:t:o:abc", {"x": 1}, index_key="agg-idx:t:o")
    assert "agg:t:o:abc" in fake_redis.sets["agg-idx:t:o"]


@pytest.mark.asyncio
async def test_invalidate_object_type_deletes_all_members(fake_redis):
    await query_cache.set_cached("agg:t:o:1", {"x": 1}, index_key="agg-idx:t:o")
    await query_cache.set_cached("agg:t:o:2", {"x": 2}, index_key="agg-idx:t:o")
    await query_cache.set_cached("agg:t:o:3", {"x": 3}, index_key="agg-idx:t:o")

    deleted = await query_cache.invalidate_object_type("t", "o")
    assert deleted == 3
    # Subsequent gets must miss
    assert await query_cache.get_cached("agg:t:o:1") is None
    assert await query_cache.get_cached("agg:t:o:2") is None


@pytest.mark.asyncio
async def test_invalidate_no_op_when_index_empty(fake_redis):
    deleted = await query_cache.invalidate_object_type("t", "o-empty")
    assert deleted == 0


@pytest.mark.asyncio
async def test_redis_failure_in_get_returns_none(fake_redis):
    fake_redis.fail_next = True
    # Should NOT raise — query_cache swallows redis errors.
    assert await query_cache.get_cached("anything") is None


@pytest.mark.asyncio
async def test_get_or_compute_caches_first_call(fake_redis):
    calls = {"n": 0}

    async def compute():
        calls["n"] += 1
        return {"value": 42}

    v1, hit1 = await query_cache.get_or_compute("k", compute)
    v2, hit2 = await query_cache.get_or_compute("k", compute)
    assert v1 == {"value": 42}
    assert v2 == {"value": 42}
    assert hit1 is False
    assert hit2 is True
    assert calls["n"] == 1  # second call hit cache


@pytest.mark.asyncio
async def test_get_or_compute_single_flight_concurrent(fake_redis):
    """If two callers race on the same key, compute runs only once."""
    calls = {"n": 0}
    started = asyncio.Event()
    proceed = asyncio.Event()

    async def slow_compute():
        calls["n"] += 1
        started.set()
        await proceed.wait()
        return {"value": "slow"}

    task1 = asyncio.create_task(query_cache.get_or_compute("racy", slow_compute))
    await started.wait()
    task2 = asyncio.create_task(query_cache.get_or_compute("racy", slow_compute))
    # give task2 a chance to attach
    await asyncio.sleep(0.01)
    proceed.set()
    r1, _ = await task1
    r2, _ = await task2
    assert r1 == {"value": "slow"}
    assert r2 == {"value": "slow"}
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_redis_unavailable_falls_back_silently(monkeypatch):
    # Force the client to None — simulating a startup-time redis import failure.
    monkeypatch.setattr(query_cache, "_client", None)
    monkeypatch.setattr(query_cache, "_get_client", lambda: None)
    # All cache ops become no-ops; get_or_compute still calls compute().
    calls = {"n": 0}

    async def compute():
        calls["n"] += 1
        return {"x": 1}

    v, hit = await query_cache.get_or_compute("anything", compute)
    assert v == {"x": 1}
    assert hit is False
    assert calls["n"] == 1
    # Second call: no cache, recomputes
    v2, hit2 = await query_cache.get_or_compute("anything", compute)
    assert v2 == {"x": 1}
    assert hit2 is False
    assert calls["n"] == 2
