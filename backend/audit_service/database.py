import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, DateTime, JSON, Boolean, Integer, Text, func

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(
    DATABASE_URL,
    echo=False,
    pool_pre_ping=True,
    pool_recycle=300,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class AuditEventRow(Base):
    __tablename__ = "audit_events"

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    actor_id = Column(String, nullable=False, index=True)
    actor_role = Column(String, nullable=False)
    action = Column(String, nullable=False, index=True)
    resource_type = Column(String, nullable=False, index=True)
    resource_id = Column(String, nullable=False, index=True)
    before_state = Column(JSON, nullable=True)
    after_state = Column(JSON, nullable=True)
    ip_address = Column(String, nullable=True)
    user_agent = Column(String, nullable=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    success = Column(Boolean, nullable=False, default=True)
    error_message = Column(String, nullable=True)


class CheckpointDefinitionRow(Base):
    """Justification gate — prompts user for a reason before sensitive operations."""
    __tablename__ = "checkpoint_definitions"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    prompt_text = Column(Text, nullable=False)
    applies_to = Column(JSON, nullable=False, default=list)   # [{resource_type, operations[]}]
    applies_to_roles = Column(JSON, nullable=False, default=list)  # [] = all roles
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CheckpointResponseRow(Base):
    """Recorded justification from a user before a sensitive operation."""
    __tablename__ = "checkpoint_responses"
    id = Column(String, primary_key=True)
    checkpoint_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=False)
    user_email = Column(String, nullable=True)
    resource_type = Column(String, nullable=True)
    resource_id = Column(String, nullable=True)
    operation = Column(String, nullable=True)
    justification = Column(Text, nullable=False)
    token = Column(String, nullable=True, unique=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    responded_at = Column(DateTime(timezone=True), server_default=func.now())


class ApprovalWorkflowRow(Base):
    """Defines which operations require multi-step approval."""
    __tablename__ = "approval_workflows"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    resource_type = Column(String, nullable=False)   # 'object_type' | 'pipeline' | 'agent' | 'action_definition'
    operations = Column(JSON, nullable=False, default=list)  # ['delete', 'bulk_export', 'bulk_run']
    required_approvers = Column(Integer, nullable=False, default=1)
    eligible_roles = Column(JSON, nullable=False, default=list)  # ['admin']
    expiry_hours = Column(Integer, nullable=False, default=72)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ApprovalRequestRow(Base):
    """A submitted request awaiting approval."""
    __tablename__ = "approval_requests"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    workflow_id = Column(String, nullable=True)
    resource_type = Column(String, nullable=False)
    resource_id = Column(String, nullable=True)
    operation = Column(String, nullable=False)
    payload = Column(JSON, nullable=True)
    requested_by = Column(String, nullable=False)
    requested_by_email = Column(String, nullable=True)
    status = Column(String, nullable=False, default="pending")  # pending | approved | rejected | expired
    approvals = Column(JSON, nullable=False, default=list)    # [{user_id, email, note, approved_at}]
    rejections = Column(JSON, nullable=False, default=list)   # [{user_id, email, reason, rejected_at}]
    expires_at = Column(DateTime(timezone=True), nullable=False)
    executed_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
