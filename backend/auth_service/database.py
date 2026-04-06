import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

PG_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(PG_URL, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session


DDL = [
    """
    CREATE TABLE IF NOT EXISTS auth_users (
        id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        tenant_id    TEXT NOT NULL,
        email        TEXT NOT NULL,
        name         TEXT NOT NULL,
        role         TEXT NOT NULL DEFAULT 'viewer',
        password_hash TEXT,
        oidc_provider TEXT,
        oidc_subject  TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, email)
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_auth_users_tenant ON auth_users (tenant_id)",
    "CREATE INDEX IF NOT EXISTS idx_auth_users_oidc ON auth_users (oidc_provider, oidc_subject)",
    """
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
        id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id    TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON auth_refresh_tokens (user_id)",
    """
    CREATE TABLE IF NOT EXISTS auth_tenant_domains (
        domain     TEXT PRIMARY KEY,
        tenant_id  TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
]


async def init_db():
    async with engine.begin() as conn:
        for stmt in DDL:
            await conn.execute(text(stmt))


async def get_or_create_tenant_for_domain(db: AsyncSession, domain: str) -> str:
    """Look up or auto-provision a tenant_id for an email domain."""
    row = await db.execute(
        text("SELECT tenant_id FROM auth_tenant_domains WHERE domain = :domain"),
        {"domain": domain},
    )
    mapping = row.fetchone()
    if mapping:
        return str(mapping._mapping["tenant_id"])
    tenant_id = f"tenant-{domain.replace('.', '-')}"
    await db.execute(
        text(
            "INSERT INTO auth_tenant_domains (domain, tenant_id) "
            "VALUES (:d, :t) ON CONFLICT (domain) DO NOTHING"
        ),
        {"d": domain, "t": tenant_id},
    )
    # Commit happens in the caller
    return tenant_id
