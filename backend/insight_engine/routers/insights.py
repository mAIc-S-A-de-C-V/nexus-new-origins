"""
CRUD-ish endpoints for discovered insights: list, get, patch status,
promote-to-alert, investigate (deep-link payload).
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_pg_session
from promote import promote_insight_to_alert

router = APIRouter()


def _row_to_dict(r) -> dict:
    d = dict(r._mapping)
    for k in ("discovered_at",):
        if d.get(k) and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    for jk in ("feature", "outcome", "causal_estimate", "evidence"):
        if isinstance(d.get(jk), str):
            try:
                d[jk] = json.loads(d[jk])
            except Exception:
                pass
    return d


@router.get("")
async def list_insights(
    tenant_id: str = "tenant-001",
    status: Optional[str] = None,
    family: Optional[str] = None,
    object_type_id: Optional[str] = None,
    min_rank: Optional[float] = None,
    limit: int = 100,
    pg: AsyncSession = Depends(get_pg_session),
):
    sql = "SELECT * FROM discovered_insights WHERE tenant_id = :t"
    params: dict = {"t": tenant_id}
    if status:
        sql += " AND status = :s"
        params["s"] = status
    if family:
        sql += " AND family = :f"
        params["f"] = family
    if object_type_id:
        sql += " AND object_type_id = :ot"
        params["ot"] = object_type_id
    if min_rank is not None:
        sql += " AND rank_score >= :mr"
        params["mr"] = float(min_rank)
    sql += " ORDER BY rank_score DESC, discovered_at DESC LIMIT :lim"
    params["lim"] = int(limit)
    rows = await pg.execute(text(sql), params)
    return {"insights": [_row_to_dict(r) for r in rows.fetchall()]}


@router.get("/{insight_id}")
async def get_insight(insight_id: str, tenant_id: str = "tenant-001",
                       pg: AsyncSession = Depends(get_pg_session)):
    row = await pg.execute(text(
        "SELECT * FROM discovered_insights WHERE id = :i AND tenant_id = :t"
    ), {"i": insight_id, "t": tenant_id})
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Insight not found")
    return _row_to_dict(r)


class PatchBody(BaseModel):
    status: str  # 'seen' | 'pinned' | 'dismissed'


@router.patch("/{insight_id}")
async def patch_insight(insight_id: str, body: PatchBody,
                        tenant_id: str = "tenant-001",
                        pg: AsyncSession = Depends(get_pg_session)):
    if body.status not in ("seen", "pinned", "dismissed", "new"):
        raise HTTPException(400, "Invalid status")
    await pg.execute(text(
        "UPDATE discovered_insights SET status = :s "
        "WHERE id = :i AND tenant_id = :t"
    ), {"s": body.status, "i": insight_id, "t": tenant_id})
    await pg.commit()
    return {"ok": True}


class PromoteBody(BaseModel):
    threshold: float = 0.3


@router.post("/{insight_id}/promote-to-alert")
async def promote_to_alert(insight_id: str, body: PromoteBody = PromoteBody(),
                            tenant_id: str = "tenant-001"):
    rule = await promote_insight_to_alert(tenant_id, insight_id, body.threshold)
    if not rule:
        raise HTTPException(502, "Failed to create alert rule")
    return {"ok": True, "rule": rule}


@router.post("/{insight_id}/investigate")
async def investigate(insight_id: str, tenant_id: str = "tenant-001",
                       pg: AsyncSession = Depends(get_pg_session)):
    """Build a deep-link payload the frontend can route into ProcessMining
    with the feature filter applied."""
    row = await pg.execute(text(
        "SELECT * FROM discovered_insights WHERE id = :i AND tenant_id = :t"
    ), {"i": insight_id, "t": tenant_id})
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Insight not found")
    ins = _row_to_dict(r)
    feature = ins.get("feature") or {}
    evidence = ins.get("evidence") or {}
    attribute_filters: dict = {}
    name = feature.get("name")
    val = feature.get("value") or feature.get("values_compared")
    if name and isinstance(val, (str, int, float)):
        attribute_filters[name] = val
    return {
        "module": "process_mining",
        "object_type_id": ins.get("object_type_id"),
        "filters": {"attribute_filters": attribute_filters},
        "highlight_record_ids": (evidence or {}).get("sample_record_ids", [])[:50],
    }
