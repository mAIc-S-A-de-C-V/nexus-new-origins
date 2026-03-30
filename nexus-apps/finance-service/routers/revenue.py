"""
Ingresos — revenue / income entries.
  GET    /finance/revenue
  POST   /finance/revenue
  PUT    /finance/revenue/{id}
  DELETE /finance/revenue/{id}
  GET    /finance/revenue/summary
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import RevenueRow, get_session

router = APIRouter()
TENANT = "tenant-001"
STATUSES = {"received", "pending"}


class RevenueIn(BaseModel):
    date: str
    description: str = ""
    client: Optional[str] = None
    invoice_number: Optional[str] = None
    amount_usd: float
    currency: str = "USD"
    status: str = "received"
    notes: Optional[str] = None


def _row(r: RevenueRow) -> dict:
    return {
        "id": r.id,
        "tenant_id": r.tenant_id,
        "date": r.date,
        "description": r.description or "",
        "client": r.client,
        "invoice_number": r.invoice_number,
        "amount_usd": float(r.amount_usd),
        "currency": r.currency,
        "status": r.status,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _tid(x_tenant_id: str = Header(default=TENANT)) -> str:
    return x_tenant_id


@router.get("/summary")
async def revenue_summary(
    year: Optional[int] = None,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    q = select(RevenueRow).where(RevenueRow.tenant_id == tenant_id)
    if year:
        q = q.where(RevenueRow.date.like(f"{year}-%"))
    rows = (await db.execute(q)).scalars().all()

    total = sum(float(r.amount_usd) for r in rows)
    received = sum(float(r.amount_usd) for r in rows if r.status == "received")
    pending = sum(float(r.amount_usd) for r in rows if r.status == "pending")
    by_month: dict[str, float] = {}
    by_client: dict[str, float] = {}
    for r in rows:
        month = r.date[:7]
        by_month[month] = by_month.get(month, 0) + float(r.amount_usd)
        client = r.client or "Unknown"
        by_client[client] = by_client.get(client, 0) + float(r.amount_usd)

    return {
        "total": total,
        "received": received,
        "pending": pending,
        "by_month": dict(sorted(by_month.items())),
        "by_client": dict(sorted(by_client.items(), key=lambda x: -x[1])[:10]),
    }


@router.get("")
async def list_revenue(
    year: Optional[int] = None,
    month: Optional[int] = None,
    status: Optional[str] = None,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    q = select(RevenueRow).where(RevenueRow.tenant_id == tenant_id)
    if year:
        q = q.where(RevenueRow.date.like(f"{year}-%"))
    if month:
        q = q.where(RevenueRow.date.like(f"%-{str(month).zfill(2)}-%"))
    if status:
        q = q.where(RevenueRow.status == status)
    q = q.order_by(RevenueRow.date.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_row(r) for r in rows]


@router.post("")
async def create_revenue(
    body: RevenueIn,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    if body.status not in STATUSES:
        raise HTTPException(400, f"status must be one of: {sorted(STATUSES)}")
    row = RevenueRow(id=str(uuid.uuid4()), tenant_id=tenant_id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row(row)


@router.put("/{rev_id}")
async def update_revenue(
    rev_id: str,
    body: RevenueIn,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    row = await db.get(RevenueRow, rev_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return _row(row)


@router.delete("/{rev_id}")
async def delete_revenue(
    rev_id: str,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    row = await db.get(RevenueRow, rev_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404)
    await db.delete(row)
    await db.commit()
    return {"deleted": rev_id}
