import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Float, DateTime, JSON, Text, Boolean, func

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=10,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class EvalSuiteRow(Base):
    """Named test suite tied to an agent, logic function, or logic flow."""
    __tablename__ = "eval_suites"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    target_type = Column(String, nullable=False)   # 'agent' | 'logic_function' | 'logic_flow'
    target_id = Column(String, nullable=False)
    target_name = Column(String, nullable=True)    # display name for the target
    evaluator_configs = Column(JSON, nullable=False, default=list)  # [{type, config, weight}]
    pass_threshold = Column(Float, nullable=False, default=0.7)
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class EvalTestCaseRow(Base):
    """Individual test case: inputs + expected outputs."""
    __tablename__ = "eval_test_cases"
    id = Column(String, primary_key=True)
    suite_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    inputs = Column(JSON, nullable=False, default=dict)
    expected_outputs = Column(JSON, nullable=True)   # {key_details: [], schema: {}, exact: ""}
    tags = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class EvalRunRow(Base):
    """A single execution of a suite against its target."""
    __tablename__ = "eval_runs"
    id = Column(String, primary_key=True)
    suite_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    status = Column(String, nullable=False, default="running")  # running | complete | failed
    config_overrides = Column(JSON, nullable=False, default=dict)  # {model, temperature, ...}
    results = Column(JSON, nullable=False, default=list)  # [{case_id, passed, score, output, details}]
    summary = Column(JSON, nullable=True)  # {pass_rate, avg_score, passed, failed, total}
    error = Column(Text, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


class EvalExperimentRow(Base):
    """Grid search across model/prompt/temperature combinations."""
    __tablename__ = "eval_experiments"
    id = Column(String, primary_key=True)
    suite_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    param_grid = Column(JSON, nullable=False)  # {model: [...], temperature: [...], ...}
    run_ids = Column(JSON, nullable=False, default=list)
    best_run_id = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | running | complete | failed
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
