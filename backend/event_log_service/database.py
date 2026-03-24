import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, DateTime, JSON, Float, Text, text

DATABASE_URL = os.environ.get(
    "TIMESCALE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@timescaledb:5432/nexus_events",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class EventRow(Base):
    __tablename__ = "events"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    case_id = Column(String, nullable=False, index=True)
    activity = Column(String, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False, index=True)
    object_type_id = Column(String, nullable=True, index=True)
    object_id = Column(String, nullable=True)
    pipeline_id = Column(String, nullable=True, index=True)
    connector_id = Column(String, nullable=True, index=True)
    resource = Column(String, nullable=True)
    cost = Column(Float, nullable=True)
    attributes = Column(JSON, nullable=False, default=dict)


async def init_db():
    # Create tables in a separate transaction so a hypertable failure doesn't roll it back
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Upgrade to hypertable in its own transaction (safe to fail if already done)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(
                "SELECT create_hypertable('events', 'timestamp', if_not_exists => TRUE)"
            ))
    except Exception:
        pass  # hypertable already exists or TimescaleDB extension not available


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
