import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, DateTime, JSON, Boolean, Text, func

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class PipelineRow(Base):
    __tablename__ = "pipelines"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="IDLE")
    version = Column(Integer, nullable=False, default=1)
    data = Column(JSON, nullable=False)  # full Pipeline serialized
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PipelineRunRow(Base):
    __tablename__ = "pipeline_runs"
    id = Column(String, primary_key=True)
    pipeline_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="RUNNING")
    triggered_by = Column(String, nullable=False, default="api")
    rows_in = Column(Integer, nullable=False, default=0)
    rows_out = Column(Integer, nullable=False, default=0)
    error_message = Column(String, nullable=True)
    # Per-node audit data: {node_id: {rows_in, rows_out, sample_in, sample_out, stats, ...}}
    node_audits = Column(JSON, nullable=True)
    # Structured log lines: [{ts, level, node_id, msg, extra}]
    logs = Column(JSON, nullable=True)
    watermark_value = Column(String, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    finished_at = Column(DateTime(timezone=True), nullable=True)


class PipelineScheduleRow(Base):
    __tablename__ = "pipeline_schedules"
    id = Column(String, primary_key=True)
    pipeline_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    cron_expression = Column(String, nullable=False)   # e.g. "0 */6 * * *"
    enabled = Column(Boolean, nullable=False, default=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        from sqlalchemy import text as sa_text
        for col_sql in [
            "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS watermark_value VARCHAR",
            "ALTER TABLE pipeline_runs ADD COLUMN IF NOT EXISTS logs JSON",
        ]:
            try:
                await conn.execute(sa_text(col_sql))
            except Exception:
                pass


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
