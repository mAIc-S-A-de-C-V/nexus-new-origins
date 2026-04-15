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


class ObjectTypeRow(Base):
    __tablename__ = "object_types"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    display_name = Column(String, nullable=False)
    version = Column(Integer, nullable=False, default=1)
    data = Column(JSON, nullable=False)  # full ObjectType serialized
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ObjectTypeVersionRow(Base):
    __tablename__ = "object_type_versions"
    id = Column(String, primary_key=True)
    object_type_id = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False)
    data = Column(JSON, nullable=False)  # ObjectTypeVersion serialized
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class OntologyLinkRow(Base):
    __tablename__ = "ontology_links"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    source_object_type_id = Column(String, nullable=False, index=True)
    target_object_type_id = Column(String, nullable=False)
    data = Column(JSON, nullable=False)  # full OntologyLink serialized


class ObjectRecordRow(Base):
    """Persisted merged records for an ObjectType — written by pipeline syncs."""
    __tablename__ = "object_records"
    id = Column(String, primary_key=True)
    object_type_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    source_id = Column(String, nullable=False, index=True)  # primary key from source (e.g. hs_object_id)
    data = Column(JSON, nullable=False)  # full merged record including nested arrays
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AppRow(Base):
    """Persisted dashboard apps created from object types."""
    __tablename__ = "apps"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String, nullable=True)
    object_type_id = Column(String, nullable=False, index=True)
    object_type_ids = Column(JSON, nullable=True, default=list)
    components = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())



class ActionDefinitionRow(Base):
    """Typed, permissioned write operations that AI agents and Logic Functions can propose."""
    __tablename__ = "action_definitions"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False, index=True)  # unique slug, e.g. "updateDealStage"
    description = Column(Text, nullable=True)
    input_schema = Column(JSON, nullable=False, default=dict)
    requires_confirmation = Column(Boolean, nullable=False, default=True)
    allowed_roles = Column(JSON, nullable=False, default=list)  # ["ADMIN", "DATA_ENGINEER"]
    writes_to_object_type = Column(String, nullable=True)
    enabled = Column(Boolean, nullable=False, default=True)
    notify_email = Column(String, nullable=True)   # email to notify when execution is approved
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ActionExecutionRow(Base):
    """An individual execution (or pending proposal) of an Action."""
    __tablename__ = "action_executions"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    action_name = Column(String, nullable=False, index=True)
    inputs = Column(JSON, nullable=False, default=dict)
    # pending_confirmation → confirmed/rejected → running → completed/failed
    status = Column(String, nullable=False, default="pending_confirmation", index=True)
    result = Column(JSON, nullable=True)
    error = Column(Text, nullable=True)
    executed_by = Column(String, nullable=True)   # user_id, "agent:{id}", or "logic:{id}"
    confirmed_by = Column(String, nullable=True)
    rejected_by = Column(String, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    source = Column(String, nullable=True)         # "agent:xxx", "logic_function:xxx", "manual"
    source_id = Column(String, nullable=True)      # agent_id or function_id
    reasoning = Column(Text, nullable=True)        # AI's justification for the action
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
