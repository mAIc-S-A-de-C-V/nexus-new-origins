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
    "process_mining": {
        "name": "process_mining",
        "description": "Analyze event logs and process data to discover patterns, bottlenecks, anomalies, and deviations. Use this to understand how processes actually execute vs. how they should, find where cases get stuck, detect unusual sequences, or identify co-occurring events.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type": {
                    "type": "string",
                    "description": "The object type containing event/activity records (e.g. 'Event', 'ActivityLog', 'Deal')",
                },
                "case_id_field": {
                    "type": "string",
                    "description": "Field name that groups events into cases/traces (e.g. 'deal_id', 'case_id', 'company')",
                },
                "activity_field": {
                    "type": "string",
                    "description": "Field name containing the activity/event name (e.g. 'status', 'activity', 'stage')",
                },
                "timestamp_field": {
                    "type": "string",
                    "description": "Field name with the event timestamp (e.g. 'created_at', 'timestamp')",
                    "default": "created_at",
                },
                "analysis_type": {
                    "type": "string",
                    "enum": ["frequency", "bottleneck", "anomaly", "cooccurrence", "full"],
                    "description": "Type of analysis: frequency=most common paths, bottleneck=slow transitions, anomaly=unusual sequences, cooccurrence=events that often happen together, full=all analyses",
                    "default": "full",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max records to fetch for analysis (default 500)",
                    "default": 500,
                },
            },
            "required": ["object_type", "case_id_field", "activity_field"],
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

            elif tool_name == "process_mining":
                object_type = tool_input.get("object_type", "")
                case_id_field = tool_input.get("case_id_field", "id")
                activity_field = tool_input.get("activity_field", "status")
                timestamp_field = tool_input.get("timestamp_field", "created_at")
                analysis_type = tool_input.get("analysis_type", "full")
                limit = tool_input.get("limit", 500)

                # Resolve object type
                r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
                ot_list = r.json() if r.is_success else []
                ot = next(
                    (o for o in ot_list if o.get("name") == object_type or o.get("displayName") == object_type),
                    None,
                )
                if not ot:
                    return {"error": f"Object type '{object_type}' not found"}

                if knowledge_scope is not None and ot["id"] not in scope_by_id:
                    return {"error": f"Object type '{object_type}' is outside this agent's data scope."}

                r2 = await client.get(
                    f"{ONTOLOGY_URL}/object-types/{ot['id']}/records",
                    params={"limit": limit},
                    headers=headers,
                )
                data = r2.json() if r2.is_success else {}
                records = data.get("records", [])

                if not records:
                    return {"error": "No records found for process mining analysis."}

                # Build traces: group by case_id_field, sort by timestamp
                from collections import defaultdict, Counter
                traces: dict[str, list] = defaultdict(list)
                for rec in records:
                    case_val = str(rec.get(case_id_field, "unknown"))
                    activity_val = str(rec.get(activity_field, "unknown"))
                    ts_val = rec.get(timestamp_field, "")
                    traces[case_val].append({"activity": activity_val, "ts": ts_val, "record": rec})

                # Sort events within each trace by timestamp
                for case_val in traces:
                    traces[case_val].sort(key=lambda x: x["ts"])

                result: dict[str, Any] = {
                    "total_cases": len(traces),
                    "total_events": len(records),
                    "object_type": object_type,
                }

                if analysis_type in ("frequency", "full"):
                    # Most common activity sequences (paths)
                    path_counter: Counter = Counter()
                    activity_counter: Counter = Counter()
                    for case_events in traces.values():
                        path = " → ".join(e["activity"] for e in case_events)
                        path_counter[path] += 1
                        for e in case_events:
                            activity_counter[e["activity"]] += 1
                    result["top_paths"] = [{"path": p, "count": c} for p, c in path_counter.most_common(10)]
                    result["activity_frequency"] = [{"activity": a, "count": c} for a, c in activity_counter.most_common(20)]

                if analysis_type in ("anomaly", "full"):
                    # Anomalies: cases with unusual number of events or rare paths
                    event_counts = [len(v) for v in traces.values()]
                    avg_events = sum(event_counts) / len(event_counts) if event_counts else 0
                    std_dev = (sum((x - avg_events) ** 2 for x in event_counts) / len(event_counts)) ** 0.5 if event_counts else 0
                    threshold = avg_events + 2 * std_dev
                    anomalous_cases = [
                        {"case_id": k, "event_count": len(v), "activities": [e["activity"] for e in v]}
                        for k, v in traces.items()
                        if len(v) > threshold
                    ]
                    result["anomalies"] = {
                        "avg_events_per_case": round(avg_events, 1),
                        "std_dev": round(std_dev, 1),
                        "anomalous_threshold": round(threshold, 1),
                        "anomalous_cases": anomalous_cases[:10],
                    }

                if analysis_type in ("cooccurrence", "full"):
                    # Activity pairs that frequently occur together in same case
                    pair_counter: Counter = Counter()
                    for case_events in traces.values():
                        activities_in_case = list({e["activity"] for e in case_events})
                        for i in range(len(activities_in_case)):
                            for j in range(i + 1, len(activities_in_case)):
                                pair = tuple(sorted([activities_in_case[i], activities_in_case[j]]))
                                pair_counter[pair] += 1
                    result["cooccurrence"] = [
                        {"pair": list(p), "count": c}
                        for p, c in pair_counter.most_common(10)
                    ]

                if analysis_type in ("bottleneck", "full"):
                    # Transitions that have many cases passing through (proxy for bottleneck)
                    transition_counter: Counter = Counter()
                    for case_events in traces.values():
                        for i in range(len(case_events) - 1):
                            transition = f"{case_events[i]['activity']} → {case_events[i+1]['activity']}"
                            transition_counter[transition] += 1
                    result["bottleneck_transitions"] = [
                        {"transition": t, "count": c}
                        for t, c in transition_counter.most_common(10)
                    ]

                return result

            else:
                return {"error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"error": str(e)}
