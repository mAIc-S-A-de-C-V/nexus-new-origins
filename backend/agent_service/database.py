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


class AgentConfigRow(Base):
    """A configured AI agent with a system prompt and set of enabled tools."""
    __tablename__ = "agent_configs"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    system_prompt = Column(Text, nullable=False)
    model = Column(String, nullable=False, default="claude-haiku-4-5-20251001")
    # list of tool names: "ontology_search", "logic_function", "action_propose", etc.
    enabled_tools = Column(JSON, nullable=False, default=list)
    # optional config per tool (e.g. which logic functions it can call)
    tool_config = Column(JSON, nullable=False, default=dict)
    max_iterations = Column(Integer, nullable=False, default=10)
    # knowledge_scope: null = unrestricted (sees all object types automatically)
    # non-null = list of { object_type_id, label, filter? } entries
    knowledge_scope = Column(JSON, nullable=True, default=None)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentThreadRow(Base):
    """A conversation thread with an agent."""
    __tablename__ = "agent_threads"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    agent_id = Column(String, nullable=False, index=True)
    title = Column(String, nullable=True)
    # open | closed
    status = Column(String, nullable=False, default="open")
    created_by = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AgentMessageRow(Base):
    """A single message in an agent thread."""
    __tablename__ = "agent_messages"
    id = Column(String, primary_key=True)
    thread_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    # user | assistant | tool_use | tool_result
    role = Column(String, nullable=False)
    content = Column(Text, nullable=False)         # text content
    tool_name = Column(String, nullable=True)       # set for tool_use / tool_result
    tool_use_id = Column(String, nullable=True)     # set for tool_use / tool_result
    tool_input = Column(JSON, nullable=True)        # set for tool_use
    tool_result = Column(JSON, nullable=True)       # set for tool_result
    created_at = Column(DateTime(timezone=True), server_default=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
