import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import (
    Column, String, DateTime, JSON, Integer, Text, func,
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


class PdfJobRow(Base):
    """One PDF extraction job. Self-contained — no foreign keys to other services."""
    __tablename__ = "pdf_extractor_jobs"

    id              = Column(String, primary_key=True)
    tenant_id       = Column(String, nullable=False, index=True)
    filename        = Column(String, nullable=False)
    storage_key     = Column(String, nullable=False)        # MinIO object key for the source PDF
    status          = Column(String, nullable=False, default="pending", index=True)
    # pending | running | completed | failed

    # Config snapshot
    model           = Column(String, nullable=False, default="claude-opus-4-7")
    dpi             = Column(Integer, nullable=False, default=150)
    page_range      = Column(String, nullable=True)         # "13-20" or null
    schema_prompt   = Column(Text, nullable=True)           # null = use default catalog prompt

    # Progress + results
    total_pages     = Column(Integer, nullable=True)
    pages_done      = Column(Integer, nullable=False, default=0)
    products_found  = Column(Integer, nullable=False, default=0)
    error           = Column(Text, nullable=True)
    progress_log    = Column(JSON, nullable=False, default=list)
    # progress_log entries: { "page": int, "page_type": str, "category": str, "products": int, "error"?: str }

    # If pushed to ontology, retain a reference (advisory only)
    pushed_to_object_type_id = Column(String, nullable=True)
    pushed_at                = Column(DateTime(timezone=True), nullable=True)

    created_at      = Column(DateTime(timezone=True), server_default=func.now())
    updated_at      = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class PdfProductRow(Base):
    """One extracted product/row from a PdfJobRow. Schema mirrors sample_output.csv."""
    __tablename__ = "pdf_extractor_products"

    id              = Column(String, primary_key=True)
    job_id          = Column(String, nullable=False, index=True)
    tenant_id       = Column(String, nullable=False, index=True)

    page            = Column(Integer, nullable=False, index=True)
    category        = Column(String, nullable=True)
    name            = Column(Text, nullable=True)
    sku_internal    = Column(String, nullable=True)
    sku_ref         = Column(String, nullable=True)
    specifications  = Column(JSON, nullable=False, default=dict)
    accessories     = Column(JSON, nullable=False, default=list)
    variants        = Column(JSON, nullable=False, default=list)
    bbox_norm       = Column(JSON, nullable=True)

    image_storage_key = Column(String, nullable=True)  # MinIO object key for the matched image
    image_url         = Column(String, nullable=True)  # Public URL via MINIO_PUBLIC_BASE

    created_at      = Column(DateTime(timezone=True), server_default=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
