import os
import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://nexus:nexus_pass@postgres:5432/nexus",
)

# TimescaleDB holds the events table (process-mining time-series data).
# Records there don't show up in Postgres object_records — we count both for consumption.
EVENTS_DATABASE_URL = os.environ.get(
    "EVENTS_DATABASE_URL",
    "postgresql://nexus:nexus_pass@timescaledb:5432/nexus_events",
)

_pool: asyncpg.Pool | None = None
_events_pool: asyncpg.Pool | None = None

INIT_SQL = """
CREATE TABLE IF NOT EXISTS tenants (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL UNIQUE,
    plan            TEXT NOT NULL DEFAULT 'free',   -- free | pro | enterprise
    status          TEXT NOT NULL DEFAULT 'active', -- active | suspended | trial
    allowed_modules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    settings        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);

CREATE TABLE IF NOT EXISTS token_usage (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id       TEXT NOT NULL,
    service         TEXT NOT NULL,
    model           TEXT NOT NULL DEFAULT 'unknown',
    input_tokens    INTEGER NOT NULL DEFAULT 0,
    output_tokens   INTEGER NOT NULL DEFAULT 0,
    user_id         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_token_usage_tenant ON token_usage(tenant_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);

-- Bucket tier per tenant (S/M/L/XL/XXL). Default S for new tenants.
-- Validation happens at the API layer.
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS bucket_tier TEXT NOT NULL DEFAULT 'S';

-- Per-tenant Bedrock model enablement. Rows present here are ENABLED.
CREATE TABLE IF NOT EXISTS tenant_bedrock_models (
    tenant_id   TEXT NOT NULL,
    model_id    TEXT NOT NULL,
    enabled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    enabled_by  TEXT,
    PRIMARY KEY (tenant_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_tbm_tenant ON tenant_bedrock_models(tenant_id);
"""


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=5)
        async with _pool.acquire() as conn:
            await conn.execute(INIT_SQL)
            # Seed tenant-001 if it doesn't exist
            await conn.execute("""
                INSERT INTO tenants (id, name, slug, plan, status)
                VALUES ('tenant-001', 'Nexus Demo', 'nexus-demo', 'enterprise', 'active')
                ON CONFLICT (id) DO NOTHING
            """)
    return _pool


async def get_events_pool() -> asyncpg.Pool | None:
    """Optional connection to the TimescaleDB instance. Returns None if unreachable
    so callers can degrade gracefully (e.g. local dev without timescaledb)."""
    global _events_pool
    if _events_pool is None:
        try:
            _events_pool = await asyncpg.create_pool(EVENTS_DATABASE_URL, min_size=1, max_size=3)
        except Exception:
            _events_pool = None
    return _events_pool


async def close_pool():
    global _pool, _events_pool
    if _pool:
        await _pool.close()
        _pool = None
    if _events_pool:
        await _events_pool.close()
        _events_pool = None
