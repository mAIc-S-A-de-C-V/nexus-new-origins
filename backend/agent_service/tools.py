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
AGENT_URL = os.environ.get("AGENT_SERVICE_URL", "http://agent-service:8013")


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
    "agent_call": {
        "name": "agent_call",
        "description": "Call another configured agent by name to handle a subtask. Use this when a specialized agent can better answer part of the request.",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_name": {
                    "type": "string",
                    "description": "The exact name of the agent to call (as shown in Agent Studio)",
                },
                "message": {
                    "type": "string",
                    "description": "The message or task to send to the sub-agent",
                },
            },
            "required": ["agent_name", "message"],
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
    knowledge_scope: list[dict] | None = None,
    dry_run: bool = False,
) -> Any:
    """Dispatch a tool call to the appropriate service and return the result.

    knowledge_scope: None = unrestricted. List = restricted to those object_type_ids.
    dry_run: True = action_propose returns a simulated result without writing. agent_call is skipped.
    """
    headers = {"x-tenant-id": tenant_id, "Content-Type": "application/json"}

    # Build a quick lookup: object_type_id -> scope entry (for filter enforcement)
    scope_by_id: dict[str, dict] = {}
    if knowledge_scope is not None:
        for entry in knowledge_scope:
            scope_by_id[entry["object_type_id"]] = entry

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

                # Enforce knowledge scope
                if knowledge_scope is not None and ot["id"] not in scope_by_id:
                    allowed = [e.get("label", e["object_type_id"]) for e in knowledge_scope]
                    return {"error": f"Object type '{object_type}' is outside this agent's data scope. Allowed types: {', '.join(allowed)}"}

                r2 = await client.get(
                    f"{ONTOLOGY_URL}/object-types/{ot['id']}/records",
                    params={"limit": max(limit * 5, 100)},
                    headers=headers,
                )
                data = r2.json() if r2.is_success else {}
                records = data.get("records", [])

                # Apply scope-level filter if defined
                scope_entry = scope_by_id.get(ot["id"], {})
                scope_filter = scope_entry.get("filter")
                if scope_filter:
                    sf, sop, sv = scope_filter.get("field"), scope_filter.get("op"), str(scope_filter.get("value", ""))
                    if sf and sop:
                        if sop in ("==", "="):
                            records = [rec for rec in records if str(rec.get(sf, "")) == sv]
                        elif sop == "!=":
                            records = [rec for rec in records if str(rec.get(sf, "")) != sv]

                # Apply user-specified filter on top
                if raw_filter:
                    import re
                    m = re.match(r'(\w+)\s*==\s*(.+)', raw_filter.strip())
                    if m:
                        field, value = m.group(1), m.group(2).strip().strip('"\'')
                        records = [rec for rec in records if str(rec.get(field, "")) == value]

                return {"records": records[:limit], "count": len(records), "object_type": object_type}

            elif tool_name == "list_object_types":
                r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
                all_types = r.json() if r.is_success else []
                # Filter to scope if restricted
                if knowledge_scope is not None:
                    all_types = [t for t in all_types if t["id"] in scope_by_id]
                return {"object_types": [{"id": t["id"], "name": t.get("name"), "displayName": t.get("displayName")} for t in all_types]}

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

                if dry_run:
                    return {
                        "dry_run": True,
                        "would_execute": {"action": action_name, "inputs": inputs, "reasoning": reasoning},
                        "note": "Dry run — no changes written. In production this would create a pending_confirmation proposal.",
                    }

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

            elif tool_name == "agent_call":
                if dry_run:
                    return {"dry_run": True, "note": "agent_call skipped in dry run mode"}
                agent_name = tool_input.get("agent_name", "")
                message = tool_input.get("message", "")

                # Look up the sub-agent by name
                r = await client.get(f"{AGENT_URL}/agents", headers=headers)
                agents = r.json() if r.is_success else []
                sub_agent = next((a for a in agents if a.get("name") == agent_name), None)
                if not sub_agent:
                    return {"error": f"Agent '{agent_name}' not found. Available: {[a.get('name') for a in agents]}"}

                # Run sub-agent (one-shot, no thread)
                r2 = await client.post(
                    f"{AGENT_URL}/agents/{sub_agent['id']}/test",
                    json={"message": message, "dry_run": False},
                    headers=headers,
                    timeout=120,
                )
                result = r2.json() if r2.is_success else {"error": r2.text}
                return {"agent": agent_name, "response": result.get("final_text", ""), "iterations": result.get("iterations", 0)}

            else:
                return {"error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"error": str(e)}
