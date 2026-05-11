"""
SQLAlchemy models for apps_service.

Five tables:
  external_apps          — registered marketplace catalog entries (1 row per published app)
  external_app_versions  — immutable, content-hashed versions of each app
  external_app_installs  — per-tenant install state with scope grants + config
  external_app_kv        — app-owned key/value storage (scoped to install + optional user)
  external_app_audit     — every RPC call + function run + lifecycle event
  external_app_functions — per-version registered server-side functions
  external_app_runs      — invocations of server-side functions (cron, webhook, http)
"""
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import (
    Column, String, DateTime, JSON, Boolean, Integer, Text, BigInteger,
    LargeBinary, UniqueConstraint, Index, func,
)

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


class ExternalAppRow(Base):
    """Marketplace catalog entry. One per (publisher, app_id)."""
    __tablename__ = "external_apps"

    app_id = Column(String, primary_key=True)              # e.g. "procurement-cockpit"
    publisher_id = Column(String, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    icon_url = Column(String, nullable=True)
    homepage_url = Column(String, nullable=True)
    latest_version = Column(String, nullable=True)         # pointer to current "head"
    visibility = Column(String, nullable=False, default="public")  # public | private | unlisted
    # Empty list = no restriction (visible/installable by every tenant).
    # Non-empty list = only those tenant_ids can see + install it. The
    # catalog filter and the install guard both respect this; existing
    # installs in non-listed tenants are preserved (we just stop new ones).
    tenant_allowlist = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ExternalAppVersionRow(Base):
    """Immutable, content-hashed version of an app. Published once, never mutated."""
    __tablename__ = "external_app_versions"
    __table_args__ = (
        UniqueConstraint("app_id", "version", name="uq_app_version"),
        Index("ix_app_versions_app", "app_id"),
    )

    id = Column(String, primary_key=True)
    app_id = Column(String, nullable=False)
    version = Column(String, nullable=False)               # semver: 1.2.3
    manifest = Column(JSON, nullable=False)                # full validated manifest
    bundle_sha256 = Column(String, nullable=False)         # hex digest of bundle
    bundle_path = Column(String, nullable=False)           # storage-relative path
    bundle_size_bytes = Column(BigInteger, nullable=False)
    entry_url = Column(String, nullable=False)             # public URL the host iframes
    scopes_required = Column(JSON, nullable=False, default=list)   # ["ontology:read:*", ...]
    surfaces = Column(JSON, nullable=False, default=list)
    config_schema = Column(JSON, nullable=True)
    functions = Column(JSON, nullable=False, default=list)
    event_subscriptions = Column(JSON, nullable=False, default=list)
    published_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    published_by = Column(String, nullable=True)
    yanked = Column(Boolean, nullable=False, default=False)
    yanked_reason = Column(Text, nullable=True)


class ExternalAppInstallRow(Base):
    """Per-tenant install. Scopes_granted is a strict subset of version's scopes_required."""
    __tablename__ = "external_app_installs"
    __table_args__ = (
        UniqueConstraint("tenant_id", "app_id", name="uq_tenant_app"),
        Index("ix_installs_tenant", "tenant_id"),
        Index("ix_installs_app", "app_id"),
    )

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False)
    app_id = Column(String, nullable=False)
    version_pinned = Column(String, nullable=False)        # exact version, never "latest"
    scopes_granted = Column(JSON, nullable=False, default=list)
    scopes_denied = Column(JSON, nullable=False, default=list)
    config = Column(JSON, nullable=False, default=dict)
    enabled = Column(Boolean, nullable=False, default=True)
    installed_by = Column(String, nullable=False)
    installed_by_email = Column(String, nullable=True)
    installed_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ExternalAppKVRow(Base):
    """App-owned KV storage. Scoped to (install_id, optional user_id, key)."""
    __tablename__ = "external_app_kv"
    __table_args__ = (
        UniqueConstraint("install_id", "user_id", "key", name="uq_kv_scope"),
        Index("ix_kv_install", "install_id"),
    )

    id = Column(String, primary_key=True)
    install_id = Column(String, nullable=False)
    user_id = Column(String, nullable=True)                # NULL = install-wide (shared)
    key = Column(String, nullable=False)
    value = Column(JSON, nullable=False)
    size_bytes = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ExternalAppAuditRow(Base):
    """One row per RPC call, function run, install/uninstall, scope change."""
    __tablename__ = "external_app_audit"
    __table_args__ = (
        Index("ix_audit_install_time", "install_id", "occurred_at"),
        Index("ix_audit_tenant_time", "tenant_id", "occurred_at"),
    )

    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False)
    install_id = Column(String, nullable=True)             # nullable for marketplace-level events
    app_id = Column(String, nullable=True)
    user_id = Column(String, nullable=True)
    event_type = Column(String, nullable=False)            # rpc.call | install | uninstall | scope_change | function.run
    method = Column(String, nullable=True)                 # for rpc.call
    scope_used = Column(String, nullable=True)
    payload_size = Column(Integer, nullable=True)
    response_size = Column(Integer, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    status = Column(String, nullable=False)                # ok | denied | error
    error_message = Column(Text, nullable=True)
    extras = Column(JSON, nullable=True)
    occurred_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ExternalAppFunctionRow(Base):
    """Server-side function registered by an installed app version."""
    __tablename__ = "external_app_functions"
    __table_args__ = (
        UniqueConstraint("install_id", "function_name", name="uq_install_function"),
        Index("ix_fn_install", "install_id"),
    )

    id = Column(String, primary_key=True)
    install_id = Column(String, nullable=False)
    tenant_id = Column(String, nullable=False)
    function_name = Column(String, nullable=False)         # e.g. "nightly_summary"
    trigger_type = Column(String, nullable=False)          # schedule | webhook | http
    trigger_config = Column(JSON, nullable=False, default=dict)
    code = Column(Text, nullable=False)                    # Python source (restricted runtime)
    timeout_ms = Column(Integer, nullable=False, default=30000)
    enabled = Column(Boolean, nullable=False, default=True)
    last_run_at = Column(DateTime(timezone=True), nullable=True)
    last_run_status = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ExternalAppRunRow(Base):
    """Invocation record for a server-side function."""
    __tablename__ = "external_app_runs"
    __table_args__ = (
        Index("ix_runs_function_time", "function_id", "started_at"),
        Index("ix_runs_install_time", "install_id", "started_at"),
    )

    id = Column(String, primary_key=True)
    function_id = Column(String, nullable=False)
    install_id = Column(String, nullable=False)
    tenant_id = Column(String, nullable=False)
    trigger = Column(String, nullable=False)               # schedule | webhook | http | manual
    input = Column(JSON, nullable=True)
    output = Column(JSON, nullable=True)
    logs = Column(Text, nullable=True)
    status = Column(String, nullable=False)                # running | ok | error | timeout
    error_message = Column(Text, nullable=True)
    duration_ms = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at = Column(DateTime(timezone=True), nullable=True)


async def init_db():
    from sqlalchemy import text
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column additions for tables that pre-date the column.
        # create_all only creates missing tables, never alters existing ones,
        # so any column added after the first deploy needs an explicit ADD.
        await conn.execute(text(
            "ALTER TABLE external_apps "
            "ADD COLUMN IF NOT EXISTS tenant_allowlist JSONB NOT NULL DEFAULT '[]'::jsonb"
        ))


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
