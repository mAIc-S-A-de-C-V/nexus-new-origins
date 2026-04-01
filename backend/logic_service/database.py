import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, Boolean, func

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class LogicFunctionRow(Base):
    """A saved, versioned, executable LLM workflow."""
    __tablename__ = "logic_functions"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    # input_schema: list of {name, type, object_type?}
    input_schema = Column(JSON, nullable=False, default=list)
    # blocks: list of block configs (ontology_query, llm_call, action, transform)
    blocks = Column(JSON, nullable=False, default=list)
    # id of the block whose result is the function's output
    output_block = Column(String, nullable=True)
    version = Column(Integer, nullable=False, default=1)
    # draft | published
    status = Column(String, nullable=False, default="draft")
    published_version = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class LogicRunRow(Base):
    """An individual execution of a Logic Function."""
    __tablename__ = "logic_runs"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    function_id = Column(String, nullable=False, index=True)
    function_version = Column(Integer, nullable=False, default=1)
    inputs = Column(JSON, nullable=False, default=dict)
    # pending | running | completed | failed
    status = Column(String, nullable=False, default="pending", index=True)
    # per-block outputs: { block_id: { result, duration_ms, error? } }
    trace = Column(JSON, nullable=True)
    output = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    triggered_by = Column(String, nullable=True)  # user_id or "agent:xxx"
    started_at = Column(DateTime(timezone=True), nullable=True)
    finished_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LogicScheduleRow(Base):
    """A recurring schedule for a Logic Function."""
    __tablename__ = "logic_schedules"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    function_id = Column(String, nullable=False, index=True)
    # cron expression: "0 9 * * 1-5" = weekdays at 9am
    cron = Column(String, nullable=False)
    # human label e.g. "Every weekday at 9am"
    label = Column(String, nullable=True)
    # default inputs to pass when triggered
    inputs = Column(JSON, nullable=False, default=dict)
    enabled = Column(Boolean, nullable=False, default=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
