import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, DateTime, JSON, Text, Boolean, func, text
from sqlalchemy.dialects.postgresql import JSONB

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
    # JSONB (not JSON): stored binary, no per-row reparse on data->>'field',
    # and supports GIN indexes. /aggregate scans this column heavily.
    data = Column(JSONB, nullable=False)
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


class AppVersionRow(Base):
    """Frozen snapshot of an app's content at a point in time. External shares
    pin to a version_id so editing the parent app doesn't mutate live links.
    Snapshots are taken lazily on share creation, not on every save."""
    __tablename__ = "app_versions"
    id = Column(String, primary_key=True)
    app_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    version = Column(Integer, nullable=False, default=1)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    icon = Column(String, nullable=True)
    object_type_id = Column(String, nullable=False, default="")
    object_type_ids = Column(JSON, nullable=True, default=list)
    components = Column(JSON, nullable=False, default=list)
    settings = Column(JSON, nullable=True, default=dict)
    kind = Column(String, nullable=False, default="dashboard")
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AppShareRow(Base):
    """An external share link for an app — points at a pinned app_version."""
    __tablename__ = "app_shares"
    id = Column(String, primary_key=True)
    token = Column(String, nullable=False, unique=True, index=True)
    app_id = Column(String, nullable=False, index=True)
    app_version_id = Column(String, nullable=False, index=True)
    tenant_id = Column(String, nullable=False, index=True)
    name = Column(String, nullable=False)
    # 'submit' (form-only) or 'view' (read-only dashboard).
    mode = Column(String, nullable=False, default="submit")
    # 'public' | 'password' | 'email_whitelist' | 'nexus_user'.
    access_mode = Column(String, nullable=False, default="public")
    password_hash = Column(String, nullable=True)
    whitelist_emails = Column(JSON, nullable=True, default=list)
    max_uses = Column(Integer, nullable=True)
    use_count = Column(Integer, nullable=False, default=0)
    # 'submissions' for forms (one per /submit), 'sessions' for dashboards
    # (one per /auth or first /app fetch).
    count_what = Column(String, nullable=False, default="submissions")
    expires_at = Column(DateTime(timezone=True), nullable=True, index=True)
    revoked_at = Column(DateTime(timezone=True), nullable=True)
    # {filters: {...}, variable_overrides: {...}} merged server-side before
    # any kernel call — never trust the client to filter.
    data_scope = Column(JSON, nullable=True, default=dict)
    # {logo_url, primary_color, hide_chrome, support_email, name}.
    branding = Column(JSON, nullable=True, default=dict)
    # In-app QPS cap and auth-attempt lockout windows.
    rate_limit_qps = Column(Integer, nullable=False, default=10)
    auth_failures = Column(Integer, nullable=False, default=0)
    auth_locked_until = Column(DateTime(timezone=True), nullable=True)
    created_by_user_id = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class AppShareRedemptionRow(Base):
    """One row per share use — atomic source of truth for use_count.
    Insert + share row update happen in the same transaction."""
    __tablename__ = "app_share_redemptions"
    id = Column(String, primary_key=True)
    share_id = Column(String, nullable=False, index=True)
    redeemed_at = Column(DateTime(timezone=True), server_default=func.now())
    ip = Column(String, nullable=True)
    user_agent = Column(Text, nullable=True)
    email = Column(String, nullable=True)
    submission_id = Column(String, nullable=True)
    extra = Column(JSON, nullable=True, default=dict)


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
        # ── object_records perf migrations ──────────────────────────────────
        # 1) JSON → JSONB on `data`. JSONB stores parsed binary, so
        #    `data->>'field'` doesn't reparse text per row, and the column
        #    becomes eligible for GIN indexes. The ALTER takes an
        #    AccessExclusive lock and rewrites the table — slow on large
        #    tables, but only runs once (we skip if already jsonb).
        # 2) Composite (tenant_id, object_type_id) index. The single-column
        #    indexes already exist (declared on the model), but a composite
        #    lets /aggregate skip the bitmap-AND step and seek directly to
        #    the (tenant, ot) slice it actually wants.
        await conn.execute(text("""
            DO $$
            DECLARE
                col_type text;
            BEGIN
                SELECT data_type INTO col_type
                FROM information_schema.columns
                WHERE table_name = 'object_records' AND column_name = 'data';
                IF col_type = 'json' THEN
                    ALTER TABLE object_records
                        ALTER COLUMN data TYPE jsonb USING data::jsonb;
                END IF;
            END $$;
        """))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS ix_object_records_tenant_ot "
            "ON object_records (tenant_id, object_type_id)"
        ))
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
        # External-share tables — versions, shares, redemptions. asyncpg can't
        # take multi-statement SQL in one execute(), so each DDL statement
        # gets its own call. CREATE TABLE/INDEX IF NOT EXISTS keeps it
        # idempotent across boots.
        for stmt in [
            """
            CREATE TABLE IF NOT EXISTS app_versions (
                id VARCHAR PRIMARY KEY,
                app_id VARCHAR NOT NULL,
                tenant_id VARCHAR NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                name VARCHAR NOT NULL,
                description TEXT,
                icon VARCHAR,
                object_type_id VARCHAR NOT NULL DEFAULT '',
                object_type_ids JSON DEFAULT '[]',
                components JSON NOT NULL DEFAULT '[]',
                settings JSON DEFAULT '{}',
                kind VARCHAR NOT NULL DEFAULT 'dashboard',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_app_versions_app_id ON app_versions(app_id)",
            "CREATE INDEX IF NOT EXISTS ix_app_versions_tenant_id ON app_versions(tenant_id)",
            """
            CREATE TABLE IF NOT EXISTS app_shares (
                id VARCHAR PRIMARY KEY,
                token VARCHAR NOT NULL UNIQUE,
                app_id VARCHAR NOT NULL,
                app_version_id VARCHAR NOT NULL,
                tenant_id VARCHAR NOT NULL,
                name VARCHAR NOT NULL,
                mode VARCHAR NOT NULL DEFAULT 'submit',
                access_mode VARCHAR NOT NULL DEFAULT 'public',
                password_hash VARCHAR,
                whitelist_emails JSON DEFAULT '[]',
                max_uses INTEGER,
                use_count INTEGER NOT NULL DEFAULT 0,
                count_what VARCHAR NOT NULL DEFAULT 'submissions',
                expires_at TIMESTAMP WITH TIME ZONE,
                revoked_at TIMESTAMP WITH TIME ZONE,
                data_scope JSON DEFAULT '{}',
                branding JSON DEFAULT '{}',
                rate_limit_qps INTEGER NOT NULL DEFAULT 10,
                auth_failures INTEGER NOT NULL DEFAULT 0,
                auth_locked_until TIMESTAMP WITH TIME ZONE,
                created_by_user_id VARCHAR,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_app_shares_token ON app_shares(token)",
            "CREATE INDEX IF NOT EXISTS ix_app_shares_app_id ON app_shares(app_id)",
            "CREATE INDEX IF NOT EXISTS ix_app_shares_tenant_id ON app_shares(tenant_id)",
            "CREATE INDEX IF NOT EXISTS ix_app_shares_expires_at ON app_shares(expires_at)",
            """
            CREATE TABLE IF NOT EXISTS app_share_redemptions (
                id VARCHAR PRIMARY KEY,
                share_id VARCHAR NOT NULL,
                redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                ip VARCHAR,
                user_agent TEXT,
                email VARCHAR,
                submission_id VARCHAR,
                extra JSON DEFAULT '{}'
            )
            """,
            "CREATE INDEX IF NOT EXISTS ix_app_share_redemptions_share_id ON app_share_redemptions(share_id)",
            "CREATE INDEX IF NOT EXISTS ix_app_share_redemptions_redeemed_at ON app_share_redemptions(redeemed_at)",
        ]:
            await conn.execute(text(stmt))
        # Sweep expired ephemeral apps each boot — one cheap DELETE keeps
        # the cache from growing without a separate cron service.
        await conn.execute(text("""
            DELETE FROM apps
            WHERE is_ephemeral = true AND expires_at IS NOT NULL AND expires_at < NOW();
        """))


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
