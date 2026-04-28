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
import time
import httpx
from typing import Any, AsyncGenerator, Optional
from uuid import uuid4
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, delete, func as sa_func, text
from sqlalchemy.orm.attributes import flag_modified
from database import get_session, ObjectTypeRow, ObjectRecordRow, OntologyLinkRow
from shared.auth_middleware import require_auth, AuthUser
from shared import query_cache, index_advisor, rollup_promoter

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
_AGG_METHODS = {"count", "sum", "avg", "min", "max", "count_distinct", "runtime"}

# Coarse buckets handled by Postgres date_trunc.
_TRUNC_BUCKETS = {"hour", "day", "week", "month", "quarter", "year"}

# Fine-grained buckets handled by Postgres date_bin (PG 14+). The values are
# the SQL interval strings.
_BIN_BUCKETS = {
    "second":      "1 second",
    "5_seconds":   "5 seconds",
    "15_seconds":  "15 seconds",
    "30_seconds":  "30 seconds",
    "minute":      "1 minute",
    "5_minutes":   "5 minutes",
    "15_minutes":  "15 minutes",
    "30_minutes":  "30 minutes",
}

_BUCKETS = _TRUNC_BUCKETS | set(_BIN_BUCKETS.keys())


def _safe_field(name: str) -> str:
    """Return name if it matches our identifier whitelist, else raise."""
    if not name or not _FIELD_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail=f"Invalid field name: {name!r}")
    return name


class AggregationSpec(BaseModel):
    field: Optional[str] = None
    method: str = "count"
    ts_field: Optional[str] = None  # timestamp field (required for runtime)


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
    # IANA timezone (e.g. "America/El_Salvador"). When set, calendar
    # buckets (date_trunc) align to midnight in this zone instead of UTC,
    # so a "day" bucket actually means a local-day for the user.
    timezone: Optional[str] = None


# IANA TZ names use [A-Za-z0-9_+/-]. Anything else is rejected, since the
# value is interpolated into the SQL string (not a bind param — Postgres
# AT TIME ZONE wants an immediate string literal in some contexts and the
# safest path is strict validation).
import re as _tz_re
_TZ_NAME_RE = _tz_re.compile(r"^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$")


def _safe_timezone(tz: Optional[str]) -> Optional[str]:
    if not tz:
        return None
    if not _TZ_NAME_RE.match(tz):
        raise HTTPException(status_code=400, detail=f"Invalid timezone name: {tz!r}")
    return tz


def build_aggregate_sql(body: AggregateRequest, tenant_id: str, ot_id: str) -> tuple[str, dict[str, Any]]:
    """Pure SQL builder for /aggregate. Returns (sql_string, bind_params).
    Raises HTTPException on validation errors. Kept side-effect-free for testability.
    """
    if not body.aggregations:
        raise HTTPException(status_code=400, detail="At least one aggregation is required.")

    if body.time_bucket and body.time_bucket.interval not in _BUCKETS:
        raise HTTPException(status_code=400, detail=f"interval must be one of {sorted(_BUCKETS)}")

    has_runtime = False
    for agg in body.aggregations:
        if agg.method not in _AGG_METHODS:
            raise HTTPException(status_code=400, detail=f"Unknown aggregation method: {agg.method}")
        if agg.method != "count" and not agg.field:
            raise HTTPException(status_code=400, detail=f"Aggregation '{agg.method}' requires a field")
        if agg.field:
            _safe_field(agg.field)
        if agg.method == "runtime":
            has_runtime = True
            if not agg.ts_field:
                raise HTTPException(status_code=400, detail="runtime aggregation requires ts_field")
            _safe_field(agg.ts_field)

    select_parts: list[str] = []
    bind_params: dict[str, Any] = {"tid": tenant_id, "otid": ot_id}

    # ── Grouping dimensions ─────────────────────────────────────────────────
    # Three modes:
    #   (1) group_by alone           — categorical breakdown (bar/pie)
    #   (2) time_bucket alone         — single time series (line/area)
    #   (3) BOTH                      — multi-series time series, e.g. one
    #                                   line per `metric_type` over time.
    #                                   Response includes a `series` field.
    group_clause: Optional[str] = None
    series_clause: Optional[str] = None
    has_time = bool(body.time_bucket)
    has_group = bool(body.group_by)

    if has_time:
        tb_field = _safe_field(body.time_bucket.field)
        interval = body.time_bucket.interval
        tz_name = _safe_timezone(body.timezone)
        # Coarse (date_trunc) vs. fine (date_bin) bucketing. date_trunc handles
        # natural calendar boundaries; date_bin handles arbitrary intervals
        # (e.g. every 5 minutes, every 15 seconds) anchored to a fixed origin.
        # Regex-guarded timestamptz cast. Returns NULL for any row whose
        # `tb_field` doesn't start with YYYY-MM-DD so a single legacy /
        # malformed row can't blow up the whole aggregate. Postgres'
        # `::timestamptz` is liberal with the trailing format (T or space,
        # with/without offset, with/without ms) — we just gate the cast
        # on the leading shape.
        ts_safe = (
            f"(CASE WHEN data->>'{tb_field}' ~ "
            f"'^[[:digit:]]{{4}}-[[:digit:]]{{2}}-[[:digit:]]{{2}}' "
            f"THEN NULLIF(data->>'{tb_field}', '')::timestamptz "
            f"ELSE NULL END)"
        )
        if interval in _BIN_BUCKETS:
            bin_str = _BIN_BUCKETS[interval]
            # Sub-hour buckets are time-anchored, so the user's TZ doesn't
            # change the boundaries. Leave them alone.
            bucket_expr = (
                f"date_bin(INTERVAL '{bin_str}', "
                f"{ts_safe}, "
                f"TIMESTAMPTZ '2000-01-01')"
            )
        else:
            # Coarse calendar bucket. When a timezone is supplied, bucket
            # at midnight of THAT zone, not UTC — otherwise "day" lumps
            # 6pm CST into the next UTC day, which surprises users.
            # Round-trip: timestamptz → naive (in tz) → date_trunc → back
            # to timestamptz so the response is still a UTC moment.
            if tz_name:
                bucket_expr = (
                    f"(date_trunc('{interval}', "
                    f"{ts_safe} AT TIME ZONE '{tz_name}') "
                    f"AT TIME ZONE '{tz_name}')"
                )
            else:
                bucket_expr = f"date_trunc('{interval}', {ts_safe})"
        select_parts.append(
            f"to_char({bucket_expr}, 'YYYY-MM-DD\"T\"HH24:MI:SS') AS grp"
        )
        group_clause = bucket_expr

    if has_group:
        gb = _safe_field(body.group_by)
        if has_time:
            # Multi-series: time bucket is `grp`, group_by becomes `series`
            select_parts.append(f"data->>'{gb}' AS series")
            series_clause = f"data->>'{gb}'"
        else:
            select_parts.append(f"data->>'{gb}' AS grp")
            group_clause = f"data->>'{gb}'"

    if not has_time and not has_group:
        select_parts.append("'_total' AS grp")

    # runtime_cte_parts collects CTE column definitions when runtime agg is used.
    runtime_cte_parts: list[tuple[int, str, str]] = []  # (index, status_expr, ts_safe)

    for i, agg in enumerate(body.aggregations):
        alias = f"agg_{i}"
        if agg.method == "runtime":
            f = _safe_field(agg.field)  # type: ignore[arg-type]
            ts_f = _safe_field(agg.ts_field)  # type: ignore[arg-type]
            status_expr = (
                f"CASE WHEN data->>'{f}' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' "
                f"THEN (data->>'{f}')::numeric ELSE 0 END"
            )
            ts_safe = (
                f"(CASE WHEN data->>'{ts_f}' ~ "
                f"'^[[:digit:]]{{4}}-[[:digit:]]{{2}}-[[:digit:]]{{2}}' "
                f"THEN NULLIF(data->>'{ts_f}', '')::timestamptz "
                f"ELSE NULL END)"
            )
            runtime_cte_parts.append((i, status_expr, ts_safe))
            # Placeholder — replaced by CTE-based query below
            select_parts.append(
                f"COALESCE(SUM(CASE WHEN _rt_status_{i} >= 1 "
                f"THEN _rt_delta_{i} ELSE 0 END), 0) AS {alias}"
            )
        elif agg.method == "count":
            select_parts.append(f"COUNT(*) AS {alias}")
        elif agg.method == "count_distinct":
            f = _safe_field(agg.field)  # type: ignore[arg-type]
            select_parts.append(f"COUNT(DISTINCT data->>'{f}') AS {alias}")
        else:
            f = _safe_field(agg.field)  # type: ignore[arg-type]
            # Safe numeric cast: only attempt the cast on rows whose value
            # actually looks like a number. JSONB columns frequently mix
            # types within one column (e.g. {value: "1500"} for an RPM event
            # and {value: "true"} for a running-flag event) and a blanket
            # ::numeric cast blows up the entire query on the first non-
            # numeric row. The CASE … WHEN … ELSE NULL pattern produces NULL
            # for non-numeric rows, which SUM/AVG/MAX/MIN naturally ignore.
            # POSIX bracket notation [[:digit:]] and [.] (a 1-char class with
            # a literal dot) avoids backslash escaping pitfalls between
            # Python f-strings, SQLAlchemy text(), and the asyncpg driver.
            value_expr = (
                f"CASE WHEN data->>'{f}' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' "
                f"THEN (data->>'{f}')::numeric ELSE NULL END"
            )
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
                            val_str = str(op_val) if op_val is not None else ""
                            # Three flavors of comparison depending on the
                            # value's shape — picked at filter-build time:
                            #
                            #   ISO date string ("2026-04-25T...")  → timestamptz
                            #     compare. Hits the xAxisRange presets and
                            #     `after`/`before` filters that the frontend
                            #     encodes as $gte/$lte.
                            #
                            #   Numeric                              → regex-
                            #     guarded numeric cast (existing path).
                            #
                            #   Anything else                        → string
                            #     compare (lexicographic).
                            is_iso_date = (
                                isinstance(op_val, str)
                                and len(val_str) >= 10
                                and val_str[4:5] == "-"
                                and val_str[7:8] == "-"
                            )
                            if is_iso_date:
                                # Regex-guard the column cast so a single
                                # malformed row (e.g. legacy data with `time`
                                # set to a non-ISO string) doesn't blow up
                                # the whole query.
                                #
                                # Bind the value as a real Python datetime —
                                # asyncpg reads the SQL type hint
                                # `($3)::timestamptz` as "param is
                                # timestamptz" and rejects str inputs at the
                                # client layer. Parse to datetime here so it
                                # round-trips correctly.
                                try:
                                    iso_normal = val_str.replace("Z", "+00:00")
                                    dt_val = datetime.fromisoformat(iso_normal)
                                except ValueError:
                                    # Couldn't parse — fall back to a
                                    # text-cast SQL form that lets PG do the
                                    # parsing (less efficient but still
                                    # correct). Avoids the asyncpg type hint.
                                    where_parts.append(
                                        f"{accessor} ~ '^[[:digit:]]{{4}}-[[:digit:]]{{2}}-[[:digit:]]{{2}}' "
                                        f"AND NULLIF({accessor}, '')::timestamptz {cmp} "
                                        f"(:{pname}::text)::timestamptz"
                                    )
                                    bind_params[pname] = val_str
                                else:
                                    where_parts.append(
                                        f"{accessor} ~ '^[[:digit:]]{{4}}-[[:digit:]]{{2}}-[[:digit:]]{{2}}' "
                                        f"AND NULLIF({accessor}, '')::timestamptz {cmp} :{pname}"
                                    )
                                    bind_params[pname] = dt_val
                            else:
                                try:
                                    numeric_val = float(op_val)
                                    where_parts.append(
                                        f"{accessor} ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' "
                                        f"AND ({accessor})::numeric {cmp} :{pname}"
                                    )
                                    bind_params[pname] = numeric_val
                                except (TypeError, ValueError):
                                    where_parts.append(f"{accessor} {cmp} :{pname}")
                                    bind_params[pname] = val_str
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
                        elif op == "not_in" and isinstance(op_val, list):
                            placeholders = []
                            for j, v in enumerate(op_val):
                                k = f"{pname}_{j}"
                                placeholders.append(f":{k}")
                                bind_params[k] = str(v)
                            where_parts.append(f"({accessor} NOT IN ({', '.join(placeholders)}) OR {accessor} IS NULL)")
                else:
                    pname = f"flt{idx}"
                    where_parts.append(f"{accessor} = :{pname}")
                    bind_params[pname] = str(value)

    where_sql = " AND ".join(where_parts)

    # Append non-null guards on the dimension columns so we don't get a giant
    # NULL bucket from records where the field is absent.
    if group_clause:
        where_sql += f" AND {group_clause} IS NOT NULL"
    if series_clause:
        where_sql += f" AND {series_clause} IS NOT NULL"

    order_sql = ""
    if body.sort_by:
        sb = body.sort_by
        direction = "DESC" if body.sort_dir.lower() == "desc" else "ASC"
        if sb == "group":
            order_sql = f"ORDER BY grp {direction}"
        elif sb == "series":
            order_sql = f"ORDER BY series {direction}"
        elif re.match(r"^agg_\d+$", sb):
            agg_idx = int(sb.split("_")[1])
            if 0 <= agg_idx < len(body.aggregations):
                order_sql = f"ORDER BY {sb} {direction} NULLS LAST"
    elif series_clause and group_clause:
        # Multi-series time series: keep both axes ordered for clean rendering
        order_sql = "ORDER BY grp ASC, series ASC"
    elif group_clause:
        order_sql = "ORDER BY agg_0 DESC NULLS LAST"

    safe_limit = max(1, min(int(body.limit or 200), 5000))

    group_by_cols: list[str] = []
    if group_clause:
        group_by_cols.append("grp")
    if series_clause:
        group_by_cols.append("series")

    # ── Build final SQL, wrapping in a CTE when runtime agg is present ─────
    if runtime_cte_parts:
        # Build CTE that adds per-row LEAD-based time deltas and status cols.
        # The partition for LEAD uses the group_by field so deltas stay within
        # each group (e.g. per sensor).
        partition_expr = group_clause or "'_all'"
        cte_extra_cols = []
        for idx, status_expr, ts_safe in runtime_cte_parts:
            cte_extra_cols.append(f"{status_expr} AS _rt_status_{idx}")
            cte_extra_cols.append(
                f"EXTRACT(EPOCH FROM ("
                f"LEAD({ts_safe}) OVER (PARTITION BY {partition_expr} ORDER BY {ts_safe}) "
                f"- {ts_safe})) AS _rt_delta_{idx}"
            )
        cte_cols_sql = ", ".join(cte_extra_cols)

        if group_by_cols:
            sql = (
                f"WITH _rt AS ("
                f"SELECT *, {cte_cols_sql} "
                f"FROM object_records "
                f"WHERE {where_sql}"
                f") "
                f"SELECT {', '.join(select_parts)} "
                f"FROM _rt "
                f"GROUP BY {', '.join(group_by_cols)} "
                f"{order_sql} "
                f"LIMIT {safe_limit}"
            )
        else:
            sql = (
                f"WITH _rt AS ("
                f"SELECT *, {cte_cols_sql} "
                f"FROM object_records "
                f"WHERE {where_sql}"
                f") "
                f"SELECT {', '.join(select_parts)} "
                f"FROM _rt"
            )
    elif group_by_cols:
        sql = (
            f"SELECT {', '.join(select_parts)} "
            f"FROM object_records "
            f"WHERE {where_sql} "
            f"GROUP BY {', '.join(group_by_cols)} "
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

    # ── Cache + rollup promotion ───────────────────────────────────────────
    # Canonicalize the request so {a:1, b:2} and {b:2, a:1} hash the same.
    cache_payload = {
        "filters": body.filters or "",
        "group_by": body.group_by or "",
        "time_bucket": body.time_bucket.model_dump() if body.time_bucket else None,
        "aggregations": [a.model_dump() for a in body.aggregations],
        "sort_by": body.sort_by or "",
        "sort_dir": body.sort_dir or "desc",
        "limit": body.limit,
    }
    query_hash = query_cache.canonical_query_hash(cache_payload)
    cache_key = query_cache.aggregate_cache_key(tenant_id, ot_id, query_hash)
    index_key = query_cache.aggregate_index_key(tenant_id, ot_id)

    async def _execute() -> dict:
        t0 = time.perf_counter()
        try:
            result = await db.execute(text(sql), bind_params)
            rows = result.mappings().all()
        except Exception as exc:
            logger.warning("aggregate failed for ot=%s tenant=%s: %s", ot_id, tenant_id, exc)
            raise HTTPException(status_code=400, detail=f"Aggregation failed: {exc}")
        elapsed_ms = (time.perf_counter() - t0) * 1000.0

        serialized = []
        for r in rows:
            d: dict[str, Any] = {"group": r.get("grp")}
            if r.get("series") is not None:
                d["series"] = r.get("series")
            for i in range(len(body.aggregations)):
                v = r.get(f"agg_{i}")
                d[f"agg_{i}"] = float(v) if v is not None else None
            serialized.append(d)

        # Auto-index hot fields after a slow query.
        candidate_fields = []
        if body.group_by:
            candidate_fields.append(body.group_by)
        if body.time_bucket:
            candidate_fields.append(body.time_bucket.field)
        try:
            await index_advisor.maybe_create_indexes_for(
                engine=db.get_bind(),
                fields=candidate_fields,
                elapsed_ms=elapsed_ms,
            )
        except Exception as exc:
            logger.debug("index advisor swallowed: %s", exc)

        return {"rows": serialized, "total_groups": len(serialized), "elapsed_ms": elapsed_ms}

    payload, from_cache = await query_cache.get_or_compute(
        cache_key,
        _execute,
        ttl_seconds=query_cache.DEFAULT_TTL_SECONDS,
        index_key=index_key,
    )

    # Track hits for promotion to long-TTL cache + background refresh.
    try:
        await rollup_promoter.maybe_promote(cache_key, recompute=_execute, index_key=index_key)
    except Exception as exc:
        logger.debug("rollup promoter swallowed: %s", exc)

    payload["from_cache"] = from_cache
    payload["promoted"] = rollup_promoter.is_promoted(cache_key)
    return payload


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


# ── Stream (NDJSON, no offset, server-side cursor) ─────────────────────────


@router.get("/{ot_id}/stream")
async def stream_records(
    ot_id: str,
    filter: Optional[str] = Query(None, description="JSON filter string, same syntax as /records"),
    chunk_size: int = Query(1000, ge=100, le=10000),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """
    Stream every matching record as NDJSON (one JSON object per line).

    Use this for exports, ML feature extraction, or anything that legitimately
    needs every row. Unlike GET /records, this does NOT use OFFSET — it walks
    a server-side keyset cursor on (id) so memory and time are O(rows) not O(rows²).

    Response: `application/x-ndjson` — pipe to a file:
        curl -H 'x-tenant-id: t' /object-types/X/stream > export.ndjson
    """
    tenant_id = x_tenant_id or "tenant-001"

    base_where = [
        ObjectRecordRow.object_type_id == ot_id,
        ObjectRecordRow.tenant_id == tenant_id,
    ]
    if filter:
        try:
            base_where.extend(_build_jsonb_filters(filter))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid filter: {exc}")

    async def generate() -> AsyncGenerator[bytes, None]:
        last_id: Optional[str] = None
        total = 0
        while True:
            q = select(ObjectRecordRow).where(*base_where)
            if last_id is not None:
                q = q.where(ObjectRecordRow.id > last_id)
            q = q.order_by(ObjectRecordRow.id).limit(chunk_size)
            result = await db.execute(q)
            rows = result.scalars().all()
            if not rows:
                break
            for row in rows:
                line = json.dumps(row.data, default=str) + "\n"
                yield line.encode()
            last_id = rows[-1].id
            total += len(rows)
            if len(rows) < chunk_size:
                break
        # Trailing summary line — clients that don't need it can ignore.
        yield (json.dumps({"_meta": {"total_streamed": total}}) + "\n").encode()

    return StreamingResponse(generate(), media_type="application/x-ndjson")


# ── TimescaleDB hypertable migration (admin) ───────────────────────────────


class TimescaleMigrateRequest(BaseModel):
    date_field: str
    chunk_time_interval: str = "7 days"


@router.post("/{ot_id}/timescale-migrate")
async def timescale_migrate(
    ot_id: str,
    body: TimescaleMigrateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """
    Admin op: copy this object type's records into a TimescaleDB hypertable
    partitioned by `date_field` (extracted from JSONB).

    This DOES NOT change query routing — it sets up the hypertable so a
    follow-up release can read from it for OTs that have been migrated.
    The flag we set on ObjectType.data['storage_mode'] = 'hypertable' tells
    the read path to use the hypertable connection.

    Pre-conditions:
      - `date_field` exists in records and casts cleanly to timestamptz
      - admin or superadmin role
      - TIMESCALE_URL env var configured (defaults to compose-internal URL)
    """
    if user.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="admin role required")

    tenant_id = x_tenant_id or "tenant-001"
    safe_field = _safe_field(body.date_field)

    timescale_url = os.environ.get(
        "TIMESCALE_URL",
        "postgresql+asyncpg://nexus:nexus_pass@timescaledb:5432/nexus_events",
    )

    from sqlalchemy.ext.asyncio import create_async_engine
    ts_engine = create_async_engine(timescale_url, echo=False, pool_pre_ping=True)

    table_name = f"or_hypertable_{re.sub(r'[^a-zA-Z0-9_]', '', ot_id).lower()}"[:63]

    try:
        async with ts_engine.connect() as ts_conn:
            await ts_conn.execution_options(isolation_level="AUTOCOMMIT")
            # Create the table on TimescaleDB
            await ts_conn.execute(text(
                f"CREATE TABLE IF NOT EXISTS {table_name} ("
                f"  id TEXT NOT NULL,"
                f"  tenant_id TEXT NOT NULL,"
                f"  source_id TEXT NOT NULL,"
                f"  data JSONB NOT NULL,"
                f"  bucket_ts TIMESTAMPTZ NOT NULL,"
                f"  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),"
                f"  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                f")"
            ))
            # Convert to hypertable (idempotent; create_hypertable raises if already converted)
            await ts_conn.execute(text(
                f"SELECT create_hypertable('{table_name}', 'bucket_ts', "
                f"chunk_time_interval => INTERVAL '{body.chunk_time_interval}', "
                f"if_not_exists => TRUE)"
            ))
            # Tenant + source_id index
            await ts_conn.execute(text(
                f"CREATE INDEX IF NOT EXISTS {table_name}_tenant_idx "
                f"ON {table_name} (tenant_id, source_id)"
            ))

        # Stream records from primary DB → write to hypertable in batches.
        copied = 0
        last_id: Optional[str] = None
        BATCH = 1000
        while True:
            q = select(ObjectRecordRow).where(
                ObjectRecordRow.object_type_id == ot_id,
                ObjectRecordRow.tenant_id == tenant_id,
            )
            if last_id is not None:
                q = q.where(ObjectRecordRow.id > last_id)
            q = q.order_by(ObjectRecordRow.id).limit(BATCH)
            result = await db.execute(q)
            rows = result.scalars().all()
            if not rows:
                break

            insert_values = []
            for r in rows:
                bucket_ts_raw = r.data.get(safe_field) if isinstance(r.data, dict) else None
                if not bucket_ts_raw:
                    continue
                insert_values.append({
                    "id": r.id,
                    "tenant_id": r.tenant_id,
                    "source_id": r.source_id,
                    "data": json.dumps(r.data),
                    "bucket_ts": bucket_ts_raw,
                })

            if insert_values:
                async with ts_engine.connect() as ts_conn:
                    await ts_conn.execution_options(isolation_level="AUTOCOMMIT")
                    await ts_conn.execute(
                        text(
                            f"INSERT INTO {table_name} (id, tenant_id, source_id, data, bucket_ts) "
                            f"VALUES (:id, :tenant_id, :source_id, :data::jsonb, (:bucket_ts)::timestamptz) "
                            f"ON CONFLICT DO NOTHING"
                        ),
                        insert_values,
                    )

            copied += len(rows)
            last_id = rows[-1].id
            if len(rows) < BATCH:
                break

        # Mark the object type as having a hypertable so a future release can
        # route reads through it.
        ot_result = await db.execute(
            select(ObjectTypeRow).where(
                ObjectTypeRow.id == ot_id,
                ObjectTypeRow.tenant_id == tenant_id,
            )
        )
        ot_row = ot_result.scalar_one_or_none()
        if ot_row:
            ot_data = dict(ot_row.data or {})
            ot_data["storage_mode"] = "hypertable"
            ot_data["hypertable_name"] = table_name
            ot_data["hypertable_date_field"] = safe_field
            ot_row.data = ot_data
            flag_modified(ot_row, "data")
            await db.commit()

        await ts_engine.dispose()

        return {
            "table": table_name,
            "records_copied": copied,
            "date_field": safe_field,
            "chunk_interval": body.chunk_time_interval,
            "note": "Read routing not yet wired — this set up the hypertable; queries still hit the primary DB.",
        }
    except Exception as exc:
        try:
            await ts_engine.dispose()
        except Exception:
            pass
        logger.warning("timescale migrate failed for ot=%s: %s", ot_id, exc)
        raise HTTPException(status_code=500, detail=f"Migration failed: {exc}")


# ── Cache stats (diagnostic) ───────────────────────────────────────────────


@router.get("/_cache/stats")
async def cache_stats(user: AuthUser = Depends(require_auth)):
    """Diagnostic endpoint: rollup-promoter stats. Useful for tuning thresholds."""
    return {
        "rollup": rollup_promoter.stats(),
        "auto_index_threshold_ms": index_advisor.SLOW_QUERY_MS,
        "auto_index_enabled": index_advisor.AUTO_INDEX_ENABLED,
        "default_ttl_seconds": query_cache.DEFAULT_TTL_SECONDS,
        "rollup_ttl_seconds": query_cache.ROLLUP_TTL_SECONDS,
    }


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
    asyncio.create_task(query_cache.invalidate_object_type(tenant_id, ot_id))
    return {
        "record": row.data,
        "source_id": row.source_id,
        "updated_at": row.updated_at.isoformat(),
    }


# ── DELETE record ───────────────────────────────────────────────────────────

@router.delete("/{ot_id}/records")
async def delete_all_records(
    ot_id: str,
    confirm: str = "",
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
    user: AuthUser = Depends(require_auth),
):
    """Wipe ALL records for an object type. Destructive — caller must pass
    ?confirm=<ot_id> so a stray DELETE can't nuke the wrong type.

    Use case: you've changed pipeline shape (e.g. added a PIVOT step) and
    want a clean slate before re-running, since old records have a
    different schema than what the pipeline now produces.
    """
    tenant_id = x_tenant_id or "tenant-001"
    if confirm != ot_id:
        raise HTTPException(
            status_code=400,
            detail=f"To confirm bulk deletion, pass ?confirm={ot_id} on the request.",
        )
    # Count first so we can report what we wiped, then bulk-delete via SQL
    # (faster than fetch-then-delete for large tables).
    count_result = await db.execute(
        text(
            "SELECT COUNT(*) FROM object_records "
            "WHERE object_type_id = :otid AND tenant_id = :tid"
        ),
        {"otid": ot_id, "tid": tenant_id},
    )
    deleted = count_result.scalar() or 0
    await db.execute(
        text(
            "DELETE FROM object_records "
            "WHERE object_type_id = :otid AND tenant_id = :tid"
        ),
        {"otid": ot_id, "tid": tenant_id},
    )
    await db.commit()
    asyncio.create_task(query_cache.invalidate_object_type(tenant_id, ot_id))
    return {"deleted": int(deleted), "object_type_id": ot_id}


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
    asyncio.create_task(query_cache.invalidate_object_type(tenant_id, ot_id))
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
    asyncio.create_task(query_cache.invalidate_object_type(tenant_id, ot_id))
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
    asyncio.create_task(query_cache.invalidate_object_type(tenant_id, ot_id))
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
    asyncio.create_task(query_cache.invalidate_object_type(tenant_id, ot_id))
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
