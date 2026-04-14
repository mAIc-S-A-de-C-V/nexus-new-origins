import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, func, text

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class ScenarioRow(Base):
    """Saved what-if scenario definition for Scenario Simulation."""
    __tablename__ = "scenarios"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    object_type_id = Column(String, nullable=False, index=True)
    object_type_name = Column(String, nullable=True)
    overrides = Column(JSON, nullable=False, default=list)
    derived_metrics = Column(JSON, nullable=False, default=list)
    last_result = Column(JSON, nullable=True)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Value tracker tables (raw SQL — not ORM models)
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS value_categories (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                color TEXT DEFAULT '#7C3AED',
                currency TEXT DEFAULT 'USD',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS value_use_cases (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                category_id TEXT NOT NULL REFERENCES value_categories(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                description TEXT,
                source_type TEXT DEFAULT 'manual',
                source_id TEXT,
                status TEXT DEFAULT 'open',
                identified_value NUMERIC(20,2) DEFAULT 0,
                framed_value NUMERIC(20,2) DEFAULT 0,
                realized_value NUMERIC(20,2) DEFAULT 0,
                improvement_potential_pct NUMERIC(6,2) DEFAULT 0,
                formula_description TEXT,
                formula_params JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS value_events (
                id TEXT PRIMARY KEY,
                use_case_id TEXT NOT NULL REFERENCES value_use_cases(id) ON DELETE CASCADE,
                amount NUMERIC(20,2) NOT NULL DEFAULT 0,
                notes TEXT,
                occurred_at TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_value_use_cases_tenant ON value_use_cases(tenant_id)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_value_categories_tenant ON value_categories(tenant_id)"
        ))


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
