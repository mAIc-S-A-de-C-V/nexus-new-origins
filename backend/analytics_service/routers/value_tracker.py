"""
Value Realization Tracker — inspired by Celonis Path-to-Value.
Tracks identified, framed, and realized value per automation/pipeline/agent use case.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_session

router = APIRouter()

DEFAULT_TENANT = "tenant-001"


def _tid(x_tenant_id: Optional[str]) -> str:
    return x_tenant_id or DEFAULT_TENANT


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = "#7C3AED"
    currency: str = "USD"


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    currency: Optional[str] = None


class UseCaseCreate(BaseModel):
    category_id: str
    name: str
    description: Optional[str] = None
    source_type: str = "manual"         # pipeline | automation | agent | logic | manual
    source_id: Optional[str] = None
    identified_value: float = 0.0
    improvement_potential_pct: float = 0.0
    formula_description: Optional[str] = None
    formula_params: Optional[dict] = None


class UseCaseUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    identified_value: Optional[float] = None
    framed_value: Optional[float] = None
    improvement_potential_pct: Optional[float] = None
    formula_description: Optional[str] = None
    formula_params: Optional[dict] = None
    status: Optional[str] = None        # open | framed | realized


class ValueEventCreate(BaseModel):
    amount: float
    notes: Optional[str] = None
    occurred_at: Optional[str] = None   # ISO datetime string


# ── Category endpoints ────────────────────────────────────────────────────────

@router.get("/categories")
async def list_categories(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tid = _tid(x_tenant_id)
    rows = await db.execute(
        text("SELECT * FROM value_categories WHERE tenant_id = :tid ORDER BY created_at"),
        {"tid": tid},
    )
    return {"items": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/categories", status_code=201)
async def create_category(
    body: CategoryCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tid = _tid(x_tenant_id)
    cid = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO value_categories (id, tenant_id, name, description, color, currency)
            VALUES (:id, :tid, :name, :desc, :color, :currency)
        """),
        {"id": cid, "tid": tid, "name": body.name, "desc": body.description,
         "color": body.color, "currency": body.currency},
    )
    await db.commit()
    row = await db.execute(
        text("SELECT * FROM value_categories WHERE id = :id"), {"id": cid}
    )
    return dict(row.fetchone()._mapping)


@router.patch("/categories/{category_id}")
async def update_category(
    category_id: str,
    body: CategoryUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tid = _tid(x_tenant_id)
    sets, params = ["updated_at = NOW()"], {"id": category_id, "tid": tid}
    if body.name is not None:
        sets.append("name = :name"); params["name"] = body.name
    if body.description is not None:
        sets.append("description = :desc"); params["desc"] = body.description
    if body.color is not None:
        sets.append("color = :color"); params["color"] = body.color
    if body.currency is not None:
        sets.append("currency = :currency"); params["currency"] = body.currency
    await db.execute(
        text(f"UPDATE value_categories SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"),
        params,
    )
    await db.commit()
    row = await db.execute(
        text("SELECT * FROM value_categories WHERE id = :id"), {"id": category_id}
    )
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Category not found")
    return dict(r._mapping)


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tid = _tid(x_tenant_id)
    await db.execute(
        text("DELETE FROM value_categories WHERE id = :id AND tenant_id = :tid"),
        {"id": category_id, "tid": tid},
    )
    await db.commit()


# ── Use case endpoints ────────────────────────────────────────────────────────

@router.get("/use-cases")
async def list_use_cases(
    category_id: Optional[str] = None,
    status: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tid = _tid(x_tenant_id)
    where = "WHERE vc.tenant_id = :tid"
    params: dict = {"tid": tid}
    if category_id:
        where += " AND vu.category_id = :cat"
        params["cat"] = category_id
    if status:
        where += " AND vu.status = :status"
        params["status"] = status

    rows = await db.execute(
        text(f"""
            SELECT vu.*, vc.name AS category_name, vc.color AS category_color, vc.currency
            FROM value_use_cases vu
            JOIN value_categories vc ON vu.category_id = vc.id
            {where}
            ORDER BY vu.created_at DESC
        """),
        params,
    )
    return {"items": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/use-cases", status_code=201)
async def create_use_case(
    body: UseCaseCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    import json
    tid = _tid(x_tenant_id)
    uid = str(uuid.uuid4())
    await db.execute(
        text("""
            INSERT INTO value_use_cases
              (id, tenant_id, category_id, name, description, source_type, source_id,
               identified_value, improvement_potential_pct, formula_description, formula_params)
            VALUES
              (:id, :tid, :cat, :name, :desc, :stype, :sid,
               :ival, :ipct, :fdesc, :fparams::jsonb)
        """),
        {
            "id": uid, "tid": tid, "cat": body.category_id, "name": body.name,
            "desc": body.description, "stype": body.source_type, "sid": body.source_id,
            "ival": body.identified_value, "ipct": body.improvement_potential_pct,
            "fdesc": body.formula_description,
            "fparams": json.dumps(body.formula_params or {}),
        },
    )
    await db.commit()
    row = await db.execute(
        text("SELECT * FROM value_use_cases WHERE id = :id"), {"id": uid}
    )
    return dict(row.fetchone()._mapping)


@router.get("/use-cases/{use_case_id}")
async def get_use_case(
    use_case_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tid = _tid(x_tenant_id)
    row = await db.execute(
        text("""
            SELECT vu.*, vc.name AS category_name, vc.color AS category_color, vc.currency
            FROM value_use_cases vu
            JOIN value_categories vc ON vu.category_id = vc.id
            WHERE vu.id = :id AND vc.tenant_id = :tid
        """),
        {"id": use_case_id, "tid": tid},
    )
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Use case not found")
    return dict(r._mapping)


@router.patch("/use-cases/{use_case_id}")
async def update_use_case(
    use_case_id: str,
    body: UseCaseUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    import json
    tid = _tid(x_tenant_id)
    sets = ["updated_at = NOW()"]
    params: dict = {"id": use_case_id}
    if body.name is not None:
        sets.append("name = :name"); params["name"] = body.name
    if body.description is not None:
        sets.append("description = :desc"); params["desc"] = body.description
    if body.identified_value is not None:
        sets.append("identified_value = :ival"); params["ival"] = body.identified_value
    if body.framed_value is not None:
        sets.append("framed_value = :fval"); params["fval"] = body.framed_value
    if body.improvement_potential_pct is not None:
        sets.append("improvement_potential_pct = :ipct"); params["ipct"] = body.improvement_potential_pct
    if body.formula_description is not None:
        sets.append("formula_description = :fdesc"); params["fdesc"] = body.formula_description
    if body.formula_params is not None:
        sets.append("formula_params = :fparams::jsonb"); params["fparams"] = json.dumps(body.formula_params)
    if body.status is not None:
        sets.append("status = :status"); params["status"] = body.status

    await db.execute(
        text(f"UPDATE value_use_cases SET {', '.join(sets)} WHERE id = :id"),
        params,
    )
    await db.commit()
    return await get_use_case(use_case_id, x_tenant_id, db)


@router.delete("/use-cases/{use_case_id}", status_code=204)
async def delete_use_case(
    use_case_id: str,
    db: AsyncSession = Depends(get_session),
):
    await db.execute(
        text("DELETE FROM value_use_cases WHERE id = :id"), {"id": use_case_id}
    )
    await db.commit()


# ── Value events ──────────────────────────────────────────────────────────────

@router.get("/use-cases/{use_case_id}/events")
async def list_events(
    use_case_id: str,
    db: AsyncSession = Depends(get_session),
):
    rows = await db.execute(
        text("SELECT * FROM value_events WHERE use_case_id = :uid ORDER BY occurred_at DESC"),
        {"uid": use_case_id},
    )
    return {"items": [dict(r._mapping) for r in rows.fetchall()]}


@router.post("/use-cases/{use_case_id}/events", status_code=201)
async def log_event(
    use_case_id: str,
    body: ValueEventCreate,
    db: AsyncSession = Depends(get_session),
):
    eid = str(uuid.uuid4())
    occurred_at = body.occurred_at or datetime.utcnow().isoformat()
    await db.execute(
        text("""
            INSERT INTO value_events (id, use_case_id, amount, notes, occurred_at)
            VALUES (:id, :uid, :amount, :notes, :oat)
        """),
        {"id": eid, "uid": use_case_id, "amount": body.amount,
         "notes": body.notes, "oat": occurred_at},
    )
    # Update realized_value on use case
    await db.execute(
        text("""
            UPDATE value_use_cases
            SET realized_value = (
                SELECT COALESCE(SUM(amount), 0) FROM value_events WHERE use_case_id = :uid
            ),
            updated_at = NOW()
            WHERE id = :uid
        """),
        {"uid": use_case_id},
    )
    await db.commit()
    row = await db.execute(
        text("SELECT * FROM value_events WHERE id = :id"), {"id": eid}
    )
    return dict(row.fetchone()._mapping)


# ── Summary / aggregation ─────────────────────────────────────────────────────

@router.get("/summary")
async def get_summary(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Aggregate totals per category — powers the top section of the Value Monitor."""
    tid = _tid(x_tenant_id)
    rows = await db.execute(
        text("""
            SELECT
                vc.id AS category_id,
                vc.name AS category_name,
                vc.color,
                vc.currency,
                COUNT(vu.id) AS use_case_count,
                COALESCE(SUM(vu.identified_value), 0) AS total_identified,
                COALESCE(SUM(vu.framed_value), 0)     AS total_framed,
                COALESCE(SUM(vu.realized_value), 0)   AS total_realized
            FROM value_categories vc
            LEFT JOIN value_use_cases vu ON vu.category_id = vc.id
            WHERE vc.tenant_id = :tid
            GROUP BY vc.id, vc.name, vc.color, vc.currency
            ORDER BY vc.created_at
        """),
        {"tid": tid},
    )
    categories = [dict(r._mapping) for r in rows.fetchall()]

    # Grand totals (first currency wins for display — assumes single currency per tenant)
    total_identified = sum(c["total_identified"] for c in categories)
    total_framed = sum(c["total_framed"] for c in categories)
    total_realized = sum(c["total_realized"] for c in categories)
    currency = categories[0]["currency"] if categories else "USD"

    return {
        "currency": currency,
        "total_identified": float(total_identified),
        "total_framed": float(total_framed),
        "total_realized": float(total_realized),
        "categories": [{**c, "total_identified": float(c["total_identified"]),
                        "total_framed": float(c["total_framed"]),
                        "total_realized": float(c["total_realized"])} for c in categories],
    }


@router.get("/timeline")
async def get_timeline(
    x_tenant_id: Optional[str] = Header(None),
    category_id: Optional[str] = None,
    db: AsyncSession = Depends(get_session),
):
    """Realized value over time, bucketed by month."""
    tid = _tid(x_tenant_id)
    where = "WHERE vc.tenant_id = :tid"
    params: dict = {"tid": tid}
    if category_id:
        where += " AND vu.category_id = :cat"
        params["cat"] = category_id

    rows = await db.execute(
        text(f"""
            SELECT
                TO_CHAR(ve.occurred_at, 'YYYY-MM') AS month,
                COALESCE(SUM(ve.amount), 0) AS realized
            FROM value_events ve
            JOIN value_use_cases vu ON ve.use_case_id = vu.id
            JOIN value_categories vc ON vu.category_id = vc.id
            {where}
            GROUP BY TO_CHAR(ve.occurred_at, 'YYYY-MM')
            ORDER BY month
        """),
        params,
    )
    return {"items": [{"month": r._mapping["month"], "realized": float(r._mapping["realized"])}
                      for r in rows.fetchall()]}
