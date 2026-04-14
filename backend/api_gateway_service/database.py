import os
import asyncpg
import secrets

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://nexus:nexus_pass@postgres:5432/nexus",
)

_pool: asyncpg.Pool | None = None

INIT_SQL = """
CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,           -- first 8 chars for display: "nxk_xxxx..."
    scopes      TEXT[] NOT NULL DEFAULT ARRAY['read'],
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS api_endpoints (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    object_type_id  TEXT NOT NULL,
    object_type_name TEXT NOT NULL,
    slug            TEXT NOT NULL,       -- URL slug: /api/v1/{slug}
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_tenant ON api_endpoints(tenant_id);
"""


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        async with _pool.acquire() as conn:
            await conn.execute(INIT_SQL)
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
