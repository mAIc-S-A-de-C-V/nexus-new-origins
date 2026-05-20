"""
Postgres + TimescaleDB session factories for insight_engine, plus DDL that
runs on lifespan. All tables live in the shared `nexus` postgres DB; events
are read from TimescaleDB. Snapshot tables are created and dropped per run.
"""
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

PG_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)
TIMESCALE_URL = os.environ.get(
    "TIMESCALE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@timescaledb:5432/nexus_events",
)

pg_engine = create_async_engine(
    PG_URL, echo=False,
    pool_size=int(os.environ.get("DB_POOL_SIZE", "10")),
    max_overflow=int(os.environ.get("DB_MAX_OVERFLOW", "20")),
    pool_recycle=1800,
    pool_pre_ping=True,
)
ts_engine = create_async_engine(
    TIMESCALE_URL, echo=False,
    pool_size=int(os.environ.get("TS_POOL_SIZE", "5")),
    pool_recycle=1800,
    pool_pre_ping=True,
)

PgSession = async_sessionmaker(pg_engine, expire_on_commit=False)
TsSession = async_sessionmaker(ts_engine, expire_on_commit=False)


async def get_pg_session() -> AsyncSession:
    async with PgSession() as session:
        yield session


async def get_ts_session() -> AsyncSession:
    async with TsSession() as session:
        yield session


DDL_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS discovered_insights (
        id                        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id                 TEXT NOT NULL,
        run_id                    TEXT NOT NULL,
        family                    TEXT NOT NULL,
        object_type_id            TEXT NOT NULL,
        outcome_object_type_id    TEXT,
        feature                   JSONB NOT NULL,
        outcome                   JSONB NOT NULL,
        n                         INTEGER NOT NULL,
        effect_size               DOUBLE PRECISION NOT NULL,
        effect_metric             TEXT NOT NULL,
        p_value                   DOUBLE PRECISION,
        p_adjusted                DOUBLE PRECISION,
        direction                 TEXT,
        stability_score           DOUBLE PRECISION,
        replication_holdout_pass  BOOLEAN,
        causal_estimate           JSONB,
        rank_score                DOUBLE PRECISION NOT NULL DEFAULT 0,
        novelty_score             DOUBLE PRECISION,
        prior_insight_id          TEXT,
        title                     TEXT NOT NULL,
        description               TEXT NOT NULL DEFAULT '',
        recommendation            TEXT,
        evidence                  JSONB NOT NULL DEFAULT '{}',
        status                    TEXT NOT NULL DEFAULT 'new',
        discovered_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_di_tenant_rank ON discovered_insights (tenant_id, rank_score DESC, discovered_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_di_status      ON discovered_insights (tenant_id, status)",
    "CREATE INDEX IF NOT EXISTS idx_di_run         ON discovered_insights (tenant_id, run_id)",
    "CREATE INDEX IF NOT EXISTS idx_di_family      ON discovered_insights (tenant_id, family)",
    """
    CREATE TABLE IF NOT EXISTS insight_runs (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id           TEXT NOT NULL,
        started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at         TIMESTAMPTZ,
        status              TEXT NOT NULL DEFAULT 'running',
        tests_planned       INTEGER,
        tests_run           INTEGER,
        insights_kept       INTEGER,
        families_run        JSONB,
        family_durations_ms JSONB,
        duration_ms         INTEGER,
        peak_memory_mb      INTEGER,
        error               TEXT,
        config_snapshot     JSONB
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_insight_runs_tenant ON insight_runs (tenant_id, started_at DESC)",
    """
    CREATE TABLE IF NOT EXISTS insight_engine_config (
        tenant_id              TEXT PRIMARY KEY,
        enabled                BOOLEAN NOT NULL DEFAULT TRUE,
        schedule_cron          TEXT    NOT NULL DEFAULT '0 3 * * *',
        timezone               TEXT    NOT NULL DEFAULT 'UTC',
        family_enabled         JSONB   NOT NULL DEFAULT '{}',
        family_priors          JSONB   NOT NULL DEFAULT '{}',
        max_tests              INTEGER NOT NULL DEFAULT 5000,
        max_runtime_minutes    INTEGER NOT NULL DEFAULT 60,
        max_memory_mb          INTEGER NOT NULL DEFAULT 3072,
        min_effect_size        DOUBLE PRECISION NOT NULL DEFAULT 0.2,
        min_sample_size        INTEGER NOT NULL DEFAULT 30,
        min_stability_score    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        feature_denylist       JSONB   NOT NULL DEFAULT '[]',
        outcome_denylist       JSONB   NOT NULL DEFAULT '[]',
        bootstrap_iterations   INTEGER NOT NULL DEFAULT 100,
        holdout_pct            DOUBLE PRECISION NOT NULL DEFAULT 0.2,
        keep_top_n             INTEGER NOT NULL DEFAULT 100,
        llm_titles_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
        embeddings_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
        causal_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        cross_ot_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS insight_feature_snapshots (
        tenant_id      TEXT NOT NULL,
        run_id         TEXT NOT NULL,
        object_type_id TEXT NOT NULL,
        feature_name   TEXT NOT NULL,
        cardinality    INTEGER,
        missing_rate   DOUBLE PRECISION,
        dtype          TEXT,
        semantic_type  TEXT,
        PRIMARY KEY (tenant_id, run_id, object_type_id, feature_name)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS insight_runtime_state (
        tenant_id  TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (tenant_id, key)
    )
    """,
]


async def init_db():
    async with pg_engine.begin() as conn:
        for stmt in DDL_STATEMENTS:
            await conn.execute(text(stmt))


async def get_or_create_config(tenant_id: str) -> dict:
    """Read the config row for a tenant; create a default row if absent."""
    async with PgSession() as pg:
        row = await pg.execute(
            text("SELECT * FROM insight_engine_config WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
        r = row.fetchone()
        if r:
            return dict(r._mapping)
        await pg.execute(
            text("INSERT INTO insight_engine_config (tenant_id) VALUES (:t) "
                 "ON CONFLICT (tenant_id) DO NOTHING"),
            {"t": tenant_id},
        )
        await pg.commit()
        row = await pg.execute(
            text("SELECT * FROM insight_engine_config WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
        return dict(row.fetchone()._mapping)
