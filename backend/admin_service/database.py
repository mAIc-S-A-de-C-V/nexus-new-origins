import os
import asyncpg

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://nexus:nexus_pass@postgres:5432/nexus",
)

_pool: asyncpg.Pool | None = None

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


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
