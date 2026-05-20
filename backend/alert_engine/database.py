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

pg_engine = create_async_engine(PG_URL, echo=False)
ts_engine = create_async_engine(TIMESCALE_URL, echo=False)

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
    CREATE TABLE IF NOT EXISTS alert_rules (
        id               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id        TEXT NOT NULL,
        name             TEXT NOT NULL,
        rule_type        TEXT NOT NULL,
        object_type_id   TEXT,
        config           JSONB NOT NULL DEFAULT '{}',
        enabled          BOOLEAN NOT NULL DEFAULT TRUE,
        cooldown_minutes INTEGER NOT NULL DEFAULT 60,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_alert_rules_tenant ON alert_rules (tenant_id)",
    """
    CREATE TABLE IF NOT EXISTS alert_notifications (
        id        TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id TEXT NOT NULL,
        rule_id   TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
        rule_name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        severity  TEXT NOT NULL DEFAULT 'warning',
        message   TEXT NOT NULL,
        details   JSONB NOT NULL DEFAULT '{}',
        read          BOOLEAN NOT NULL DEFAULT FALSE,
        fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        snoozed_until TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_alert_notifs_tenant ON alert_notifications (tenant_id, fired_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_alert_notifs_rule   ON alert_notifications (rule_id)",
    """
    CREATE TABLE IF NOT EXISTS alert_webhooks (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id  TEXT NOT NULL,
        url        TEXT NOT NULL,
        secret     TEXT NOT NULL,
        enabled    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_alert_webhooks_tenant ON alert_webhooks (tenant_id)",
    """
    CREATE TABLE IF NOT EXISTS alert_rule_last_fired (
        rule_id  TEXT PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
        fired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # Idempotent migration — adds snoozed_until if the table was created before this column existed
    """
    ALTER TABLE alert_notifications ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ
    """,
    # run_link: {kind: 'pipeline'|'agent', run_id: 'xyz'} — lets a notification deep-link
    # into the run drilldown view in the frontend.
    """
    ALTER TABLE alert_notifications ADD COLUMN IF NOT EXISTS run_link JSONB
    """,
    # Phase 4: alert rules can target a Process (alongside or instead of object_type_id)
    "ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS process_id TEXT",
    "CREATE INDEX IF NOT EXISTS idx_alert_rules_process ON alert_rules (tenant_id, process_id)",
    """
    CREATE TABLE IF NOT EXISTS alert_channels (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id         TEXT NOT NULL UNIQUE,
        email_enabled     BOOLEAN DEFAULT FALSE,
        email_recipients  TEXT DEFAULT '',
        slack_enabled     BOOLEAN DEFAULT FALSE,
        slack_webhook_url TEXT DEFAULT '',
        updated_at        TIMESTAMPTZ DEFAULT NOW()
    )
    """,
    # Phase 1: idempotent preset seeding needs (tenant_id, name) uniqueness.
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_rules_tenant_name ON alert_rules (tenant_id, name)",
    # Phase 13: streaming_anomaly evaluator state. Holds incremental EWMA /
    # Holt-Winters baseline per rule so each tick doesn't re-fetch history.
    """
    CREATE TABLE IF NOT EXISTS alert_rule_streaming_state (
        rule_id        TEXT PRIMARY KEY REFERENCES alert_rules(id) ON DELETE CASCADE,
        ewma_mean      DOUBLE PRECISION,
        ewma_var       DOUBLE PRECISION,
        observation_count INTEGER NOT NULL DEFAULT 0,
        model_state    JSONB,
        last_update_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    # Phase 14: per-user routing + on-call schedule + user channel preferences.
    """
    CREATE TABLE IF NOT EXISTS alert_routing_rules (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id       TEXT NOT NULL,
        name            TEXT NOT NULL,
        condition       JSONB NOT NULL DEFAULT '{}',
        target_user_ids TEXT[] NOT NULL DEFAULT '{}',
        channels        TEXT[] NOT NULL DEFAULT '{}',
        priority        INTEGER NOT NULL DEFAULT 100,
        enabled         BOOLEAN NOT NULL DEFAULT TRUE,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_routing_tenant ON alert_routing_rules (tenant_id, priority)",
    """
    CREATE TABLE IF NOT EXISTS alert_oncall_schedules (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id   TEXT NOT NULL,
        name        TEXT NOT NULL,
        timezone    TEXT NOT NULL DEFAULT 'UTC',
        rotation    JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_oncall_tenant ON alert_oncall_schedules (tenant_id)",
    """
    CREATE TABLE IF NOT EXISTS alert_user_preferences (
        user_id            TEXT PRIMARY KEY,
        tenant_id          TEXT NOT NULL,
        channel_prefs      JSONB NOT NULL DEFAULT '{}',
        quiet_hours        JSONB,
        do_not_disturb_until TIMESTAMPTZ,
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_user_prefs_tenant ON alert_user_preferences (tenant_id)",
]


async def init_db():
    async with pg_engine.begin() as conn:
        for stmt in DDL_STATEMENTS:
            await conn.execute(text(stmt))
