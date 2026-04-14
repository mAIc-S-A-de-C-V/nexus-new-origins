"""
Parameterized query engine for object_records.
Builds safe SQL using SQLAlchemy text() with bound parameters.
"""
import time
from typing import Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

VALID_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with", "is_null", "is_not_null"}
VALID_AGG_FUNCS = {"COUNT", "SUM", "AVG", "MIN", "MAX"}
VALID_DIRECTIONS = {"asc", "desc"}


def _op_to_sql(op: str, param_name: str, field_expr: str) -> str:
    if op == "eq":
        return f"{field_expr} = :{param_name}"
    if op == "neq":
        return f"{field_expr} != :{param_name}"
    if op == "gt":
        return f"({field_expr})::numeric > :{param_name}"
    if op == "gte":
        return f"({field_expr})::numeric >= :{param_name}"
    if op == "lt":
        return f"({field_expr})::numeric < :{param_name}"
    if op == "lte":
        return f"({field_expr})::numeric <= :{param_name}"
    if op == "contains":
        return f"lower({field_expr}) LIKE lower(:{param_name})"
    if op == "starts_with":
        return f"lower({field_expr}) LIKE lower(:{param_name})"
    if op == "is_null":
        return f"{field_expr} IS NULL"
    if op == "is_not_null":
        return f"{field_expr} IS NOT NULL"
    raise ValueError(f"Unknown op: {op}")


def _field_expr(field: str) -> str:
    """Turn a dotted field path into a JSONB extraction expression."""
    # Prevent SQL injection — only allow alphanumeric + underscore + dot
    clean = "".join(c for c in field if c.isalnum() or c in "_.")
    parts = clean.split(".")
    if len(parts) == 1:
        return f"data->>'{parts[0]}'"
    # Nested: data->'parent'->>'child'
    path = "->".join(f"'{p}'" for p in parts[:-1])
    return f"data->{path}->>'{parts[-1]}'"


async def run_explore_query(
    session: AsyncSession,
    tenant_id: str,
    object_type_id: str,
    filters: list[dict],
    aggregate: dict | None,
    group_by: str | None,
    order_by: dict | None,
    limit: int,
    offset: int,
    select_fields: list[str],
) -> dict[str, Any]:
    start = time.monotonic()
    params: dict[str, Any] = {"tenant_id": tenant_id, "object_type_id": object_type_id}

    # Build WHERE clauses
    where_parts = [
        "tenant_id = :tenant_id",
        "object_type_id = :object_type_id",
    ]
    for i, f in enumerate(filters):
        op = f.get("op", "eq")
        if op not in VALID_OPS:
            continue
        field = f.get("field", "")
        if not field:
            continue
        field_expr = _field_expr(field)
        param_name = f"fv_{i}"
        clause = _op_to_sql(op, param_name, field_expr)
        where_parts.append(f"({clause})")
        val = f.get("value", "")
        if op == "contains":
            params[param_name] = f"%{val}%"
        elif op == "starts_with":
            params[param_name] = f"{val}%"
        elif op in ("gt", "gte", "lt", "lte"):
            try:
                params[param_name] = float(val)
            except (ValueError, TypeError):
                params[param_name] = val
        elif op not in ("is_null", "is_not_null"):
            params[param_name] = val

    where_sql = " AND ".join(where_parts)

    if aggregate and group_by:
        # Aggregation query
        agg_func = aggregate.get("function", "COUNT").upper()
        if agg_func not in VALID_AGG_FUNCS:
            agg_func = "COUNT"
        agg_field = aggregate.get("field", "*")
        group_field_expr = _field_expr(group_by)

        if agg_func == "COUNT":
            agg_expr = "COUNT(*)"
        else:
            af_expr = _field_expr(agg_field)
            agg_expr = f"{agg_func}(({af_expr})::numeric)"

        # Count query
        count_sql = text(f"""
            SELECT COUNT(DISTINCT {group_field_expr}) AS cnt
            FROM object_records
            WHERE {where_sql}
        """)
        count_result = await session.execute(count_sql, params)
        total = count_result.scalar() or 0

        direction = "DESC"
        if order_by:
            d = order_by.get("direction", "desc").upper()
            if d in ("ASC", "DESC"):
                direction = d

        data_sql = text(f"""
            SELECT {group_field_expr} AS group_key, {agg_expr} AS agg_value
            FROM object_records
            WHERE {where_sql}
            GROUP BY {group_field_expr}
            ORDER BY agg_value {direction}
            LIMIT :limit OFFSET :offset
        """)
        params["limit"] = min(limit, 1000)
        params["offset"] = offset
        result = await session.execute(data_sql, params)
        rows = [{"group_key": r.group_key, "agg_value": r.agg_value} for r in result]
        columns = ["group_key", "agg_value"]

    else:
        # Raw records query
        count_sql = text(f"SELECT COUNT(*) FROM object_records WHERE {where_sql}")
        count_result = await session.execute(count_sql, params)
        total = count_result.scalar() or 0

        order_clause = "created_at DESC"
        if order_by:
            field = order_by.get("field", "")
            direction = order_by.get("direction", "desc").upper()
            if direction not in ("ASC", "DESC"):
                direction = "DESC"
            if field in ("created_at", "updated_at"):
                order_clause = f"{field} {direction}"
            elif field:
                order_clause = f"{_field_expr(field)} {direction}"

        data_sql = text(f"""
            SELECT id, source_id, data, created_at, updated_at
            FROM object_records
            WHERE {where_sql}
            ORDER BY {order_clause}
            LIMIT :limit OFFSET :offset
        """)
        params["limit"] = min(limit, 500)
        params["offset"] = offset
        result = await session.execute(data_sql, params)

        raw_rows = result.fetchall()
        if select_fields:
            clean_fields = [f for f in select_fields if all(c.isalnum() or c in "_." for c in f)]
            rows = []
            for r in raw_rows:
                d = dict(r.data or {})
                d["_id"] = r.id
                d["_source_id"] = r.source_id
                d["_created_at"] = r.created_at.isoformat() if r.created_at else None
                row = {k: d.get(k) for k in clean_fields if k in d}
                row["_id"] = d["_id"]
                rows.append(row)
        else:
            rows = []
            for r in raw_rows:
                d = dict(r.data or {})
                d["_id"] = r.id
                d["_source_id"] = r.source_id
                d["_created_at"] = r.created_at.isoformat() if r.created_at else None
                rows.append(d)

        # Infer columns from first non-empty row
        columns = list(rows[0].keys()) if rows else []

    elapsed_ms = round((time.monotonic() - start) * 1000)
    return {
        "rows": rows,
        "total": int(total),
        "columns": columns,
        "query_ms": elapsed_ms,
    }


async def sample_fields(
    session: AsyncSession,
    tenant_id: str,
    object_type_id: str,
    limit: int = 50,
) -> list[str]:
    """Return distinct top-level keys from the data JSONB for schema discovery."""
    # Fetch a sample of rows and extract keys in Python — avoids set-returning function issues
    sql = text("""
        SELECT data FROM object_records
        WHERE tenant_id = :tenant_id
          AND object_type_id = :object_type_id
        LIMIT 100
    """)
    result = await session.execute(sql, {
        "tenant_id": tenant_id,
        "object_type_id": object_type_id,
    })
    keys: set[str] = set()
    for row in result:
        if row.data:
            keys.update(row.data.keys())
        if len(keys) >= limit:
            break
    return sorted(keys)[:limit]
