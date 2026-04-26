"""
Records API — persisted merged records per ObjectType.

POST /object-types/{ot_id}/records/sync  → pull from all source connectors, merge nested arrays, upsert
GET  /object-types/{ot_id}/records        → list persisted merged records (filter, sort, paginate)
GET  /object-types/{ot_id}/records/{record_id}          → single record by source_id
GET  /object-types/{ot_id}/records/{record_id}/links/{link_id}  → traverse a link
PATCH  /object-types/{ot_id}/records/{record_id}        → partial update (merge into data)
DELETE /object-types/{ot_id}/records/{record_id}         → delete a record
"""
import asyncio
import json
import logging
import os
import re
import httpx
from typing import Any, Optional
from uuid import uuid4
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func as sa_func, text
from sqlalchemy.orm.attributes import flag_modified
from database import get_session, ObjectTypeRow, ObjectRecordRow, OntologyLinkRow
from shared.auth_middleware import require_auth, AuthUser

logger = logging.getLogger(__name__)

CONNECTOR_API = os.environ.get("CONNECTOR_SERVICE_URL", "http://connector-service:8001")

router = APIRouter()


# ── PII masking ──────────────────────────────────────────────────────────────

def _mask_pii(records: list[dict], properties: list[dict], user_role: str) -> list[dict]:
    """Mask HIGH PII fields for viewer-role users."""
    if user_role in ("admin", "analyst"):
        return records

    high_pii_fields = {
        p.get("name") or p.get("canonical_name", "")
        for p in properties
        if p.get("pii_level") in ("HIGH", "PiiLevel.HIGH")
    }

    if not high_pii_fields:
        return records

    masked = []
    for record in records:
        masked_record = {}
        for key, value in record.items():
            if key in high_pii_fields:
                masked_record[key] = "***REDACTED***"
            else:
                masked_record[key] = value
        masked.append(masked_record)
    return masked


# ── Filter helpers ──────────────────────────────────────────────────────────

_FILTER_OPS = {
    "eq", "neq", "gt", "gte", "lt", "lte", "in", "contains",
    "is_null", "is_not_null",
}


def _build_jsonb_filters(filter_json: str) -> list:
    """
    Parse a JSON filter string and return a list of SQLAlchemy text() conditions.

    Supported forms:
      Simple:   {"status": "active"}                          → data->>'status' = 'active'
      Operator: {"age": {"$gt": 30}}                          → (data->>'age')::float > 30
      Multi:    {"status": "active", "score": {"$gte": 80}}   → AND of both
    """
    try:
        raw = json.loads(filter_json)
    except (json.JSONDecodeError, TypeError):
        return []

    if not isinstance(raw, dict):
        return []

    conditions = []
    bind_params: dict = {}

    for idx, (field, value) in enumerate(raw.items()):
        safe_field = field.replace("'", "''")  # prevent SQL injection in field name
        accessor = f"data->>'{safe_field}'"

        if isinstance(value, dict):
            # Operator form: {"field": {"$op": val}}
            for op_key, op_val in value.items():
                op = op_key.lstrip("$")
                if op not in _FILTER_OPS:
                    continue
                param = f"_fp{idx}"

                if op == "eq":
                    conditions.append(text(f"{accessor} = :{param}"))
                    bind_params[param] = str(op_val)
                elif op == "neq":
                    conditions.append(text(f"{accessor} != :{param}"))
                    bind_params[param] = str(op_val)
                elif op == "gt":
                    conditions.append(text(f"({accessor})::float > :{param}"))
                    bind_params[param] = float(op_val)
                elif op == "gte":
                    conditions.append(text(f"({accessor})::float >= :{param}"))
                    bind_params[param] = float(op_val)
                elif op == "lt":
                    conditions.append(text(f"({accessor})::float < :{param}"))
                    bind_params[param] = float(op_val)
                elif op == "lte":
                    conditions.append(text(f"({accessor})::float <= :{param}"))
                    bind_params[param] = float(op_val)
                elif op == "in":
                    # op_val should be a list
                    if isinstance(op_val, list):
                        placeholders = ", ".join(f":{param}_{i}" for i in range(len(op_val)))
                        conditions.append(text(f"{accessor} IN ({placeholders})"))
                        for i, v in enumerate(op_val):
                            bind_params[f"{param}_{i}"] = str(v)
                elif op == "contains":
                    conditions.append(text(f"{accessor} ILIKE :{param}"))
                    bind_params[param] = f"%{op_val}%"
                elif op == "is_null":
                    conditions.append(text(f"{accessor} IS NULL"))
                elif op == "is_not_null":
                    conditions.append(text(f"{accessor} IS NOT NULL"))
        else:
            # Simple equality: {"field": "value"}
            param = f"_fp{idx}"
            conditions.append(text(f"{accessor} = :{param}"))
            bind_params[param] = str(value)

    # Bind params to the text() clauses
    bound = []
    for cond in conditions:
        relevant = {k: v for k, v in bind_params.items() if f":{k}" in str(cond)}
        bound.append(cond.bindparams(**relevant) if relevant else cond)
    return bound


# ── GET records (with filter, sort, pagination) ────────────────────────────

@router.get("/{ot_id}/records")
async def list_records(
    ot_id: str,
    filter: Optional[str] = Query(None, description="JSON filter string"),
    sort_field: Optional[str] = Query(None, description="JSONB field to sort by"),
    sort_dir: Optional[str] = Query("asc", description="Sort direction: asc or desc"),
    limit: int = Query(50, ge=1, le=10000, description="Page size (max 10000)"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    tenant_id = x_tenant_id or "tenant-001"

    # Fetch the object type to get its properties for PII checks
    ot_result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == ot_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    ot_row = ot_result.scalar_one_or_none()
    properties: list[dict] = []
    if ot_row and ot_row.data:
        properties = ot_row.data.get("properties", [])

    # Base conditions
    base_where = [
        ObjectRecordRow.object_type_id == ot_id,
        ObjectRecordRow.tenant_id == tenant_id,
    ]

    # Apply JSONB filters
    if filter:
        jsonb_conditions = _build_jsonb_filters(filter)
        base_where.extend(jsonb_conditions)

    # Total count (before pagination)
    count_q = select(sa_func.count(ObjectRecordRow.id)).where(*base_where)
    total = (await db.execute(count_q)).scalar() or 0

    # Build main query
    query = select(ObjectRecordRow).where(*base_where)

    # Sorting
    if sort_field:
        safe_sort = sort_field.replace("'", "''")
        direction = "DESC" if sort_dir and sort_dir.lower() == "desc" else "ASC"
        query = query.order_by(text(f"data->>'{safe_sort}' {direction}"))
    else:
        query = query.order_by(ObjectRecordRow.updated_at.desc())

    # Pagination
    query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    rows = result.scalars().all()
    raw_records = [r.data for r in rows]
    masked_records = _mask_pii(raw_records, properties, user.role)
    return {
        "records": masked_records,
        "total": total,
        "limit": limit,
        "offset": offset,
        "synced_at": rows[0].updated_at.isoformat() if rows else None,
    }


# ── Aggregate (server-side rollup for dashboard widgets) ───────────────────

_FIELD_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
_AGG_METHODS = {"count", "sum", "avg", "min", "max", "count_distinct"}
_BUCKETS = {"hour", "day", "week", "month", "quarter", "year"}


def _safe_field(name: str) -> str:
    """Return name if it matches our identifier whitelist, else raise."""
    if not name or not _FIELD_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail=f"Invalid field name: {name!r}")
    return name


class AggregationSpec(BaseModel):
    field: Optional[str] = None
    method: str = "count"


class TimeBucketSpec(BaseModel):
    field: str
    interval: str = "day"


class AggregateRequest(BaseModel):
    filters: Optional[str] = None
    group_by: Optional[str] = None
    time_bucket: Optional[TimeBucketSpec] = None
    aggregations: list[AggregationSpec] = [AggregationSpec(method="count")]
    sort_by: Optional[str] = None
    sort_dir: str = "desc"
    limit: int = 200


def build_aggregate_sql(body: AggregateRequest, tenant_id: str, ot_id: str) -> tuple[str, dict[str, Any]]:
    """Pure SQL builder for /aggregate. Returns (sql_string, bind_params).
    Raises HTTPException on validation errors. Kept side-effect-free for testability.
    """
    if body.group_by and body.time_bucket:
        raise HTTPException(status_code=400, detail="Specify either group_by or time_bucket, not both.")

    if not body.aggregations:
        raise HTTPException(status_code=400, detail="At least one aggregation is required.")

    if body.time_bucket and body.time_bucket.interval not in _BUCKETS:
        raise HTTPException(status_code=400, detail=f"interval must be one of {sorted(_BUCKETS)}")

    for agg in body.aggregations:
        if agg.method not in _AGG_METHODS:
            raise HTTPException(status_code=400, detail=f"Unknown aggregation method: {agg.method}")
        if agg.method != "count" and not agg.field:
            raise HTTPException(status_code=400, detail=f"Aggregation '{agg.method}' requires a field")
        if agg.field:
            _safe_field(agg.field)

    select_parts: list[str] = []
    bind_params: dict[str, Any] = {"tid": tenant_id, "otid": ot_id}

    if body.group_by:
        gb = _safe_field(body.group_by)
        select_parts.append(f"data->>'{gb}' AS grp")
        group_clause: Optional[str] = f"data->>'{gb}'"
    elif body.time_bucket:
        tb_field = _safe_field(body.time_bucket.field)
        interval = body.time_bucket.interval
        select_parts.append(
            f"to_char(date_trunc('{interval}', NULLIF(data->>'{tb_field}', '')::timestamptz), 'YYYY-MM-DD\"T\"HH24:MI:SS') AS grp"
        )
        group_clause = f"date_trunc('{interval}', NULLIF(data->>'{tb_field}', '')::timestamptz)"
    else:
        select_parts.append("'_total' AS grp")
        group_clause = None

    for i, agg in enumerate(body.aggregations):
        alias = f"agg_{i}"
        if agg.method == "count":
            select_parts.append(f"COUNT(*) AS {alias}")
        elif agg.method == "count_distinct":
            f = _safe_field(agg.field)  # type: ignore[arg-type]
            select_parts.append(f"COUNT(DISTINCT data->>'{f}') AS {alias}")
        else:
            f = _safe_field(agg.field)  # type: ignore[arg-type]
            value_expr = f"NULLIF(data->>'{f}', '')::numeric"
            sql_fn = agg.method.upper()
            select_parts.append(f"{sql_fn}({value_expr}) AS {alias}")

    where_parts = ["tenant_id = :tid", "object_type_id = :otid"]
    if body.filters:
        try:
            parsed = json.loads(body.filters) if body.filters else {}
        except (json.JSONDecodeError, TypeError):
            parsed = {}
        if isinstance(parsed, dict):
            for idx, (field, value) in enumerate(parsed.items()):
                fkey = field.replace("'", "''")
                accessor = f"data->>'{fkey}'"
                if isinstance(value, dict):
                    for op_key, op_val in value.items():
                        op = op_key.lstrip("$")
                        pname = f"flt{idx}"
                        if op == "eq":
                            where_parts.append(f"{accessor} = :{pname}")
                            bind_params[pname] = str(op_val)
                        elif op == "neq":
                            where_parts.append(f"{accessor} != :{pname}")
                            bind_params[pname] = str(op_val)
                        elif op in ("gt", "gte", "lt", "lte"):
                            cmp = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
                            where_parts.append(f"({accessor})::numeric {cmp} :{pname}")
                            bind_params[pname] = float(op_val)
                        elif op == "contains":
                            where_parts.append(f"{accessor} ILIKE :{pname}")
                            bind_params[pname] = f"%{op_val}%"
                        elif op == "is_null":
                            where_parts.append(f"{accessor} IS NULL")
                        elif op == "is_not_null":
                            where_parts.append(f"{accessor} IS NOT NULL")
                        elif op == "in" and isinstance(op_val, list):
                            placeholders = []
                            for j, v in enumerate(op_val):
                                k = f"{pname}_{j}"
                                placeholders.append(f":{k}")
                                bind_params[k] = str(v)
                            where_parts.append(f"{accessor} IN ({', '.join(placeholders)})")
                else:
                    pname = f"flt{idx}"
                    where_parts.append(f"{accessor} = :{pname}")
                    bind_params[pname] = str(value)

    where_sql = " AND ".join(where_parts)

    order_sql = ""
    if body.sort_by:
        sb = body.sort_by
        direction = "DESC" if body.sort_dir.lower() == "desc" else "ASC"
        if sb == "group":
            order_sql = f"ORDER BY grp {direction}"
        elif re.match(r"^agg_\d+$", sb):
            agg_idx = int(sb.split("_")[1])
            if 0 <= agg_idx < len(body.aggregations):
                order_sql = f"ORDER BY {sb} {direction} NULLS LAST"
    elif group_clause:
        order_sql = "ORDER BY agg_0 DESC NULLS LAST"

    safe_limit = max(1, min(int(body.limit or 200), 5000))

    if group_clause:
        sql = (
            f"SELECT {', '.join(select_parts)} "
            f"FROM object_records "
            f"WHERE {where_sql} AND {group_clause} IS NOT NULL "
            f"GROUP BY grp "
            f"{order_sql} "
            f"LIMIT {safe_limit}"
        )
    else:
        sql = (
            f"SELECT {', '.join(select_parts)} "
            f"FROM object_records "
            f"WHERE {where_sql}"
        )

    return sql, bind_params


@router.post("/{ot_id}/aggregate")
async def aggregate_records(
    ot_id: str,
    body: AggregateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """
    Server-side aggregation over object records.

    Body:
      {
        "filters": "{\"status\": \"active\"}",      // optional, same syntax as GET /records
        "group_by": "department",                    // optional
        "time_bucket": {                             // optional, mutually exclusive with group_by
          "field": "created_at",
          "interval": "day"                          // hour | day | week | month | quarter | year
        },
        "aggregations": [
          {"method": "count"},
          {"field": "amount", "method": "sum"}
        ],
        "sort_by": "agg_0",                          // "agg_0".."agg_N" or "group"
        "sort_dir": "desc",
        "limit": 200
      }

    Response:
      {
        "rows": [
          {"group": "Sales", "agg_0": 1234, "agg_1": 56789.5},
          ...
        ],
        "total_groups": 12
      }
    """
    tenant_id = x_tenant_id or "tenant-001"

    sql, bind_params = build_aggregate_sql(body, tenant_id, ot_id)

    try:
        result = await db.execute(text(sql), bind_params)
        rows = result.mappings().all()
    except Exception as exc:
        logger.warning("aggregate failed for ot=%s tenant=%s: %s", ot_id, tenant_id, exc)
        raise HTTPException(status_code=400, detail=f"Aggregation failed: {exc}")

    serialized = []
    for r in rows:
        d: dict[str, Any] = {"group": r.get("grp")}
        for i in range(len(body.aggregations)):
            v = r.get(f"agg_{i}")
            d[f"agg_{i}"] = float(v) if v is not None else None
        serialized.append(d)

    return {"rows": serialized, "total_groups": len(serialized)}


# ── Indexes (on-demand JSONB expression indexes for hot fields) ────────────


class IndexRequest(BaseModel):
    fields: list[str]


@router.post("/{ot_id}/indexes")
async def create_indexes(
    ot_id: str,
    body: IndexRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """
    Create CONCURRENT JSONB expression indexes on `data->>'<field>'` for the records table.

    These indexes accelerate filters and group-by aggregations on the named fields.
    The index is global (across tenants/object types) since the JSONB column is shared,
    which is fine — Postgres uses the same expression index whatever the tenant.

    Use this for hot fields: `status`, `amount`, `created_at`, `category`, etc.
    """
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Admin role required to create indexes.")

    if not body.fields:
        raise HTTPException(status_code=400, detail="No fields specified")

    safe_fields = []
    for f in body.fields:
        try:
            safe_fields.append(_safe_field(f))
        except HTTPException:
            continue

    if not safe_fields:
        raise HTTPException(status_code=400, detail="No valid field names")

    # CREATE INDEX CONCURRENTLY can't run inside a transaction.
    # Use a dedicated autocommit connection.
    engine = db.get_bind()
    created = []
    failed: dict[str, str] = {}

    async with engine.connect() as conn:
        await conn.execution_options(isolation_level="AUTOCOMMIT")
        for f in safe_fields:
            idx_name = f"idx_or_data_{f.lower()}"[:63]
            sql = f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {idx_name} ON object_records ((data->>'{f}'))"
            try:
                await conn.execute(text(sql))
                created.append({"field": f, "index": idx_name})
            except Exception as exc:
                failed[f] = str(exc)

    return {"created": created, "failed": failed}


# ── GET single record ──────────────────────────────────────────────────────

@router.get("/{ot_id}/records/{record_id}")
async def get_record(
    ot_id: str,
    record_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """Fetch a single record by its source_id."""
    tenant_id = x_tenant_id or "tenant-001"

    # Fetch object type for PII masking
    ot_result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == ot_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    ot_row = ot_result.scalar_one_or_none()
    properties: list[dict] = []
    if ot_row and ot_row.data:
        properties = ot_row.data.get("properties", [])

    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == record_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")

    masked = _mask_pii([row.data], properties, user.role)
    return {
        "record": masked[0],
        "source_id": row.source_id,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── GET link traversal ─────────────────────────────────────────────────────

@router.get("/{ot_id}/records/{record_id}/links/{link_id}")
async def traverse_link(
    ot_id: str,
    record_id: str,
    link_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """
    Traverse an ontology link from a source record to its linked target records.
    Uses the link's join_keys to match the source record's field value against
    the target records' corresponding field.
    """
    tenant_id = x_tenant_id or "tenant-001"

    # 1. Fetch the source record
    src_result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == record_id,
        )
    )
    src_row = src_result.scalar_one_or_none()
    if not src_row:
        raise HTTPException(status_code=404, detail="Source record not found")

    # 2. Fetch the link definition
    link_result = await db.execute(
        select(OntologyLinkRow).where(
            OntologyLinkRow.id == link_id,
            OntologyLinkRow.tenant_id == tenant_id,
        )
    )
    link_row = link_result.scalar_one_or_none()
    if not link_row:
        raise HTTPException(status_code=404, detail="Link not found")

    link_data = link_row.data or {}
    target_type_id = link_row.target_object_type_id
    join_keys: list[dict] = link_data.get("join_keys", [])

    if not join_keys:
        raise HTTPException(status_code=400, detail="Link has no join_keys configured")

    # Use the first join_key pair
    source_field = join_keys[0].get("source_field", "")
    target_field = join_keys[0].get("target_field", "")

    if not source_field or not target_field:
        raise HTTPException(status_code=400, detail="Link join_keys missing source_field or target_field")

    # 3. Get the join value from the source record
    join_value = src_row.data.get(source_field)
    if join_value is None:
        return {"records": [], "total": 0, "limit": limit, "offset": offset}

    # 4. Query target records where data->>target_field matches the join value
    safe_target_field = target_field.replace("'", "''")
    match_condition = text(f"data->>'{safe_target_field}' = :join_val").bindparams(
        join_val=str(join_value)
    )

    base_where = [
        ObjectRecordRow.object_type_id == target_type_id,
        ObjectRecordRow.tenant_id == tenant_id,
        match_condition,
    ]

    count_q = select(sa_func.count(ObjectRecordRow.id)).where(*base_where)
    total = (await db.execute(count_q)).scalar() or 0

    query = (
        select(ObjectRecordRow)
        .where(*base_where)
        .order_by(ObjectRecordRow.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(query)
    rows = result.scalars().all()

    # PII masking for target type
    ot_result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == target_type_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    target_ot = ot_result.scalar_one_or_none()
    target_props: list[dict] = []
    if target_ot and target_ot.data:
        target_props = target_ot.data.get("properties", [])

    raw_records = [r.data for r in rows]
    masked_records = _mask_pii(raw_records, target_props, user.role)

    return {
        "records": masked_records,
        "total": total,
        "limit": limit,
        "offset": offset,
        "source_field": source_field,
        "target_field": target_field,
        "target_type_id": target_type_id,
    }


# ── PATCH update record ────────────────────────────────────────────────────

@router.patch("/{ot_id}/records/{record_id}")
async def update_record(
    ot_id: str,
    record_id: str,
    payload: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """Merge new properties into an existing record's data."""
    tenant_id = x_tenant_id or "tenant-001"

    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == record_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")

    merged_data = dict(row.data)
    merged_data.update(payload)
    row.data = merged_data
    flag_modified(row, "data")
    row.updated_at = datetime.now(timezone.utc)

    await db.commit()
    return {
        "record": row.data,
        "source_id": row.source_id,
        "updated_at": row.updated_at.isoformat(),
    }


# ── DELETE record ───────────────────────────────────────────────────────────

@router.delete("/{ot_id}/records/{record_id}")
async def delete_record(
    ot_id: str,
    record_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """Delete a record by its source_id."""
    tenant_id = x_tenant_id or "tenant-001"

    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == record_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Record not found")

    await db.delete(row)
    await db.commit()
    return {"deleted": True, "source_id": record_id}


# ── POST sync ───────────────────────────────────────────────────────────────

@router.post("/{ot_id}/records/sync")
async def sync_records(
    ot_id: str,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Pull data from all source connectors for this ObjectType, join nested arrays
    by matching on company/entity name, and upsert merged records into the DB.
    """
    tenant_id = x_tenant_id or "tenant-001"

    result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == ot_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    ot_row = result.scalar_one_or_none()
    if not ot_row:
        raise HTTPException(status_code=404, detail="Object type not found")

    ot_data = ot_row.data

    # Pipeline-backed objects must be synced by running the pipeline, not by pulling connectors directly
    source_pipeline_id = ot_data.get("source_pipeline_id")
    if source_pipeline_id:
        raise HTTPException(
            status_code=409,
            detail=f"This object type is backed by pipeline '{source_pipeline_id}'. Run the pipeline to sync records — direct connector sync is disabled.",
        )

    # Data is stored as snake_case by Pydantic serialization
    source_connector_ids: list[str] = ot_data.get("source_connector_ids", [])
    properties: list[dict] = ot_data.get("properties", [])

    # Map connector_id -> prop_name for array/nested properties (e.g. meetings)
    # These connectors may or may not be in source_connector_ids — include them regardless
    array_connector_map: dict[str, str] = {}
    for prop in properties:
        if prop.get("data_type") == "array" or prop.get("name", "").endswith("[]"):
            cid = prop.get("source_connector_id")
            if cid:
                raw_name = prop.get("name", "nested").rstrip("[]")
                array_connector_map[cid] = raw_name

    # All connectors = source connectors + any array-property connectors not already listed
    all_connector_ids = list(dict.fromkeys(source_connector_ids + list(array_connector_map.keys())))

    if not all_connector_ids:
        raise HTTPException(status_code=400, detail="No source connectors configured on this object type")

    primary_connector_ids = [c for c in all_connector_ids if c not in array_connector_map]

    async with httpx.AsyncClient(timeout=60) as client:
        # Fetch flat records from primary connectors
        primary_records: list[dict] = []
        for cid in primary_connector_ids:
            try:
                r = await client.get(f"{CONNECTOR_API}/connectors/{cid}/schema",
                                     headers={"x-tenant-id": tenant_id})
                if r.is_success:
                    primary_records.extend(r.json().get("sample_rows", []))
            except Exception:
                pass

        # Fetch nested records from array connectors
        nested_by_connector: dict[str, list[dict]] = {}
        for cid in array_connector_map:
            try:
                r = await client.get(f"{CONNECTOR_API}/connectors/{cid}/schema",
                                     headers={"x-tenant-id": tenant_id})
                nested_by_connector[cid] = r.json().get("sample_rows", []) if r.is_success else []
            except Exception:
                nested_by_connector[cid] = []

    if not primary_records:
        return {"synced": 0, "message": "No records fetched from primary connectors"}

    # Build merged records
    merged: list[dict] = []
    for rec in primary_records:
        record = dict(rec)

        # Determine this record's display name for matching (try common name fields)
        name_val = _extract_name(record)

        for cid, prop_name in array_connector_map.items():
            nested = nested_by_connector.get(cid, [])
            matched = _match_nested(nested, name_val) if name_val else []
            # Store as "meetings[]" key so the DB viewer renders it as nested
            record[f"{prop_name}[]"] = matched

        merged.append(record)

    # Upsert into object_records
    pk_field = _guess_pk(merged[0]) if merged else "id"
    upserted = 0
    for record in merged:
        source_id = str(record.get(pk_field) or uuid4())

        existing = await db.execute(
            select(ObjectRecordRow).where(
                ObjectRecordRow.object_type_id == ot_id,
                ObjectRecordRow.tenant_id == tenant_id,
                ObjectRecordRow.source_id == source_id,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.data = record
            row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(ObjectRecordRow(
                id=str(uuid4()),
                object_type_id=ot_id,
                tenant_id=tenant_id,
                source_id=source_id,
                data=record,
            ))
        upserted += 1

    await db.commit()
    return {
        "synced": upserted,
        "primary_records": len(primary_records),
        "nested_connectors": len(array_connector_map),
        "message": f"Upserted {upserted} records",
    }


# ── POST ingest (pipeline push) ─────────────────────────────────────────────

@router.post("/{ot_id}/records/ingest")
async def ingest_records(
    ot_id: str,
    payload: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Directly upsert records produced by a pipeline into this object type.
    Called by the DAG executor's SINK_OBJECT node — the pipeline owns the data,
    not the connector. Records are stamped with _pipeline_id and _pipeline_run_at.
    """
    tenant_id = x_tenant_id or "tenant-001"
    records: list[dict] = payload.get("records", [])
    pk_field: str = payload.get("pk_field", "id")
    pipeline_id: str = payload.get("pipeline_id", "")
    field_mappings: dict[str, str] = payload.get("field_mappings", {})

    if not records:
        return {"ingested": 0, "message": "No records provided"}

    result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == ot_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    ot_row = result.scalar_one_or_none()
    if not ot_row:
        raise HTTPException(status_code=404, detail="Object type not found")

    # Apply field_mappings: rename keys before storing
    if field_mappings:
        records = [_apply_field_mappings(r, field_mappings) for r in records]

    if not records[0].get(pk_field):
        pk_field = _guess_pk(records[0])

    run_at = datetime.now(timezone.utc).isoformat()
    ingested = 0
    new_source_ids: list[str] = []

    for record in records:
        record = dict(record)
        record["_pipeline_id"] = pipeline_id
        record["_pipeline_run_at"] = run_at

        source_id = str(record.get(pk_field) or uuid4())

        existing = await db.execute(
            select(ObjectRecordRow).where(
                ObjectRecordRow.object_type_id == ot_id,
                ObjectRecordRow.tenant_id == tenant_id,
                ObjectRecordRow.source_id == source_id,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.data = record
            row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(ObjectRecordRow(
                id=str(uuid4()),
                object_type_id=ot_id,
                tenant_id=tenant_id,
                source_id=source_id,
                data=record,
            ))
            new_source_ids.append(source_id)
        ingested += 1

    await db.commit()
    return {
        "ingested": ingested,
        "new_count": len(new_source_ids),
        "new_source_ids": new_source_ids,
        "pipeline_id": pipeline_id,
        "message": f"Ingested {ingested} records from pipeline {pipeline_id} ({len(new_source_ids)} new)",
    }


# ── POST array-append ───────────────────────────────────────────────────────

@router.post("/{ot_id}/records/array-append")
async def array_append_records(
    ot_id: str,
    payload: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Append incoming records to an array field on matching target records.

    Payload:
      array_field  – name of the array property on the target object (e.g. "meetings")
      merge_key    – field on the target record used for matching (e.g. "deal_name")
      join_key     – field on incoming records that holds the match value (default "__join_key__")
      records      – list of incoming records (each must have join_key set)
    """
    tenant_id = x_tenant_id or "tenant-001"
    array_field: str = payload.get("array_field", "")
    merge_key: str = payload.get("merge_key", "")
    join_key: str = payload.get("join_key", "__join_key__")
    incoming: list[dict] = payload.get("records", [])

    if not array_field or not merge_key or not incoming:
        raise HTTPException(status_code=400, detail="array_field, merge_key, and records are required")

    # Load all existing records for this object type
    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
        )
    )
    rows = result.scalars().all()

    if not rows:
        return {"appended": 0, "message": "No target records found"}

    # Build a map: normalized merge_key value → row
    def _norm(val: str) -> str:
        return str(val).strip().lower()

    target_map: dict[str, ObjectRecordRow] = {}
    for row in rows:
        mk_val = row.data.get(merge_key) or row.data.get(merge_key.replace("_", "")) or ""
        if mk_val:
            target_map[_norm(mk_val)] = row

    array_key = f"{array_field}[]"
    appended = 0

    for rec in incoming:
        jk_val = rec.get(join_key, "")
        if not jk_val:
            continue
        jk_norm = _norm(jk_val)

        # Exact match first
        matched_row = target_map.get(jk_norm)

        # Partial/fuzzy match: substring or word overlap
        if not matched_row:
            for key, row in target_map.items():
                if jk_norm in key or key in jk_norm:
                    matched_row = row
                    break

        # Word-level match: any significant word (≥4 chars) from join_key appears in target key
        if not matched_row:
            jk_words = [w for w in jk_norm.split() if len(w) >= 4]
            for key, row in target_map.items():
                if any(w in key for w in jk_words):
                    matched_row = row
                    break

        if not matched_row:
            continue

        current_data = dict(matched_row.data)
        current_array: list = current_data.get(array_key, [])
        if not isinstance(current_array, list):
            current_array = []

        # Avoid duplicates: skip if a record with same id already in array
        rec_id = rec.get("id") or rec.get("uuid") or rec.get("meeting_id")
        if rec_id and any(r.get("id") == rec_id or r.get("uuid") == rec_id for r in current_array):
            continue

        current_array.append(rec)
        current_data[array_key] = current_array
        matched_row.data = current_data
        flag_modified(matched_row, "data")
        matched_row.updated_at = datetime.now(timezone.utc)
        appended += 1

    await db.commit()
    return {
        "appended": appended,
        "total_incoming": len(incoming),
        "target_records": len(rows),
        "message": f"Appended {appended} records to {array_field}[] on matching targets",
    }


# ── Helpers ─────────────────────────────────────────────────────────────────

def _apply_field_mappings(record: dict, mappings: dict[str, str]) -> dict:
    """Rename fields in a record according to a mapping dict.
    mappings: {"original_field_name": "new_field_name", ...}
    """
    mapped = {}
    for key, value in record.items():
        new_key = mappings.get(key, key)
        mapped[new_key] = value
    return mapped


def _extract_name(record: dict) -> str:
    """Extract a normalized entity name from a record for join matching."""
    raw = (
        record.get("name") or
        record.get("company_name") or
        record.get("company") or
        (str(record.get("firstname", "")) + " " + str(record.get("lastname", ""))).strip() or
        record.get("title") or
        ""
    )
    return str(raw).strip().lower()


def _match_nested(nested_records: list[dict], entity_name: str) -> list[dict]:
    """
    Match nested records (e.g. Fireflies transcripts) against an entity name.
    A transcript matches if the entity name appears in its title, participants,
    organizer_email, or overview text.
    """
    if not entity_name or len(entity_name) < 3:
        return []

    # Split into words for multi-word company names (match any significant word)
    words = [w for w in entity_name.split() if len(w) >= 4]
    if not words:
        words = [entity_name]

    matches = []
    for rec in nested_records:
        searchable = " ".join([
            str(rec.get("title", "")),
            str(rec.get("organizer_email", "")),
            " ".join(str(p) for p in (rec.get("participants") or [])),
            str(rec.get("overview", "")),
            str(rec.get("keywords", "")),
        ]).lower()

        # Match if the full name or any significant word matches
        if entity_name in searchable or any(w in searchable for w in words):
            matches.append(rec)

    return matches


def _guess_pk(record: dict) -> str:
    """Guess the primary key field from a record."""
    for candidate in ["hs_object_id", "id", "record_id", "uuid"]:
        if record.get(candidate):
            return candidate
    return next(iter(record), "id")
