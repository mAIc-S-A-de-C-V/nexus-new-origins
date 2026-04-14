import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, func

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class ConnectorRow(Base):
    __tablename__ = "connectors"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)
    category = Column(String, nullable=False)
    status = Column(String, nullable=False, default="idle")
    description = Column(Text, nullable=True)
    base_url = Column(String, nullable=True)
    auth_type = Column(String, nullable=False, default="None")
    credentials = Column(Text, nullable=True)  # AES-256-GCM encrypted JSON
    headers = Column(JSON, nullable=True)
    pagination_strategy = Column(String, nullable=True)
    active_pipeline_count = Column(Integer, nullable=False, default=0)
    last_sync = Column(DateTime(timezone=True), nullable=True)
    last_sync_row_count = Column(Integer, nullable=True)
    schema_hash = Column(String, nullable=True)
    tags = Column(JSON, nullable=False, default=list)
    config = Column(JSON, nullable=True)
    inference_result = Column(JSON, nullable=True)
    inference_ran_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text as sa_text
        for col_sql in [
            "ALTER TABLE connectors ADD COLUMN IF NOT EXISTS config JSON",
            "ALTER TABLE connectors ADD COLUMN IF NOT EXISTS inference_result JSON",
            "ALTER TABLE connectors ADD COLUMN IF NOT EXISTS inference_ran_at TIMESTAMPTZ",
            "ALTER TABLE connectors ALTER COLUMN credentials TYPE TEXT USING credentials::TEXT",
        ]:
            try:
                await conn.execute(sa_text(col_sql))
            except Exception:
                pass


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
