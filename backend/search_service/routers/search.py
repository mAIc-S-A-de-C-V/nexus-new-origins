import asyncio
from typing import Optional
from fastapi import APIRouter, Query, Header
from database import get_pool

router = APIRouter()


def _score(text: str, query: str) -> float:
    t = text.lower()
    q = query.lower()
    if t == q:
        return 1.0
    if t.startswith(q):
        return 0.85
    if q in t:
        return 0.65
    return 0.4


@router.get("")
async def search(
    q: str = Query(..., min_length=1),
    limit: int = Query(20, le=50),
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    pattern = f"%{q}%"

    async def search_object_types():
        rows = await pool.fetch(
            """
            SELECT id, name, display_name,
                   data->>'description' AS description
            FROM object_types
            WHERE tenant_id = $1 AND (
                name ILIKE $2 OR display_name ILIKE $2
                OR (data->>'description') ILIKE $2
            )
            LIMIT 10
            """,
            tenant_id, pattern,
        )
        return [
            {
                "type": "object_type",
                "id": r["id"],
                "title": r["display_name"],
                "subtitle": f"Object Type · {r['description'][:60] if r['description'] else r['name']}",
                "path": "ontology",
                "score": _score(r["display_name"], q),
            }
            for r in rows
        ]

    async def search_records():
        """Search actual record data across all object types."""
        rows = await pool.fetch(
            """
            SELECT r.id, r.object_type_id, r.data,
                   ot.display_name AS type_name
            FROM object_records r
            JOIN object_types ot ON ot.id = r.object_type_id
            WHERE r.tenant_id = $1
              AND r.data::text ILIKE $2
            ORDER BY r.updated_at DESC
            LIMIT 8
            """,
            tenant_id, pattern,
        )
        results = []
        for r in rows:
            data = r["data"] or {}
            # Find the best matching field value to show as subtitle
            matched_field = None
            matched_val = None
            for k, v in data.items():
                if k.startswith("_"):
                    continue
                if v is not None and q.lower() in str(v).lower():
                    matched_field = k
                    matched_val = str(v)[:60]
                    break
            # Use case_id / id / name as primary title
            rec_title = (
                data.get("case_id") or data.get("id") or data.get("name")
                or data.get("event_id") or r["id"][:8]
            )
            subtitle = f"{r['type_name']} record"
            if matched_field and matched_field not in ("case_id", "id", "name", "event_id"):
                subtitle += f" · {matched_field}: {matched_val}"
            results.append({
                "type": "record",
                "id": r["id"],
                "title": str(rec_title),
                "subtitle": subtitle,
                "path": "data",
                "score": 0.75 if matched_field == "case_id" else 0.6,
            })
        return results

    async def search_pipelines():
        rows = await pool.fetch(
            """
            SELECT id, name, status
            FROM pipelines
            WHERE tenant_id = $1 AND name ILIKE $2
            LIMIT 10
            """,
            tenant_id, pattern,
        )
        return [
            {
                "type": "pipeline",
                "id": r["id"],
                "title": r["name"],
                "subtitle": f"Pipeline · {r['status']}",
                "path": "pipelines",
                "score": _score(r["name"], q),
            }
            for r in rows
        ]

    async def search_connectors():
        rows = await pool.fetch(
            """
            SELECT id, name, type, category
            FROM connectors
            WHERE tenant_id = $1 AND (name ILIKE $2 OR type ILIKE $2 OR category ILIKE $2)
            LIMIT 10
            """,
            tenant_id, pattern,
        )
        return [
            {
                "type": "connector",
                "id": r["id"],
                "title": r["name"],
                "subtitle": f"Connector · {r['type']}",
                "path": "connectors",
                "score": _score(r["name"], q),
            }
            for r in rows
        ]

    async def search_agents():
        rows = await pool.fetch(
            """
            SELECT id, name, description
            FROM agent_configs
            WHERE tenant_id = $1 AND (name ILIKE $2 OR description ILIKE $2)
            LIMIT 10
            """,
            tenant_id, pattern,
        )
        return [
            {
                "type": "agent",
                "id": r["id"],
                "title": r["name"],
                "subtitle": f"Agent · {r['description'][:60] + '...' if r['description'] and len(r['description']) > 60 else (r['description'] or '')}",
                "path": "agents",
                "score": _score(r["name"], q),
            }
            for r in rows
        ]

    async def search_logic():
        rows = await pool.fetch(
            """
            SELECT id, name, description, status
            FROM logic_functions
            WHERE tenant_id = $1 AND (name ILIKE $2 OR description ILIKE $2)
            LIMIT 10
            """,
            tenant_id, pattern,
        )
        return [
            {
                "type": "logic",
                "id": r["id"],
                "title": r["name"],
                "subtitle": f"Logic Function · {r['status']}",
                "path": "logic",
                "score": _score(r["name"], q),
            }
            for r in rows
        ]

    async def search_apps():
        rows = await pool.fetch(
            """
            SELECT id, name, description
            FROM apps
            WHERE tenant_id = $1 AND (name ILIKE $2 OR description ILIKE $2)
            LIMIT 10
            """,
            tenant_id, pattern,
        )
        return [
            {
                "type": "dashboard",
                "id": r["id"],
                "title": r["name"],
                "subtitle": "Dashboard",
                "path": "apps",
                "score": _score(r["name"], q),
            }
            for r in rows
        ]

    # Fan out all searches in parallel
    results_nested = await asyncio.gather(
        search_object_types(),
        search_pipelines(),
        search_connectors(),
        search_agents(),
        search_logic(),
        search_apps(),
        search_records(),
        return_exceptions=True,
    )

    # Flatten, skip errors, sort by score desc
    results = []
    for group in results_nested:
        if isinstance(group, list):
            results.extend(group)

    results.sort(key=lambda r: r["score"], reverse=True)
    return results[:limit]
