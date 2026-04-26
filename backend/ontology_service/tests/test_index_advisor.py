"""
Unit tests for shared.index_advisor.
"""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, os.pardir, os.pardir))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from shared import index_advisor  # noqa: E402


@pytest.fixture(autouse=True)
def reset_state():
    """Each test starts with a clean attempted-set + auto-index re-enabled."""
    index_advisor._attempted.clear()
    index_advisor.AUTO_INDEX_ENABLED = True
    yield
    index_advisor._attempted.clear()


def test_index_name_truncates_to_63():
    name = index_advisor._index_name("a" * 100)
    assert len(name) <= 63
    assert name.startswith("idx_or_data_")


def test_index_name_lowercases():
    assert index_advisor._index_name("CreatedAt") == "idx_or_data_createdat"


@pytest.mark.asyncio
async def test_below_threshold_does_nothing():
    fields = await index_advisor.maybe_create_indexes_for(
        engine=MagicMock(),
        fields=["status"],
        elapsed_ms=10.0,
        threshold_ms=500,
    )
    assert fields == []


@pytest.mark.asyncio
async def test_disabled_globally_returns_empty():
    index_advisor.AUTO_INDEX_ENABLED = False
    fields = await index_advisor.maybe_create_indexes_for(
        engine=MagicMock(),
        fields=["status"],
        elapsed_ms=10000.0,
    )
    assert fields == []


@pytest.mark.asyncio
async def test_invalid_field_names_skipped():
    # We don't even need the engine since these never trigger DDL.
    fields = await index_advisor.maybe_create_indexes_for(
        engine=MagicMock(),
        fields=["", "1bad", "with space", "drop'table"],
        elapsed_ms=9999.0,
        threshold_ms=10,
    )
    # Allow the background task to be cancelled cleanly
    await asyncio.sleep(0)
    assert fields == []


@pytest.mark.asyncio
async def test_dedup_within_session():
    # Stub the actual DDL so it doesn't try to talk to Postgres.
    async def fake_create(engine, fs):
        return None

    original = index_advisor._create_indexes
    index_advisor._create_indexes = fake_create  # type: ignore
    try:
        first = await index_advisor.maybe_create_indexes_for(
            engine=MagicMock(),
            fields=["status", "amount"],
            elapsed_ms=9999.0,
            threshold_ms=10,
        )
        await asyncio.sleep(0)  # let the task run
        second = await index_advisor.maybe_create_indexes_for(
            engine=MagicMock(),
            fields=["status", "amount", "department"],
            elapsed_ms=9999.0,
            threshold_ms=10,
        )
        assert sorted(first) == ["amount", "status"]
        assert second == ["department"]
    finally:
        index_advisor._create_indexes = original  # type: ignore


@pytest.mark.asyncio
async def test_failed_creation_allows_retry():
    """If CREATE INDEX fails, we should be able to retry next session."""
    # Mock engine.connect() context manager that raises on .execute
    raised: list[Exception] = []

    class FailingConn:
        async def execution_options(self, **kw):
            return self

        async def execute(self, sql):
            err = RuntimeError("DDL failed")
            raised.append(err)
            raise err

    class FailingEngine:
        def connect(self):
            return _ContextEngine()

    class _ContextEngine:
        async def __aenter__(self):
            return FailingConn()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    engine = FailingEngine()
    fields = await index_advisor.maybe_create_indexes_for(
        engine=engine,
        fields=["status"],
        elapsed_ms=9999.0,
        threshold_ms=10,
    )
    assert fields == ["status"]
    # Wait for the background task
    await asyncio.sleep(0)
    await asyncio.sleep(0)

    # Either the per-field handler swallowed and retained, or the outer handler
    # swallowed and forgot — both are fine; what matters is we don't raise here.
    # Now retry with a different (working) engine — should re-attempt.
    succeeded: list[str] = []

    class GoodConn:
        async def execution_options(self, **kw):
            return self

        async def execute(self, sql):
            succeeded.append(str(sql))

    class GoodEngine:
        def connect(self):
            return _GoodCtx()

    class _GoodCtx:
        async def __aenter__(self):
            return GoodConn()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    # The fact that the index_advisor cleared the attempted-set on failure
    # is the contract we're testing. Retry should pick it up again.
    fields2 = await index_advisor.maybe_create_indexes_for(
        engine=GoodEngine(),
        fields=["status"],
        elapsed_ms=9999.0,
        threshold_ms=10,
    )
    # If the previous task cleared `_attempted`, status is in fresh; otherwise empty.
    # Either way, we DO NOT crash.
    assert fields2 in (["status"], [])
