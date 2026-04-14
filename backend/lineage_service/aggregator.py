"""
LineageAggregator — queries all Nexus services to build a unified lineage graph.

6 layers (left to right):
  1. Connectors    — data sources
  2. Pipelines     — data ingestion + transformation
  3. Object Types  — canonical data entities
  4. Logic Funcs   — data consumers / transformers
  5. Agents        — AI actors with data scope
  6. Actions       — write-back operations

Edges represent data flow between layers.
"""
import asyncio
import os
import logging
from typing import Any

import httpx

log = logging.getLogger("lineage.aggregator")

CONNECTOR_API = os.environ.get("CONNECTOR_SERVICE_URL", "http://connector-service:8001")
PIPELINE_API  = os.environ.get("PIPELINE_SERVICE_URL",  "http://pipeline-service:8002")
ONTOLOGY_API  = os.environ.get("ONTOLOGY_SERVICE_URL",  "http://ontology-service:8004")
LOGIC_API     = os.environ.get("LOGIC_SERVICE_URL",     "http://logic-service:8012")
AGENT_API     = os.environ.get("AGENT_SERVICE_URL",     "http://agent-service:8013")

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


async def _http_get(client: httpx.AsyncClient, url: str, tenant_id: str) -> list[dict]:
    """Fetch a list from a service. Returns [] on any error."""
    try:
        resp = await client.get(url, headers={"x-tenant-id": tenant_id}, timeout=_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                # Handle paginated responses: {items: [], total: n} or {data: [], ...}
                for key in ("items", "data", "results", "pipelines", "connectors", "agents", "functions", "flows"):
                    if key in data and isinstance(data[key], list):
                        return data[key]
                return [data]
    except Exception as e:
        log.warning(f"Failed to fetch {url}: {e}")
    return []


class LineageAggregator:
    async def build(self, tenant_id: str) -> dict:
        """Build the full lineage graph for a tenant."""
        nodes: list[dict] = []
        edges: list[dict] = []

        async with httpx.AsyncClient() as client:
            # Fetch all layers concurrently
            connectors, pipelines, object_types, logic_funcs, logic_flows, agents, actions = await asyncio.gather(
                _http_get(client, f"{CONNECTOR_API}/connectors", tenant_id),
                _http_get(client, f"{PIPELINE_API}/pipelines", tenant_id),
                _http_get(client, f"{ONTOLOGY_API}/object-types", tenant_id),
                _http_get(client, f"{LOGIC_API}/logic/functions", tenant_id),
                _http_get(client, f"{LOGIC_API}/logic/flows", tenant_id),
                _http_get(client, f"{AGENT_API}/agents", tenant_id),
                _http_get(client, f"{ONTOLOGY_API}/actions", tenant_id),
            )

        # ── Layer 1: Connectors ───────────────────────────────────────────────
        connector_ids = set()
        for c in connectors:
            nid = f"connector:{c['id']}"
            connector_ids.add(str(c['id']))
            nodes.append({
                "id": nid,
                "type": "connector",
                "label": c.get("name", "Connector"),
                "status": c.get("status", "unknown"),
                "meta": {
                    "id": c["id"],
                    "name": c.get("name"),
                    "type": c.get("type", "REST_API"),
                    "status": c.get("status"),
                    "last_sync": c.get("last_sync"),
                    "base_url": c.get("base_url"),
                },
            })

        # ── Layer 2: Pipelines ────────────────────────────────────────────────
        pipeline_ids = set()
        for p in pipelines:
            nid = f"pipeline:{p['id']}"
            pipeline_ids.add(str(p['id']))
            nodes.append({
                "id": nid,
                "type": "pipeline",
                "label": p.get("name", "Pipeline"),
                "status": p.get("status", "idle"),
                "meta": {
                    "id": p["id"],
                    "name": p.get("name"),
                    "status": p.get("status"),
                    "last_run_at": p.get("last_run_at") or p.get("lastRunAt"),
                    "last_run_row_count": p.get("last_run_row_count") or p.get("lastRunRowCount", 0),
                },
            })

            # Connector → Pipeline edges
            for node in (p.get("nodes") or []):
                cfg = node.get("config") or {}
                cid = cfg.get("connector_id") or cfg.get("connectorId")
                if cid and str(cid) in connector_ids:
                    edge_id = f"connector:{cid}→pipeline:{p['id']}"
                    edges.append({
                        "id": edge_id,
                        "source": f"connector:{cid}",
                        "target": nid,
                        "label": "feeds",
                        "animated": True,
                    })

            # Direct connector_ids field
            for cid in (p.get("connector_ids") or []):
                if str(cid) in connector_ids:
                    edge_id = f"connector:{cid}→pipeline:{p['id']}"
                    if not any(e["id"] == edge_id for e in edges):
                        edges.append({
                            "id": edge_id,
                            "source": f"connector:{cid}",
                            "target": nid,
                            "label": "feeds",
                            "animated": True,
                        })

        # ── Layer 3: Object Types ─────────────────────────────────────────────
        ot_ids = set()
        for ot in object_types:
            nid = f"objecttype:{ot['id']}"
            ot_ids.add(str(ot['id']))
            nodes.append({
                "id": nid,
                "type": "object_type",
                "label": ot.get("displayName") or ot.get("display_name") or ot.get("name", "Object Type"),
                "status": "active",
                "meta": {
                    "id": ot["id"],
                    "name": ot.get("name"),
                    "display_name": ot.get("displayName") or ot.get("display_name"),
                    "record_count": ot.get("record_count", 0),
                    "property_count": len(ot.get("properties") or []),
                },
            })

            # Pipeline → ObjectType edges
            pid = ot.get("pipeline_id") or ot.get("pipelineId")
            if pid and str(pid) in pipeline_ids:
                edges.append({
                    "id": f"pipeline:{pid}→objecttype:{ot['id']}",
                    "source": f"pipeline:{pid}",
                    "target": nid,
                    "label": "writes to",
                    "animated": False,
                })

        # ── Layer 4: Logic Functions + Flows ──────────────────────────────────
        logic_ids = set()
        for func in logic_funcs:
            nid = f"logic:{func['id']}"
            logic_ids.add(str(func['id']))
            nodes.append({
                "id": nid,
                "type": "logic_function",
                "label": func.get("name", "Logic Function"),
                "status": func.get("status", "active"),
                "meta": {
                    "id": func["id"],
                    "name": func.get("name"),
                    "status": func.get("status"),
                    "last_run_at": func.get("last_run_at"),
                    "block_count": len(func.get("blocks") or []),
                },
            })

            # Parse blocks for ontology_query references
            for block in (func.get("blocks") or []):
                cfg = block.get("config") or {}
                ot_id = cfg.get("object_type_id") or cfg.get("objectTypeId")
                if ot_id and str(ot_id) in ot_ids:
                    edge_id = f"objecttype:{ot_id}→logic:{func['id']}"
                    if not any(e["id"] == edge_id for e in edges):
                        edges.append({
                            "id": edge_id,
                            "source": f"objecttype:{ot_id}",
                            "target": nid,
                            "label": "queried by",
                        })

        for flow in logic_flows:
            nid = f"logic:{flow['id']}"
            if str(flow['id']) not in logic_ids:
                logic_ids.add(str(flow['id']))
                nodes.append({
                    "id": nid,
                    "type": "logic_function",
                    "label": flow.get("name", "Logic Flow"),
                    "status": flow.get("status", "active"),
                    "meta": {
                        "id": flow["id"],
                        "name": flow.get("name"),
                        "status": flow.get("status"),
                        "is_flow": True,
                    },
                })

        # ── Layer 5: Agents ───────────────────────────────────────────────────
        agent_ids = set()
        for a in agents:
            nid = f"agent:{a['id']}"
            agent_ids.add(str(a['id']))
            nodes.append({
                "id": nid,
                "type": "agent",
                "label": a.get("name", "Agent"),
                "status": "enabled" if a.get("enabled", True) else "disabled",
                "meta": {
                    "id": a["id"],
                    "name": a.get("name"),
                    "enabled": a.get("enabled", True),
                    "tool_count": len(a.get("tools") or []),
                    "model": a.get("model"),
                },
            })

            # ObjectType → Agent (knowledge scope)
            raw_scope = a.get("knowledge_scope") or {}
            scope = raw_scope if isinstance(raw_scope, dict) else {}
            for ot_id in (scope.get("object_type_ids") or []):
                if str(ot_id) in ot_ids:
                    edges.append({
                        "id": f"objecttype:{ot_id}→agent:{a['id']}",
                        "source": f"objecttype:{ot_id}",
                        "target": nid,
                        "label": "in scope",
                    })

        # ── Layer 6: Actions ──────────────────────────────────────────────────
        for action in actions:
            nid = f"action:{action['id']}"
            nodes.append({
                "id": nid,
                "type": "action",
                "label": action.get("name", "Action"),
                "status": "active",
                "meta": {
                    "id": action["id"],
                    "name": action.get("name"),
                    "pending_count": action.get("pending_count", 0),
                    "writes_to": action.get("writes_to_object_type"),
                },
            })

            # Action → ObjectType (writes to)
            wt = action.get("writes_to_object_type")
            if wt and str(wt) in ot_ids:
                edges.append({
                    "id": f"action:{action['id']}→objecttype:{wt}",
                    "source": nid,
                    "target": f"objecttype:{wt}",
                    "label": "writes to",
                })

        return {
            "nodes": nodes,
            "edges": edges,
            "counts": {
                "connectors": len(connectors),
                "pipelines": len(pipelines),
                "object_types": len(object_types),
                "logic_functions": len(logic_funcs) + len(logic_flows),
                "agents": len(agents),
                "actions": len(actions),
            },
        }
