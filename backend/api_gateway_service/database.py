import asyncio
import os
import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://nexus:nexus_pass@postgres:5432/nexus",
)

_pool: asyncpg.Pool | None = None
_pool_lock = asyncio.Lock()

INIT_SQL = """
CREATE TABLE IF NOT EXISTS api_keys (
    id          TEXT PRIMARY KEY,
    tenant_id   TEXT NOT NULL,
    name        TEXT NOT NULL,
    key_hash    TEXT NOT NULL UNIQUE,
    key_prefix  TEXT NOT NULL,
    scopes      TEXT[] NOT NULL DEFAULT ARRAY['read:records'],
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS rate_limit_per_min INT NOT NULL DEFAULT 60;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS ip_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS api_endpoints (
    id              TEXT PRIMARY KEY,
    tenant_id       TEXT NOT NULL,
    object_type_id  TEXT NOT NULL,
    object_type_name TEXT NOT NULL,
    slug            TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_tenant ON api_endpoints(tenant_id);

ALTER TABLE api_endpoints ADD COLUMN IF NOT EXISTS resource_type TEXT NOT NULL DEFAULT 'records';

CREATE TABLE IF NOT EXISTS api_key_usage_log (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     TEXT NOT NULL,
    key_id        TEXT,
    key_prefix    TEXT,
    endpoint_slug TEXT,
    resource_type TEXT,
    method        TEXT NOT NULL,
    path          TEXT NOT NULL,
    status_code   INT NOT NULL,
    bytes_out     INT NOT NULL DEFAULT 0,
    duration_ms   INT NOT NULL DEFAULT 0,
    client_ip     TEXT,
    error         TEXT,
    ts            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usage_tenant_ts ON api_key_usage_log(tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usage_key_ts ON api_key_usage_log(key_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_usage_slug_ts ON api_key_usage_log(endpoint_slug, ts DESC);
"""


async def get_pool() -> asyncpg.Pool:
    """
    Lazily initialise the asyncpg pool + run the schema migrations once.
    Concurrent first calls used to race here — both saw `_pool is None`,
    both tried to create_pool, and one of the INIT_SQL passes lost. That
    could leave the ALTER TABLE ADD COLUMN steps half-applied, which then
    made every subsequent INSERT fail because the column the code referenced
    didn't exist. Lock + double-check fixes it.
    """
    global _pool
    if _pool is not None:
        return _pool
    async with _pool_lock:
        if _pool is None:
            pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
            async with pool.acquire() as conn:
                await conn.execute(INIT_SQL)
            _pool = pool
    return _pool


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
