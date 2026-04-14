"""
Data quality profiler — runs JSONB property-level analysis on object_records.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Optional
import asyncpg

logger = logging.getLogger("profiler")


def _quality_score(properties: list[dict]) -> float:
    """
    Score 0–100 based on average completeness + uniqueness across all properties.
    completeness = 1 - null_rate
    uniqueness contribution = min(unique_rate, 1.0)
    score = avg(completeness * 0.7 + uniqueness * 0.3) * 100
    """
    if not properties:
        return 100.0
    total = 0.0
    for p in properties:
        completeness = 1.0 - p.get("null_rate", 0.0)
        uniqueness = min(p.get("unique_rate", 1.0), 1.0)
        total += completeness * 0.7 + uniqueness * 0.3
    return round((total / len(properties)) * 100, 1)


async def profile_object_type(
    pool: asyncpg.Pool,
    object_type_id: str,
    tenant_id: str,
) -> dict:
    """
    Profile all records for an object type.
    Returns a dict with: object_type_id, tenant_id, total_records, score, properties[], computed_at
    """
    # Get total record count
    total = await pool.fetchval(
        "SELECT COUNT(*) FROM object_records WHERE object_type_id = $1 AND tenant_id = $2",
        object_type_id, tenant_id,
    )
    total = total or 0

    if total == 0:
        return {
            "object_type_id": object_type_id,
            "tenant_id": tenant_id,
            "total_records": 0,
            "score": 100.0,
            "properties": [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

    # Get property names from object_type.data
    ot_row = await pool.fetchrow(
        "SELECT data FROM object_types WHERE id = $1 AND tenant_id = $2",
        object_type_id, tenant_id,
    )
    if not ot_row:
        return {
            "object_type_id": object_type_id,
            "tenant_id": tenant_id,
            "total_records": total,
            "score": 0.0,
            "properties": [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
            "error": "Object type not found",
        }

    ot_data = json.loads(ot_row["data"]) if isinstance(ot_row["data"], str) else ot_row["data"]
    raw_props = ot_data.get("properties", [])
    prop_names = [p["name"] for p in raw_props if isinstance(p, dict) and "name" in p]

    if not prop_names:
        return {
            "object_type_id": object_type_id,
            "tenant_id": tenant_id,
            "total_records": total,
            "score": 100.0,
            "properties": [],
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }

    profiles = []
    for prop in prop_names:
        # Null count: records where the property key is missing or value is null
        null_count = await pool.fetchval(
            """
            SELECT COUNT(*) FROM object_records
            WHERE object_type_id = $1 AND tenant_id = $2
              AND (data->$3 IS NULL OR data->>$3 = '' OR data->>$3 = 'null')
            """,
            object_type_id, tenant_id, prop,
        ) or 0

        # Distinct non-null count
        distinct_count = await pool.fetchval(
            """
            SELECT COUNT(DISTINCT data->>$3) FROM object_records
            WHERE object_type_id = $1 AND tenant_id = $2
              AND data->>$3 IS NOT NULL AND data->>$3 != '' AND data->>$3 != 'null'
            """,
            object_type_id, tenant_id, prop,
        ) or 0

        # Top 5 values
        top_rows = await pool.fetch(
            """
            SELECT data->>$3 AS val, COUNT(*) AS cnt
            FROM object_records
            WHERE object_type_id = $1 AND tenant_id = $2
              AND data->>$3 IS NOT NULL AND data->>$3 != '' AND data->>$3 != 'null'
            GROUP BY val ORDER BY cnt DESC LIMIT 5
            """,
            object_type_id, tenant_id, prop,
        )

        null_rate = round(null_count / total, 4) if total > 0 else 0.0
        non_null = total - null_count
        unique_rate = round(distinct_count / non_null, 4) if non_null > 0 else 0.0

        profiles.append({
            "name": prop,
            "total": total,
            "null_count": null_count,
            "null_rate": null_rate,
            "distinct_count": distinct_count,
            "unique_rate": unique_rate,
            "top_values": [{"value": r["val"], "count": r["cnt"]} for r in top_rows],
        })

    score = _quality_score(profiles)

    return {
        "object_type_id": object_type_id,
        "tenant_id": tenant_id,
        "total_records": total,
        "score": score,
        "properties": profiles,
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }


async def profile_all_types(pool: asyncpg.Pool, tenant_id: str) -> list[dict]:
    """Profile all object types for a tenant. Returns summary list."""
    rows = await pool.fetch(
        "SELECT id, display_name FROM object_types WHERE tenant_id = $1",
        tenant_id,
    )
    results = []
    for row in rows:
        try:
            profile = await profile_object_type(pool, row["id"], tenant_id)
            results.append({
                "object_type_id": row["id"],
                "display_name": row["display_name"],
                "total_records": profile["total_records"],
                "score": profile["score"],
                "computed_at": profile["computed_at"],
            })
        except Exception as e:
            logger.exception("Failed to profile %s", row["id"])
            results.append({
                "object_type_id": row["id"],
                "display_name": row["display_name"],
                "total_records": 0,
                "score": 0.0,
                "error": str(e),
                "computed_at": datetime.now(timezone.utc).isoformat(),
            })
    return results
