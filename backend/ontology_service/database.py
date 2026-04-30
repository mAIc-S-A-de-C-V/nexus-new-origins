import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, Boolean, func, text

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
    # App-level settings — holds dashboard filter bar config, declared
    # actions, variables, events, and other free-form per-app metadata.
    settings = Column(JSON, nullable=True, default=dict)
    # Phase G — distinguishes 'dashboard' (read-only viz) from 'app'
    # (interactive/transactional). Two list pages filter by this.
    kind = Column(String, nullable=False, default="dashboard", index=True)
    # Phase E — ephemeral generated dashboards. Expire after 7 days unless
    # explicitly saved. parent_app_id / generated_from_widget_id link back
    # to the dashboard+widget that triggered the generation.
    is_ephemeral = Column(Boolean, nullable=False, default=False, index=True)
    parent_app_id = Column(String, nullable=True, index=True)
    generated_from_widget_id = Column(String, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    # Phase J — system-managed home dashboards (slug='dashboards-home' /
    # 'apps-home'). Cannot be deleted; drive the list pages.
    is_system = Column(Boolean, nullable=False, default=False, index=True)
    slug = Column(String, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class NotebookRow(Base):
    """Persisted Workbench notebooks — Jupyter-style cells + outputs."""
    __tablename__ = "notebooks"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    cells = Column(JSON, nullable=False, default=list)
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
        # Migrate: add object_type_ids column to apps if missing
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'object_type_ids'
                ) THEN
                    ALTER TABLE apps ADD COLUMN object_type_ids JSON DEFAULT '[]';
                END IF;
            END $$;
        """))
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'settings'
                ) THEN
                    ALTER TABLE apps ADD COLUMN settings JSON DEFAULT '{}';
                END IF;
            END $$;
        """))
        # Phase E/G/J columns. Single DO block keeps the migration idempotent
        # and cheap on subsequent boots (each NOT EXISTS check is index-only).
        await conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'kind'
                ) THEN
                    ALTER TABLE apps ADD COLUMN kind VARCHAR(20) DEFAULT 'dashboard';
                    CREATE INDEX IF NOT EXISTS ix_apps_kind ON apps(kind);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'is_ephemeral'
                ) THEN
                    ALTER TABLE apps ADD COLUMN is_ephemeral BOOLEAN DEFAULT false;
                    CREATE INDEX IF NOT EXISTS ix_apps_is_ephemeral ON apps(is_ephemeral);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'parent_app_id'
                ) THEN
                    ALTER TABLE apps ADD COLUMN parent_app_id VARCHAR(64);
                    CREATE INDEX IF NOT EXISTS ix_apps_parent_app_id ON apps(parent_app_id);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'generated_from_widget_id'
                ) THEN
                    ALTER TABLE apps ADD COLUMN generated_from_widget_id VARCHAR(64);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'expires_at'
                ) THEN
                    ALTER TABLE apps ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE;
                    CREATE INDEX IF NOT EXISTS ix_apps_expires_at ON apps(expires_at);
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'is_system'
                ) THEN
                    ALTER TABLE apps ADD COLUMN is_system BOOLEAN DEFAULT false;
                END IF;
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'apps' AND column_name = 'slug'
                ) THEN
                    ALTER TABLE apps ADD COLUMN slug VARCHAR(100);
                    CREATE INDEX IF NOT EXISTS ix_apps_slug ON apps(slug);
                END IF;
            END $$;
        """))
        # Sweep expired ephemeral apps each boot — one cheap DELETE keeps
        # the cache from growing without a separate cron service.
        await conn.execute(text("""
            DELETE FROM apps
            WHERE is_ephemeral = true AND expires_at IS NOT NULL AND expires_at < NOW();
        """))


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
