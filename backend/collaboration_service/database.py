import os
import asyncpg
from datetime import datetime, timezone

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://nexus:nexus_pass@postgres:5432/nexus",
)

_pool: asyncpg.Pool | None = None

CREATE_COMMENTS_TABLE = """
CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    entity_type TEXT NOT NULL,   -- 'pipeline' | 'agent' | 'object_type' | 'connector' | 'logic' | 'record'
    entity_id   TEXT NOT NULL,
    parent_id   TEXT,            -- NULL = top-level, set = reply
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    body        TEXT NOT NULL,
    resolved    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_comments_entity ON comments(tenant_id, entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
"""


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        async with _pool.acquire() as conn:
            await conn.execute(CREATE_COMMENTS_TABLE)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
