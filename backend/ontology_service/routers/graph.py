"""
Object Graph Explorer endpoints.

GET  /graph/summary          — type-level graph (all object types + links + record counts)
POST /graph/start            — record-level traversal from a specific record or type sample
POST /graph/expand           — expand one hop from a specific record node
"""
from typing import Optional
from fastapi import APIRouter, Header, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from database import get_session, ObjectTypeRow, OntologyLinkRow

router = APIRouter()


def _safe_field(field: str) -> str:
    """Sanitize a JSONB field name to only allow alphanumeric and underscore."""
    return "".join(c for c in field if c.isalnum() or c == "_")


@router.get("/summary")
async def get_graph_summary(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Returns all object types with record counts and all ontology links.
    Used for the type-level overview graph.
    """
    tenant_id = x_tenant_id or "tenant-001"

    # Fetch all object types
    ot_result = await db.execute(
        select(ObjectTypeRow).where(ObjectTypeRow.tenant_id == tenant_id)
    )
    ot_rows = ot_result.scalars().all()

    # Record counts per type in one query
    counts_sql = text("""
        SELECT object_type_id::text, COUNT(*)::int AS cnt
        FROM object_records
        WHERE tenant_id = :tenant_id
        GROUP BY object_type_id
    """)
    counts_result = await db.execute(counts_sql, {"tenant_id": tenant_id})
    counts: dict[str, int] = {row.object_type_id: row.cnt for row in counts_result}

    # Fetch all links
    link_result = await db.execute(
        select(OntologyLinkRow).where(OntologyLinkRow.tenant_id == tenant_id)
    )
    link_rows = link_result.scalars().all()

    nodes = []
    for ot in ot_rows:
        ot_data = dict(ot.data or {})
        properties = ot_data.get("properties", [])
        nodes.append({
            "id": ot.id,
            "node_type": "object_type",
            "display_name": ot.display_name,
            "name": ot.name,
            "record_count": counts.get(ot.id, 0),
            "properties": [
                {
                    "name": p.get("name", ""),
                    "data_type": p.get("data_type", "string"),
                    "semantic_type": p.get("semantic_type", "TEXT"),
                }
                for p in properties[:12]
            ],
            "version": ot.version,
            "description": ot_data.get("description", ""),
        })

    edges = []
    for link in link_rows:
        link_data = dict(link.data or {})
        edges.append({
            "id": link.id,
            "source": link.source_object_type_id,
            "target": link.target_object_type_id,
            "relationship_type": link_data.get("relationship_type", "related"),
            "join_keys": link_data.get("join_keys", []),
            "is_inferred": link_data.get("is_inferred", False),
            "confidence": link_data.get("confidence"),
        })

    return {"nodes": nodes, "edges": edges}


@router.post("/start")
async def start_graph(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Start a record-level graph from a specific record (object_id provided) or
    from a sample of records for a given object_type_id.

    Uses join_keys from ontology_links to connect related records.
    Falls back to sampling target-type records when no join_keys exist.
    """
    tenant_id = x_tenant_id or "tenant-001"
    object_type_id = body.get("object_type_id", "")
    object_id = body.get("object_id")
    depth = min(int(body.get("depth", 2)), 4)
    max_nodes = min(int(body.get("max_nodes", 100)), 300)

    if not object_type_id:
        raise HTTPException(status_code=400, detail="object_type_id is required")

    # ── Fetch starting records ─────────────────────────────────────────────────
    if object_id:
        sql = text("""
            SELECT r.id::text, r.object_type_id::text,
                   ot.display_name AS type_name, r.data
            FROM object_records r
            JOIN object_types ot
                ON ot.id::text = r.object_type_id::text
                AND ot.tenant_id = :tenant_id
            WHERE r.tenant_id = :tenant_id
              AND r.id::text = :object_id
            LIMIT 1
        """)
        result = await db.execute(sql, {
            "tenant_id": tenant_id,
            "object_id": object_id,
        })
    else:
        sql = text("""
            SELECT r.id::text, r.object_type_id::text,
                   ot.display_name AS type_name, r.data
            FROM object_records r
            JOIN object_types ot
                ON ot.id::text = r.object_type_id::text
                AND ot.tenant_id = :tenant_id
            WHERE r.tenant_id = :tenant_id
              AND r.object_type_id::text = :object_type_id
            LIMIT :lim
        """)
        result = await db.execute(sql, {
            "tenant_id": tenant_id,
            "object_type_id": object_type_id,
            "lim": min(max_nodes // 2, 50),
        })

    nodes: list[dict] = []
    for row in result:
        nodes.append({
            "id": row.id,
            "object_type_id": row.object_type_id,
            "type_name": row.type_name,
            "data": dict(row.data or {}),
            "depth": 0,
        })

    if not nodes:
        return {"nodes": [], "edges": [], "truncated": False}

    seen_ids: set[str] = {n["id"] for n in nodes}
    edges: list[dict] = []

    # Only traverse if we have a specific starting record and depth > 0
    if depth > 0:
        # ── Get all outgoing links from the starting type ────────────────────
        links_sql = text("""
            SELECT id::text, source_object_type_id::text,
                   target_object_type_id::text, data
            FROM ontology_links
            WHERE tenant_id = :tenant_id
              AND source_object_type_id::text = :object_type_id
        """)
        links_result = await db.execute(links_sql, {
            "tenant_id": tenant_id,
            "object_type_id": object_type_id,
        })
        links = [
            {
                "id": row.id,
                "source_type": row.source_object_type_id,
                "target_type": row.target_object_type_id,
                "data": dict(row.data or {}),
            }
            for row in links_result
        ]

        for link in links:
            if len(nodes) >= max_nodes:
                break

            link_data = link["data"]
            join_keys: list[dict] = link_data.get("join_keys", [])
            rel_type: str = link_data.get("relationship_type", "related")
            target_type_id: str = link["target_type"]

            if join_keys and object_id:
                # Record-level traversal using join_keys
                source_field = _safe_field(join_keys[0].get("source_field", ""))
                target_field = _safe_field(join_keys[0].get("target_field", ""))

                if not source_field or not target_field:
                    continue

                # Collect matching values from all source nodes
                source_values = list({
                    str(n["data"][source_field])
                    for n in nodes
                    if n["data"].get(source_field) is not None
                })

                if not source_values:
                    continue

                remaining = max_nodes - len(nodes)
                if remaining <= 0:
                    break

                # Build query with IN clause (parameterized)
                placeholders = ", ".join(f":sv_{i}" for i in range(len(source_values)))
                match_sql = text(f"""
                    SELECT r.id::text, r.object_type_id::text,
                           ot.display_name AS type_name, r.data
                    FROM object_records r
                    JOIN object_types ot
                        ON ot.id::text = r.object_type_id::text
                        AND ot.tenant_id = :tenant_id
                    WHERE r.tenant_id = :tenant_id
                      AND r.object_type_id::text = :target_type_id
                      AND r.data->>'{target_field}' IN ({placeholders})
                    LIMIT :lim
                """)
                sv_params = {f"sv_{i}": v for i, v in enumerate(source_values)}
                match_result = await db.execute(match_sql, {
                    "tenant_id": tenant_id,
                    "target_type_id": target_type_id,
                    "lim": remaining,
                    **sv_params,
                })

                new_nodes = []
                for row in match_result:
                    if row.id not in seen_ids:
                        new_nodes.append({
                            "id": row.id,
                            "object_type_id": row.object_type_id,
                            "type_name": row.type_name,
                            "data": dict(row.data or {}),
                            "depth": 1,
                        })
                        seen_ids.add(row.id)
                nodes.extend(new_nodes)

                # Build record-to-record edges using join key matching
                src_by_key = {}
                for n in nodes:
                    if n["object_type_id"] == object_type_id:
                        v = n["data"].get(source_field)
                        if v is not None:
                            src_by_key.setdefault(str(v), []).append(n["id"])

                for tn in new_nodes:
                    tv = tn["data"].get(target_field)
                    if tv is not None:
                        for sn_id in src_by_key.get(str(tv), []):
                            edges.append({
                                "id": f"{link['id']}-{sn_id}-{tn['id']}",
                                "source": sn_id,
                                "target": tn["id"],
                                "link_id": link["id"],
                                "relationship_type": rel_type,
                            })
            else:
                # No join keys — sample records of target type
                remaining = min(20, max_nodes - len(nodes))
                if remaining <= 0:
                    break

                sample_sql = text("""
                    SELECT r.id::text, r.object_type_id::text,
                           ot.display_name AS type_name, r.data
                    FROM object_records r
                    JOIN object_types ot
                        ON ot.id::text = r.object_type_id::text
                        AND ot.tenant_id = :tenant_id
                    WHERE r.tenant_id = :tenant_id
                      AND r.object_type_id::text = :target_type_id
                    LIMIT :lim
                """)
                sample_result = await db.execute(sample_sql, {
                    "tenant_id": tenant_id,
                    "target_type_id": target_type_id,
                    "lim": remaining,
                })
                new_nodes = []
                for row in sample_result:
                    if row.id not in seen_ids:
                        new_nodes.append({
                            "id": row.id,
                            "object_type_id": row.object_type_id,
                            "type_name": row.type_name,
                            "data": dict(row.data or {}),
                            "depth": 1,
                        })
                        seen_ids.add(row.id)
                nodes.extend(new_nodes)

                # Connect representative source node to new nodes (type-level edges)
                if nodes and new_nodes:
                    src_rep = next(
                        (n["id"] for n in nodes if n["object_type_id"] == object_type_id),
                        nodes[0]["id"]
                    )
                    for tn in new_nodes[:10]:
                        edges.append({
                            "id": f"{link['id']}-{tn['id']}",
                            "source": src_rep,
                            "target": tn["id"],
                            "link_id": link["id"],
                            "relationship_type": rel_type,
                        })

    return {
        "nodes": nodes,
        "edges": edges,
        "truncated": len(nodes) >= max_nodes,
    }


@router.post("/expand")
async def expand_node(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Expand one hop from a specific record node via a named link.
    Returns only nodes not already in the caller's existing graph.
    """
    tenant_id = x_tenant_id or "tenant-001"
    record_id: str = body.get("record_id", "")
    target_type_id: str = body.get("target_type_id", "")
    link_id: Optional[str] = body.get("link_id")
    existing_ids: list[str] = body.get("existing_ids", [])
    limit = min(int(body.get("limit", 50)), 200)

    if not record_id or not target_type_id:
        raise HTTPException(status_code=400, detail="record_id and target_type_id required")

    # Get the source record's data
    src_sql = text("""
        SELECT data FROM object_records
        WHERE tenant_id = :tenant_id AND id::text = :record_id
    """)
    src_result = await db.execute(src_sql, {"tenant_id": tenant_id, "record_id": record_id})
    src_row = src_result.fetchone()
    if not src_row:
        raise HTTPException(status_code=404, detail="Record not found")
    src_data = dict(src_row.data or {})

    # Get join_keys from the link
    join_keys: list[dict] = []
    rel_type = "related"
    if link_id:
        link_sql = text("SELECT data FROM ontology_links WHERE id::text = :link_id")
        link_result = await db.execute(link_sql, {"link_id": link_id})
        link_row = link_result.fetchone()
        if link_row:
            link_data = dict(link_row.data or {})
            join_keys = link_data.get("join_keys", [])
            rel_type = link_data.get("relationship_type", "related")

    new_nodes: list[dict] = []

    if join_keys:
        source_field = _safe_field(join_keys[0].get("source_field", ""))
        target_field = _safe_field(join_keys[0].get("target_field", ""))
        source_val = src_data.get(source_field)

        if source_field and target_field and source_val is not None:
            match_sql = text(f"""
                SELECT r.id::text, r.object_type_id::text,
                       ot.display_name AS type_name, r.data
                FROM object_records r
                JOIN object_types ot
                    ON ot.id::text = r.object_type_id::text
                    AND ot.tenant_id = :tenant_id
                WHERE r.tenant_id = :tenant_id
                  AND r.object_type_id::text = :target_type_id
                  AND r.data->>'{target_field}' = :source_val
                LIMIT :lim
            """)
            match_result = await db.execute(match_sql, {
                "tenant_id": tenant_id,
                "target_type_id": target_type_id,
                "source_val": str(source_val),
                "lim": limit,
            })
            for row in match_result:
                if row.id not in existing_ids:
                    new_nodes.append({
                        "id": row.id,
                        "object_type_id": row.object_type_id,
                        "type_name": row.type_name,
                        "data": dict(row.data or {}),
                        "depth": 1,
                    })
    else:
        # No join keys — sample records of target type
        sample_sql = text("""
            SELECT r.id::text, r.object_type_id::text,
                   ot.display_name AS type_name, r.data
            FROM object_records r
            JOIN object_types ot
                ON ot.id::text = r.object_type_id::text
                AND ot.tenant_id = :tenant_id
            WHERE r.tenant_id = :tenant_id
              AND r.object_type_id::text = :target_type_id
            LIMIT :lim
        """)
        sample_result = await db.execute(sample_sql, {
            "tenant_id": tenant_id,
            "target_type_id": target_type_id,
            "lim": limit,
        })
        for row in sample_result:
            if row.id not in existing_ids:
                new_nodes.append({
                    "id": row.id,
                    "object_type_id": row.object_type_id,
                    "type_name": row.type_name,
                    "data": dict(row.data or {}),
                    "depth": 1,
                })

    new_edges = [
        {
            "id": f"{link_id or 'exp'}-{record_id}-{n['id']}",
            "source": record_id,
            "target": n["id"],
            "link_id": link_id,
            "relationship_type": rel_type,
        }
        for n in new_nodes
    ]

    return {"nodes": new_nodes, "edges": new_edges}
