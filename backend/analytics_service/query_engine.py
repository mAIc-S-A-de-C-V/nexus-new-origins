"""
Parameterized query engine for object_records.
Builds safe SQL using SQLAlchemy text() with bound parameters.
"""
import time
from typing import Any
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

VALID_OPS = {"eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with", "is_null", "is_not_null"}
VALID_AGG_FUNCS = {"COUNT", "SUM", "AVG", "MIN", "MAX", "RUNTIME"}
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

        direction = "DESC"
        if order_by:
            d = order_by.get("direction", "desc").upper()
            if d in ("ASC", "DESC"):
                direction = d

        if agg_func == "RUNTIME":
            # RUNTIME aggregation: sums the time intervals where a 0/1 status
            # field equals 1. Uses LEAD() to compute the delta between
            # consecutive readings partitioned by the group_by field, ordered
            # by ts_field. Result is in seconds.
            ts_field = aggregate.get("ts_field") or "time"
            status_expr = _field_expr(agg_field)
            ts_expr = _field_expr(ts_field)
            ts_safe = (
                f"(CASE WHEN {ts_expr} ~ "
                f"'^[[:digit:]]{{4}}-[[:digit:]]{{2}}-[[:digit:]]{{2}}' "
                f"THEN NULLIF({ts_expr}, '')::timestamptz "
                f"ELSE NULL END)"
            )
            status_safe = (
                f"CASE WHEN {status_expr} ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' "
                f"THEN ({status_expr})::numeric ELSE 0 END"
            )

            count_sql = text(f"""
                SELECT COUNT(DISTINCT {group_field_expr}) AS cnt
                FROM object_records
                WHERE {where_sql}
            """)
            count_result = await session.execute(count_sql, params)
            total = count_result.scalar() or 0

            data_sql = text(f"""
                WITH deltas AS (
                    SELECT
                        {group_field_expr} AS group_key,
                        {status_safe} AS status_val,
                        EXTRACT(EPOCH FROM (
                            LEAD({ts_safe}) OVER (
                                PARTITION BY {group_field_expr}
                                ORDER BY {ts_safe}
                            ) - {ts_safe}
                        )) AS delta_seconds
                    FROM object_records
                    WHERE {where_sql}
                )
                SELECT group_key,
                       COALESCE(SUM(CASE WHEN status_val >= 1 THEN delta_seconds ELSE 0 END), 0) AS agg_value
                FROM deltas
                WHERE group_key IS NOT NULL
                GROUP BY group_key
                ORDER BY agg_value {direction}
                LIMIT :limit OFFSET :offset
            """)
            params["limit"] = min(limit, 1000)
            params["offset"] = offset
            result = await session.execute(data_sql, params)
            rows_raw = result.fetchall()
            rows = []
            for r in rows_raw:
                secs = float(r.agg_value) if r.agg_value else 0
                if secs >= 3600:
                    label = f"{secs / 3600:.1f}h"
                elif secs >= 60:
                    label = f"{secs / 60:.1f}m"
                else:
                    label = f"{secs:.0f}s"
                rows.append({"group_key": r.group_key, "agg_value": secs, "agg_label": label})
            columns = ["group_key", "agg_value", "agg_label"]

        else:
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

        # Infer columns as union of all row keys (preserves order from first row)
        if rows:
            seen: set[str] = set()
            columns: list[str] = []
            for row in rows:
                for k in row.keys():
                    if k not in seen:
                        seen.add(k)
                        columns.append(k)
        else:
            columns = []

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
