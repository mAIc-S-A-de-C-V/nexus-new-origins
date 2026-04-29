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
    # Phase 4: link conformance models to a process (nullable for legacy single-object models)
    "ALTER TABLE conformance_models ADD COLUMN IF NOT EXISTS process_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_conf_models_process ON conformance_models (tenant_id, process_id)",
    # Phase 1: process definitions (object-centric process mining)
    """
    CREATE TABLE IF NOT EXISTS processes (
        id                       TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id                TEXT NOT NULL,
        name                     TEXT NOT NULL,
        description              TEXT,
        case_key_attribute       TEXT,
        included_object_type_ids TEXT[] NOT NULL DEFAULT '{}',
        included_activities      TEXT[],
        excluded_activities      TEXT[],
        default_model_id         TEXT,
        is_implicit              BOOLEAN NOT NULL DEFAULT FALSE,
        status                   TEXT NOT NULL DEFAULT 'active',
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, name)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_processes_tenant ON processes (tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_processes_objects ON processes USING GIN (included_object_type_ids)",
]


# Phase 1: implicit processes — auto-create one per (tenant, object_type) discovered in events.
# Runs on startup AND on demand via auto-discover endpoint. Idempotent thanks to UNIQUE (tenant_id, name).
async def discover_implicit_processes(ts_engine_param=None) -> int:
    """
    Scan the event log for distinct (tenant_id, object_type_id) pairs and ensure
    each has an implicit single-object process. Returns the number of processes created.
    """
    from sqlalchemy.ext.asyncio import create_async_engine
    ts_url = os.environ.get(
        "TIMESCALE_URL",
        "postgresql+asyncpg://nexus:nexus_pass@timescaledb:5432/nexus_events",
    )
    ts_engine_local = ts_engine_param or create_async_engine(ts_url, echo=False)

    pairs: list[tuple[str, str]] = []
    try:
        async with ts_engine_local.begin() as ts_conn:
            res = await ts_conn.execute(text(
                "SELECT DISTINCT tenant_id, object_type_id FROM events "
                "WHERE object_type_id IS NOT NULL AND object_type_id != ''"
            ))
            pairs = [(r.tenant_id, r.object_type_id) for r in res.fetchall()]
    except Exception:
        return 0

    created = 0
    if not pairs:
        return 0

    async with pg_engine.begin() as conn:
        for tenant_id, ot_id in pairs:
            implicit_name = f"__implicit__:{ot_id}"
            res = await conn.execute(
                text(
                    "INSERT INTO processes (tenant_id, name, description, "
                    "included_object_type_ids, is_implicit, status) "
                    "VALUES (:tid, :name, :desc, ARRAY[:ot]::text[], TRUE, 'active') "
                    "ON CONFLICT (tenant_id, name) DO NOTHING "
                    "RETURNING id"
                ),
                {
                    "tid": tenant_id,
                    "name": implicit_name,
                    "desc": f"Auto-generated single-object process for {ot_id}",
                    "ot": ot_id,
                },
            )
            if res.fetchone():
                created += 1
    return created


async def init_pg_db():
    async with pg_engine.begin() as conn:
        for stmt in DDL:
            await conn.execute(text(stmt))
