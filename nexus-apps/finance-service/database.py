import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, DateTime, Numeric, func

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class TransactionRow(Base):
    """Expense ledger — Salaries, Software, Admin, Finanzas, Oficina, Marketing."""
    __tablename__ = "fin_transactions"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    category = Column(String, nullable=False, index=True)   # salaries | software | admin | finanzas | oficina | marketing
    date = Column(String, nullable=False)                    # ISO date string YYYY-MM-DD
    description = Column(String, nullable=False, default="")
    vendor = Column(String, nullable=True)
    payment_method = Column(String, nullable=True)
    amount_usd = Column(Numeric(18, 2), nullable=False)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class RevenueRow(Base):
    """Ingresos — income / revenue entries."""
    __tablename__ = "fin_revenue"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    date = Column(String, nullable=False)
    description = Column(String, nullable=False, default="")
    client = Column(String, nullable=True)
    invoice_number = Column(String, nullable=True)
    amount_usd = Column(Numeric(18, 2), nullable=False)
    currency = Column(String, nullable=False, default="USD")
    status = Column(String, nullable=False, default="received")  # received | pending
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class ReceivableRow(Base):
    """Cuentas por Cobrar — accounts receivable."""
    __tablename__ = "fin_receivables"
    id = Column(String, primary_key=True)
    tenant_id = Column(String, nullable=False, index=True)
    client = Column(String, nullable=False)
    invoice_number = Column(String, nullable=True)
    invoice_date = Column(String, nullable=False)
    due_date = Column(String, nullable=True)
    amount_usd = Column(Numeric(18, 2), nullable=False)
    currency = Column(String, nullable=False, default="USD")
    status = Column(String, nullable=False, default="pending")  # pending | partial | paid | overdue
    paid_amount = Column(Numeric(18, 2), nullable=False, default=0)
    description = Column(String, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_session() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        yield session
