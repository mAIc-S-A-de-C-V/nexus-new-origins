import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

PG_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

pg_engine = create_async_engine(PG_URL, echo=False)
PgSession = async_sessionmaker(pg_engine, expire_on_commit=False)


async def get_pg_session() -> AsyncSession:
    async with PgSession() as session:
        yield session


DDL = [
    """
    CREATE TABLE IF NOT EXISTS conformance_models (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id       TEXT NOT NULL,
        object_type_id  TEXT NOT NULL,
        name            TEXT NOT NULL,
        activities      TEXT[] NOT NULL,
        is_active       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, object_type_id, name)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_conf_models_tenant_ot ON conformance_models (tenant_id, object_type_id)",
]


async def init_pg_db():
    async with pg_engine.begin() as conn:
        for stmt in DDL:
            await conn.execute(text(stmt))
