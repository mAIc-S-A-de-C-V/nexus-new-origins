import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import text

# TimescaleDB — reads events
TIMESCALE_URL = os.environ.get(
    "TIMESCALE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@timescaledb:5432/nexus_events",
)

ts_engine = create_async_engine(TIMESCALE_URL, echo=False)
TimescaleSession = async_sessionmaker(ts_engine, expire_on_commit=False)


async def init_db():
    pass  # No own tables — reads from existing event_log schema


async def get_ts_session() -> AsyncSession:
    async with TimescaleSession() as session:
        yield session
