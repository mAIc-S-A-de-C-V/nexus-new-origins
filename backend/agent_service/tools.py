"""
Agent tool implementations — each tool is callable by the agentic loop.
Tools communicate with other Nexus microservices.
"""
import os
import json
from typing import Any
import httpx

ONTOLOGY_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
LOGIC_URL = os.environ.get("LOGIC_SERVICE_URL", "http://logic-service:8012")


# ── Tool definitions (sent to Claude as tools=[...]) ─────────────────────────

TOOL_DEFINITIONS = {
    "ontology_search": {
        "name": "ontology_search",
        "description": "Search for records of a specific object type in the ontology. Use this to look up entities like Deals, Contacts, Companies, etc.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type": {
                    "type": "string",
                    "description": "The name or displayName of the object type to search (e.g. 'Deal', 'Contact')",
                },
                "filter": {
                    "type": "string",
                    "description": "Optional simple filter expression like 'status == Closed Won' or 'owner == Alice'",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max number of records to return (default 10)",
                    "default": 10,
                },
            },
            "required": ["object_type"],
        },
    },
    "list_object_types": {
        "name": "list_object_types",
        "description": "List all available object types in the ontology. Use this to discover what data exists.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "logic_function_run": {
        "name": "logic_function_run",
        "description": "Execute a Logic Function by name with given inputs. Logic Functions are pre-built LLM workflows for specific tasks.",
        "input_schema": {
            "type": "object",
            "properties": {
                "function_name": {
                    "type": "string",
                    "description": "The name of the Logic Function to run",
                },
                "inputs": {
                    "type": "object",
                    "description": "Key-value inputs for the function",
                },
            },
            "required": ["function_name", "inputs"],
        },
    },
    "action_propose": {
        "name": "action_propose",
        "description": "Propose a write action to be performed on the ontology. If the action requires_confirmation, it will be queued for human approval.",
        "input_schema": {
            "type": "object",
            "properties": {
                "action_name": {
                    "type": "string",
                    "description": "The name of the action to execute (e.g. 'updateDealStage')",
                },
                "inputs": {
                    "type": "object",
                    "description": "Parameters for the action",
                },
                "reasoning": {
                    "type": "string",
                    "description": "Explanation of why this action is being proposed",
                },
            },
            "required": ["action_name", "inputs"],
        },
    },
    "list_actions": {
        "name": "list_actions",
        "description": "List all available actions that can be proposed or executed.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
}


def get_tool_definitions(enabled_tools: list[str]) -> list[dict]:
    """Return Claude tool definitions filtered to agent's enabled tools."""
    return [TOOL_DEFINITIONS[t] for t in enabled_tools if t in TOOL_DEFINITIONS]


# ── Tool executors ────────────────────────────────────────────────────────────

async def execute_tool(
    tool_name: str,
    tool_input: dict[str, Any],
    tenant_id: str,
    agent_id: str,
) -> Any:
    """Dispatch a tool call to the appropriate service and return the result."""
    headers = {"x-tenant-id": tenant_id, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            if tool_name == "ontology_search":
                object_type = tool_input.get("object_type", "")
                limit = tool_input.get("limit", 10)
                raw_filter = tool_input.get("filter", "")

                # Resolve object type ID
                r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
                ot_list = r.json() if r.is_success else []
                ot = next(
                    (o for o in ot_list if o.get("name") == object_type or o.get("displayName") == object_type),
                    None,
                )
                if not ot:
                    return {"error": f"Object type '{object_type}' not found"}

                r2 = await client.get(
                    f"{ONTOLOGY_URL}/object-types/{ot['id']}/records",
                    params={"limit": limit},
                    headers=headers,
                )
                data = r2.json() if r2.is_success else {}
                records = data.get("records", [])

                # Simple in-memory filter
                if raw_filter:
                    import re
                    m = re.match(r'(\w+)\s*==\s*(.+)', raw_filter.strip())
                    if m:
                        field, value = m.group(1), m.group(2).strip().strip('"\'')
                        records = [rec for rec in records if str(rec.get(field, "")) == value]

                return {"records": records[:limit], "count": len(records), "object_type": object_type}

            elif tool_name == "list_object_types":
                r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
                types = r.json() if r.is_success else []
                return {"object_types": [{"id": t["id"], "name": t.get("name"), "displayName": t.get("displayName")} for t in types]}

            elif tool_name == "logic_function_run":
                function_name = tool_input.get("function_name", "")
                inputs = tool_input.get("inputs", {})

                # Find function by name
                r = await client.get(f"{LOGIC_URL}/logic/functions", headers=headers)
                functions = r.json() if r.is_success else []
                fn = next((f for f in functions if f.get("name") == function_name), None)
                if not fn:
                    return {"error": f"Logic function '{function_name}' not found"}

                # Run synchronously
                r2 = await client.post(
                    f"{LOGIC_URL}/logic/functions/{fn['id']}/run/sync",
                    json={"inputs": inputs, "triggered_by": f"agent:{agent_id}"},
                    headers=headers,
                    timeout=60,
                )
                return r2.json() if r2.is_success else {"error": r2.text}

            elif tool_name == "action_propose":
                action_name = tool_input.get("action_name", "")
                inputs = tool_input.get("inputs", {})
                reasoning = tool_input.get("reasoning", "")

                r = await client.post(
                    f"{ONTOLOGY_URL}/actions/{action_name}/execute",
                    json={
                        "inputs": inputs,
                        "executed_by": f"agent:{agent_id}",
                        "source": "agent",
                        "source_id": agent_id,
                        "reasoning": reasoning,
                    },
                    headers=headers,
                )
                return r.json() if r.is_success else {"error": r.text}

            elif tool_name == "list_actions":
                r = await client.get(f"{ONTOLOGY_URL}/actions", headers=headers)
                actions = r.json() if r.is_success else []
                return {
                    "actions": [
                        {
                            "name": a.get("name"),
                            "description": a.get("description"),
                            "requires_confirmation": a.get("requires_confirmation"),
                            "input_schema": a.get("input_schema"),
                        }
                        for a in actions
                        if a.get("enabled")
                    ]
                }

            else:
                return {"error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"error": str(e)}
