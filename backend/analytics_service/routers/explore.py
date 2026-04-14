from fastapi import APIRouter, Depends, Request, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from database import get_session
from query_engine import run_explore_query, sample_fields

router = APIRouter()


def _tenant(request: Request) -> str:
    return request.headers.get("x-tenant-id", "tenant-001")


# ── Models ─────────────────────────────────────────────────────────────────────

class FilterRow(BaseModel):
    field: str
    op: str = "eq"
    value: str = ""


class AggregateSpec(BaseModel):
    function: str = "COUNT"   # COUNT | SUM | AVG | MIN | MAX
    field: str = "*"


class OrderSpec(BaseModel):
    field: str = "created_at"
    direction: str = "desc"


class ExploreQueryRequest(BaseModel):
    object_type_id: str
    filters: list[FilterRow] = Field(default_factory=list)
    aggregate: AggregateSpec | None = None
    group_by: str | None = None
    order_by: OrderSpec | None = None
    limit: int = Field(default=100, ge=1, le=500)
    offset: int = Field(default=0, ge=0)
    select_fields: list[str] = Field(default_factory=list)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/object-types")
async def list_object_types(
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    tenant_id = _tenant(request)
    result = await session.execute(
        text("SELECT id, name, display_name FROM object_types WHERE tenant_id = :tid ORDER BY display_name"),
        {"tid": tenant_id},
    )
    rows = result.fetchall()
    return [{"id": r.id, "name": r.name, "displayName": r.display_name} for r in rows]


@router.get("/object-types/{object_type_id}/fields")
async def get_fields(
    object_type_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    tenant_id = _tenant(request)
    fields = await sample_fields(session, tenant_id, object_type_id, limit=200)

    # Also get record count
    count_result = await session.execute(
        text("SELECT COUNT(*) FROM object_records WHERE tenant_id = :tid AND object_type_id = :oid"),
        {"tid": tenant_id, "oid": object_type_id},
    )
    count = count_result.scalar() or 0

    return {"fields": sorted(fields), "record_count": int(count)}


@router.post("/query")
async def explore_query(
    body: ExploreQueryRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    tenant_id = _tenant(request)
    return await run_explore_query(
        session=session,
        tenant_id=tenant_id,
        object_type_id=body.object_type_id,
        filters=[f.model_dump() for f in body.filters],
        aggregate=body.aggregate.model_dump() if body.aggregate else None,
        group_by=body.group_by,
        order_by=body.order_by.model_dump() if body.order_by else None,
        limit=body.limit,
        offset=body.offset,
        select_fields=body.select_fields,
    )


@router.get("/object-types/{object_type_id}/sample")
async def get_sample(
    object_type_id: str,
    request: Request,
    limit: int = Query(default=5, le=20),
    session: AsyncSession = Depends(get_session),
):
    """Return a few raw records for schema preview."""
    tenant_id = _tenant(request)
    result = await session.execute(
        text("""
            SELECT data FROM object_records
            WHERE tenant_id = :tid AND object_type_id = :oid
            LIMIT :limit
        """),
        {"tid": tenant_id, "oid": object_type_id, "limit": limit},
    )
    rows = result.fetchall()
    return [dict(r.data or {}) for r in rows]
