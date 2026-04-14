"""
Lineage API endpoints.

GET /lineage/graph                    Full tenant lineage graph
GET /lineage/graph/health             Graph with health annotations
GET /lineage/node/{id}/upstream       Everything feeding into this node
GET /lineage/node/{id}/downstream     Everything this node feeds into
GET /lineage/impact/{id}              Downstream impact if this node breaks
"""
from typing import Optional
from fastapi import APIRouter, Header

from aggregator import LineageAggregator
from health_checker import check_health

router = APIRouter()
_agg = LineageAggregator()


def _find_upstream(node_id: str, nodes: list[dict], edges: list[dict]) -> list[dict]:
    """BFS upstream: find all nodes that directly or transitively feed into node_id."""
    visited = set()
    queue = [node_id]
    result = []
    node_map = {n["id"]: n for n in nodes}

    while queue:
        current = queue.pop(0)
        for edge in edges:
            if edge["target"] == current and edge["source"] not in visited:
                visited.add(edge["source"])
                queue.append(edge["source"])
                if edge["source"] in node_map:
                    result.append(node_map[edge["source"]])
    return result


def _find_downstream(node_id: str, nodes: list[dict], edges: list[dict]) -> list[dict]:
    """BFS downstream: find all nodes this node feeds into."""
    visited = set()
    queue = [node_id]
    result = []
    node_map = {n["id"]: n for n in nodes}

    while queue:
        current = queue.pop(0)
        for edge in edges:
            if edge["source"] == current and edge["target"] not in visited:
                visited.add(edge["target"])
                queue.append(edge["target"])
                if edge["target"] in node_map:
                    result.append(node_map[edge["target"]])
    return result


@router.get("/graph")
async def get_graph(x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    graph = await _agg.build(tenant_id)
    return graph


@router.get("/graph/health")
async def get_graph_with_health(x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    graph = await _agg.build(tenant_id)
    graph["nodes"] = await check_health(graph["nodes"])
    return graph


@router.get("/node/{node_id}/upstream")
async def get_upstream(
    node_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    graph = await _agg.build(tenant_id)
    upstream = _find_upstream(node_id, graph["nodes"], graph["edges"])
    return {"node_id": node_id, "upstream": upstream, "count": len(upstream)}


@router.get("/node/{node_id}/downstream")
async def get_downstream(
    node_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    graph = await _agg.build(tenant_id)
    downstream = _find_downstream(node_id, graph["nodes"], graph["edges"])
    return {"node_id": node_id, "downstream": downstream, "count": len(downstream)}


@router.get("/impact/{node_id}")
async def get_impact(
    node_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    """What downstream nodes are affected if this node breaks/stops?"""
    tenant_id = x_tenant_id or "tenant-001"
    graph = await _agg.build(tenant_id)
    affected = _find_downstream(node_id, graph["nodes"], graph["edges"])

    # Group by type for summary
    by_type: dict[str, list] = {}
    for n in affected:
        t = n["type"]
        by_type.setdefault(t, []).append({"id": n["id"], "label": n["label"]})

    return {
        "node_id": node_id,
        "affected_count": len(affected),
        "affected_nodes": affected,
        "by_type": by_type,
    }
