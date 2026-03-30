"""
Cuentas por Cobrar — accounts receivable.
  GET    /finance/receivables
  POST   /finance/receivables
  PUT    /finance/receivables/{id}
  DELETE /finance/receivables/{id}
  GET    /finance/receivables/summary
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import ReceivableRow, get_session

router = APIRouter()
TENANT = "tenant-001"
STATUSES = {"pending", "partial", "paid", "overdue"}


class ReceivableIn(BaseModel):
    client: str
    invoice_number: Optional[str] = None
    invoice_date: str
    due_date: Optional[str] = None
    amount_usd: float
    currency: str = "USD"
    status: str = "pending"
    paid_amount: float = 0.0
    description: Optional[str] = None
    notes: Optional[str] = None


def _row(r: ReceivableRow) -> dict:
    return {
        "id": r.id,
        "tenant_id": r.tenant_id,
        "client": r.client,
        "invoice_number": r.invoice_number,
        "invoice_date": r.invoice_date,
        "due_date": r.due_date,
        "amount_usd": float(r.amount_usd),
        "currency": r.currency,
        "status": r.status,
        "paid_amount": float(r.paid_amount),
        "balance": float(r.amount_usd) - float(r.paid_amount),
        "description": r.description,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _tid(x_tenant_id: str = Header(default=TENANT)) -> str:
    return x_tenant_id


@router.get("/summary")
async def receivables_summary(
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    rows = (
        await db.execute(
            select(ReceivableRow).where(ReceivableRow.tenant_id == tenant_id)
        )
    ).scalars().all()

    total = sum(float(r.amount_usd) for r in rows)
    collected = sum(float(r.paid_amount) for r in rows)
    balance = total - collected

    by_status: dict[str, float] = {}
    by_client: dict[str, float] = {}
    for r in rows:
        balance_r = float(r.amount_usd) - float(r.paid_amount)
        by_status[r.status] = by_status.get(r.status, 0) + balance_r
        by_client[r.client] = by_client.get(r.client, 0) + balance_r

    return {
        "total_invoiced": total,
        "total_collected": collected,
        "total_balance": balance,
        "by_status": by_status,
        "by_client": dict(sorted(by_client.items(), key=lambda x: -x[1])[:10]),
    }


@router.get("")
async def list_receivables(
    status: Optional[str] = None,
    client: Optional[str] = None,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    q = select(ReceivableRow).where(ReceivableRow.tenant_id == tenant_id)
    if status:
        q = q.where(ReceivableRow.status == status)
    if client:
        q = q.where(ReceivableRow.client.ilike(f"%{client}%"))
    q = q.order_by(ReceivableRow.invoice_date.desc())
    rows = (await db.execute(q)).scalars().all()
    return [_row(r) for r in rows]


@router.post("")
async def create_receivable(
    body: ReceivableIn,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    if body.status not in STATUSES:
        raise HTTPException(400, f"status must be one of: {sorted(STATUSES)}")
    row = ReceivableRow(id=str(uuid.uuid4()), tenant_id=tenant_id, **body.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row(row)


@router.put("/{rec_id}")
async def update_receivable(
    rec_id: str,
    body: ReceivableIn,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    row = await db.get(ReceivableRow, rec_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404)
    for k, v in body.model_dump().items():
        setattr(row, k, v)
    await db.commit()
    await db.refresh(row)
    return _row(row)


@router.delete("/{rec_id}")
async def delete_receivable(
    rec_id: str,
    tenant_id: str = Depends(_tid),
    db: AsyncSession = Depends(get_session),
):
    row = await db.get(ReceivableRow, rec_id)
    if not row or row.tenant_id != tenant_id:
        raise HTTPException(404)
    await db.delete(row)
    await db.commit()
    return {"deleted": rec_id}
