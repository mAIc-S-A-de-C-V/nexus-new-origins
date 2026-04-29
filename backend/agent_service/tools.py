"""
Agent tool implementations — each tool is callable by the agentic loop.
Tools communicate with other Nexus microservices.
"""
import os
import json
from typing import Any
import httpx

ONTOLOGY_URL   = os.environ.get("ONTOLOGY_SERVICE_URL",   "http://ontology-service:8004")
ANALYTICS_URL  = os.environ.get("ANALYTICS_SERVICE_URL",  "http://analytics-service:8015")
LOGIC_URL      = os.environ.get("LOGIC_SERVICE_URL",      "http://logic-service:8012")
AGENT_URL      = os.environ.get("AGENT_SERVICE_URL",      "http://agent-service:8013")
UTILITY_URL    = os.environ.get("UTILITY_SERVICE_URL",    "http://utility-service:8014")
PIPELINE_URL   = os.environ.get("PIPELINE_SERVICE_URL",   "http://pipeline-service:8002")
CONNECTOR_URL  = os.environ.get("CONNECTOR_SERVICE_URL",  "http://connector-service:8001")
PROCESS_URL    = os.environ.get("PROCESS_ENGINE_URL",     "http://process-engine-service:8009")


# ── Tool definitions (sent to Claude as tools=[...]) ─────────────────────────

TOOL_DEFINITIONS = {
    "list_object_types": {
        "name": "list_object_types",
        "description": "List all available object types in the ontology. Use this to discover what data exists before querying.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "get_object_schema": {
        "name": "get_object_schema",
        "description": (
            "Get the field schema and a tiny sample (3–5 rows) for one object type. "
            "Call this BEFORE query_records or count_records so you know the exact field names. "
            "Never pass raw record data back in your reasoning — use it only to understand the schema."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type": {
                    "type": "string",
                    "description": "Name or displayName of the object type (e.g. 'Patient', 'SepsisEvent')",
                },
            },
            "required": ["object_type"],
        },
    },
    "query_records": {
        "name": "query_records",
        "description": (
            "Execute a structured query against an object type. "
            "You specify filters, optional aggregation, and optional group-by; "
            "the system runs the query server-side and returns only the result. "
            "Use count_records for totals. Use this for filtered lists or aggregated breakdowns. "
            "NEVER use this to dump all records — always filter or aggregate."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type": {
                    "type": "string",
                    "description": "Name or displayName of the object type to query",
                },
                "filters": {
                    "type": "array",
                    "description": "List of filter conditions. Each item: {field, op, value}. op options: eq, neq, gt, gte, lt, lte, contains, starts_with",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "op": {"type": "string", "enum": ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with"]},
                            "value": {"type": "string"},
                        },
                        "required": ["field", "op", "value"],
                    },
                    "default": [],
                },
                "aggregate": {
                    "type": "object",
                    "description": "Optional aggregation: {function: COUNT|SUM|AVG|MIN|MAX, field: fieldName or *}",
                    "properties": {
                        "function": {"type": "string", "enum": ["COUNT", "SUM", "AVG", "MIN", "MAX"]},
                        "field": {"type": "string"},
                    },
                },
                "group_by": {
                    "type": "string",
                    "description": "Optional field name to group results by (use with aggregate)",
                },
                "order_by": {
                    "type": "object",
                    "description": "Optional sort: {field, direction: asc|desc}",
                    "properties": {
                        "field": {"type": "string"},
                        "direction": {"type": "string", "enum": ["asc", "desc"]},
                    },
                },
                "select_fields": {
                    "type": "array",
                    "description": "Optional list of field names to return. Omit to return all fields.",
                    "items": {"type": "string"},
                    "default": [],
                },
                "limit": {
                    "type": "integer",
                    "description": "Max rows to return (default 50, max 200)",
                    "default": 50,
                },
            },
            "required": ["object_type"],
        },
    },
    "count_records": {
        "name": "count_records",
        "description": (
            "Count records for an object type, with optional filters. "
            "Use this whenever you need a total — do NOT use query_records just to count."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type": {
                    "type": "string",
                    "description": "Name or displayName of the object type",
                },
                "filters": {
                    "type": "array",
                    "description": "Optional filter conditions (same format as query_records filters)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "op": {"type": "string"},
                            "value": {"type": "string"},
                        },
                        "required": ["field", "op", "value"],
                    },
                    "default": [],
                },
            },
            "required": ["object_type"],
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
    "query_process": {
        "name": "query_process",
        "description": (
            "Query a defined cross-object process for stats, top variants, and bottlenecks. "
            "Use this when the user asks about a process that spans multiple object types "
            "(e.g. 'how does the patient journey usually go', 'where do loan applications get stuck'). "
            "Call list_processes_v2 first if you don't know the process_id."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "process_id": {"type": "string", "description": "Process definition ID"},
                "include": {
                    "type": "array",
                    "items": {"type": "string", "enum": ["stats", "variants", "bottlenecks"]},
                    "description": "Which sections to include. Defaults to all.",
                },
                "variant_limit": {"type": "integer", "default": 5},
                "bottleneck_limit": {"type": "integer", "default": 5},
            },
            "required": ["process_id"],
        },
    },
    "list_processes_v2": {
        "name": "list_processes_v2",
        "description": (
            "List defined cross-object processes (object-centric process mining). "
            "Returns id, name, included object types, case_key_attribute, is_implicit. "
            "Implicit processes are auto-generated single-object placeholders."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "include_implicit": {"type": "boolean", "default": False},
            },
            "required": [],
        },
    },
    "find_object_touchpoints": {
        "name": "find_object_touchpoints",
        "description": (
            "Return every event that touched a specific object instance — across all object types and pipelines. "
            "Includes events emitted directly from this object's pipeline AND events from other objects "
            "that referenced this one (OCEL multi-object events). Use this for 'what happened with X' "
            "or 'show me the full history of patient/claim/loan Y' questions."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string"},
                "object_id": {"type": "string"},
                "limit": {"type": "integer", "default": 200},
            },
            "required": ["object_type_id", "object_id"],
        },
    },
    "utility_run": {
        "name": "utility_run",
        "description": "Run a pre-built utility from the Nexus Utility Library. Available utilities include: ocr_extract (image→text), pdf_extract (PDF→text), excel_parse (spreadsheet→rows), web_scrape (webpage→text), rss_fetch (RSS feed→items), http_request (HTTP call), webhook_post (POST to webhook), geocode (address→lat/lng), qr_read (QR/barcode→text), slack_notify (send Slack message). Call utility_list first if unsure which utility to use.",
        "input_schema": {
            "type": "object",
            "properties": {
                "utility_id": {
                    "type": "string",
                    "description": "ID of the utility to run. Examples: ocr_extract, pdf_extract, excel_parse, web_scrape, rss_fetch, http_request, webhook_post, geocode, qr_read, slack_notify",
                },
                "inputs": {
                    "type": "object",
                    "description": "Input parameters for the utility. Each utility has different required/optional params. Check utility_list for details.",
                },
            },
            "required": ["utility_id", "inputs"],
        },
    },
    "utility_list": {
        "name": "utility_list",
        "description": "List all available utilities in the Nexus Utility Library with their input/output schemas. Call this to discover what utilities are available before calling utility_run.",
        "input_schema": {
            "type": "object",
            "properties": {
                "category": {
                    "type": "string",
                    "description": "Optional filter by category: Document, Web, Vision, Geo, Notify",
                },
            },
            "required": [],
        },
    },
    "list_connectors": {
        "name": "list_connectors",
        "description": "List all configured connectors (data sources) in the platform. Returns id, name, type, status, category for each connector. Use this to find connector IDs when building pipelines.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "list_pipelines": {
        "name": "list_pipelines",
        "description": "List all existing pipelines. Returns id, name, status, node count, last run info for each pipeline.",
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    "create_pipeline": {
        "name": "create_pipeline",
        "description": (
            "Create a new data pipeline with a chain of processing nodes. "
            "IMPORTANT: Before calling this tool, ALWAYS present the pipeline plan to the user and ask for confirmation. "
            "Only call this tool after the user explicitly confirms. "
            "Available node types: SOURCE, FILTER, MAP, CAST, ENRICH, FLATTEN, DEDUPE, VALIDATE, LLM_CLASSIFY, SINK_OBJECT, SINK_EVENT, AGENT_RUN. "
            "Each node needs a type, label, and config object. Edges connect nodes in order (source→target by node ID)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "Pipeline name",
                },
                "description": {
                    "type": "string",
                    "description": "What this pipeline does",
                },
                "nodes": {
                    "type": "array",
                    "description": "Ordered list of pipeline nodes",
                    "items": {
                        "type": "object",
                        "properties": {
                            "type": {
                                "type": "string",
                                "description": "Node type: SOURCE, FILTER, MAP, LLM_CLASSIFY, SINK_OBJECT, SINK_EVENT, AGENT_RUN, etc.",
                            },
                            "label": {
                                "type": "string",
                                "description": "Human-readable node label",
                            },
                            "config": {
                                "type": "object",
                                "description": (
                                    "Node configuration. Key fields per type: "
                                    "SOURCE: {connectorId}. "
                                    "FILTER: {field, operator, value}. "
                                    "MAP: {mappings: {from: to}}. "
                                    "LLM_CLASSIFY: {textField, prompt (optional), model, batchSize, createActions}. "
                                    "SINK_OBJECT: {objectTypeId}. "
                                    "SINK_EVENT: {activityField, caseIdField, timestampField, objectTypeId}. "
                                    "AGENT_RUN: {agentId, prompt}."
                                ),
                            },
                            "connector_id": {
                                "type": "string",
                                "description": "Connector ID (for SOURCE nodes)",
                            },
                            "object_type_id": {
                                "type": "string",
                                "description": "Object type ID (for SINK nodes)",
                            },
                        },
                        "required": ["type", "label"],
                    },
                },
                "connector_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of connector IDs used by this pipeline",
                },
                "target_object_type_id": {
                    "type": "string",
                    "description": "Target object type ID for the pipeline output",
                },
            },
            "required": ["name", "nodes"],
        },
    },
    "run_pipeline": {
        "name": "run_pipeline",
        "description": "Run/execute an existing pipeline by ID. Returns the run status. IMPORTANT: Ask for user confirmation before running.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {
                    "type": "string",
                    "description": "The pipeline ID to run",
                },
            },
            "required": ["pipeline_id"],
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
            # ── Shared helper: resolve object type name → {id, name, displayName} ──
            async def _resolve_ot(object_type: str) -> dict | None:
                r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
                ot_list = r.json() if r.is_success else []
                return next(
                    (o for o in ot_list if o.get("name") == object_type or o.get("displayName") == object_type),
                    None,
                )

            if tool_name == "list_object_types":
                r = await client.get(f"{ONTOLOGY_URL}/object-types", headers=headers)
                all_types = r.json() if r.is_success else []
                if knowledge_scope is not None:
                    all_types = [t for t in all_types if t["id"] in scope_by_id]
                # Include record_count from analytics so Claude can prioritize which types to inspect
                result_types = []
                for t in all_types:
                    entry: dict[str, Any] = {"id": t["id"], "name": t.get("name"), "displayName": t.get("displayName")}
                    try:
                        rf = await client.get(
                            f"{ANALYTICS_URL}/explore/object-types/{t['id']}/fields",
                            headers=headers,
                            timeout=5,
                        )
                        if rf.is_success:
                            entry["record_count"] = rf.json().get("record_count", 0)
                    except Exception:
                        pass
                    result_types.append(entry)
                return {"object_types": result_types}

            elif tool_name == "get_object_schema":
                object_type = tool_input.get("object_type", "")
                ot = await _resolve_ot(object_type)
                if not ot:
                    return {"error": f"Object type '{object_type}' not found. Call list_object_types first."}

                if knowledge_scope is not None and ot["id"] not in scope_by_id:
                    allowed = [e.get("label", e["object_type_id"]) for e in knowledge_scope]
                    return {"error": f"Object type '{object_type}' is outside this agent's data scope. Allowed: {', '.join(allowed)}"}

                # Get fields from analytics service
                ana_headers = {**headers}
                r_fields = await client.get(
                    f"{ANALYTICS_URL}/explore/object-types/{ot['id']}/fields",
                    headers=ana_headers,
                )
                fields_data = r_fields.json() if r_fields.is_success else {}
                fields = fields_data.get("fields", [])
                record_count = fields_data.get("record_count", 0)

                # Get 3 sample rows
                r_sample = await client.get(
                    f"{ANALYTICS_URL}/explore/object-types/{ot['id']}/sample",
                    params={"limit": 3},
                    headers=ana_headers,
                )
                sample_rows = r_sample.json() if r_sample.is_success else []

                return {
                    "object_type": ot.get("displayName") or ot.get("name"),
                    "object_type_id": ot["id"],
                    "fields": fields,
                    "record_count": record_count,
                    "sample_rows": sample_rows,
                    "note": "Use query_records or count_records to fetch actual data. Do NOT ask for more samples.",
                }

            elif tool_name == "query_records":
                object_type = tool_input.get("object_type", "")
                ot = await _resolve_ot(object_type)
                if not ot:
                    return {"error": f"Object type '{object_type}' not found. Call list_object_types first."}

                if knowledge_scope is not None and ot["id"] not in scope_by_id:
                    allowed = [e.get("label", e["object_type_id"]) for e in knowledge_scope]
                    return {"error": f"Object type '{object_type}' is outside this agent's data scope. Allowed: {', '.join(allowed)}"}

                filters = tool_input.get("filters", [])

                # Inject scope-level filter if defined
                scope_entry = scope_by_id.get(ot["id"], {})
                scope_filter = scope_entry.get("filter")
                if scope_filter and scope_filter.get("field"):
                    op_map = {"==": "eq", "=": "eq", "!=": "neq"}
                    scope_op = op_map.get(scope_filter.get("op", "eq"), scope_filter.get("op", "eq"))
                    filters = [{"field": scope_filter["field"], "op": scope_op, "value": str(scope_filter.get("value", ""))}] + filters

                limit = min(tool_input.get("limit", 50), 200)

                body: dict[str, Any] = {
                    "object_type_id": ot["id"],
                    "filters": filters,
                    "limit": limit,
                    "offset": tool_input.get("offset", 0),
                    "select_fields": tool_input.get("select_fields", []),
                }
                if tool_input.get("aggregate"):
                    body["aggregate"] = tool_input["aggregate"]
                if tool_input.get("group_by"):
                    body["group_by"] = tool_input["group_by"]
                if tool_input.get("order_by"):
                    body["order_by"] = tool_input["order_by"]

                r = await client.post(
                    f"{ANALYTICS_URL}/explore/query",
                    json=body,
                    headers=headers,
                    timeout=30,
                )
                if not r.is_success:
                    return {"error": f"Query failed: {r.text}"}

                result = r.json()
                # result shape: {rows: [...], total: N, ...}
                rows = result.get("rows", result if isinstance(result, list) else [])
                total = result.get("total", len(rows))
                return {
                    "rows": rows,
                    "returned": len(rows),
                    "total_matched": total,
                    "object_type": object_type,
                }

            elif tool_name == "count_records":
                object_type = tool_input.get("object_type", "")
                ot = await _resolve_ot(object_type)
                if not ot:
                    return {"error": f"Object type '{object_type}' not found. Call list_object_types first."}

                if knowledge_scope is not None and ot["id"] not in scope_by_id:
                    allowed = [e.get("label", e["object_type_id"]) for e in knowledge_scope]
                    return {"error": f"Object type '{object_type}' is outside this agent's data scope. Allowed: {', '.join(allowed)}"}

                filters = tool_input.get("filters", [])

                scope_entry = scope_by_id.get(ot["id"], {})
                scope_filter = scope_entry.get("filter")
                if scope_filter and scope_filter.get("field"):
                    op_map = {"==": "eq", "=": "eq", "!=": "neq"}
                    scope_op = op_map.get(scope_filter.get("op", "eq"), scope_filter.get("op", "eq"))
                    filters = [{"field": scope_filter["field"], "op": scope_op, "value": str(scope_filter.get("value", ""))}] + filters

                body = {
                    "object_type_id": ot["id"],
                    "filters": filters,
                    "aggregate": {"function": "COUNT", "field": "*"},
                    "limit": 1,
                }
                r = await client.post(
                    f"{ANALYTICS_URL}/explore/query",
                    json=body,
                    headers=headers,
                    timeout=30,
                )
                if not r.is_success:
                    return {"error": f"Count query failed: {r.text}"}

                result = r.json()
                # analytics /explore/query with aggregate returns {rows:[{agg_value:N}], total:N}
                rows = result.get("rows", result if isinstance(result, list) else [])
                if rows and isinstance(rows[0], dict):
                    count = rows[0].get("agg_value", rows[0].get("count", result.get("total", 0)))
                else:
                    count = result.get("total", 0)

                return {"total": int(count), "object_type": object_type}

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
                    params={"limit": min(limit, 500)},
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

            elif tool_name == "list_processes_v2":
                include_implicit = bool(tool_input.get("include_implicit", False))
                r = await client.get(
                    f"{PROCESS_URL}/process/processes",
                    params={"include_implicit": str(include_implicit).lower()},
                    headers=headers,
                )
                if not r.is_success:
                    return {"error": f"process service error: {r.status_code}"}
                items = r.json()
                return {
                    "count": len(items),
                    "processes": [
                        {
                            "id": p["id"], "name": p["name"],
                            "included_object_type_ids": p["included_object_type_ids"],
                            "case_key_attribute": p.get("case_key_attribute"),
                            "is_implicit": p.get("is_implicit", False),
                            "description": p.get("description"),
                        }
                        for p in items
                    ],
                }

            elif tool_name == "query_process":
                process_id = tool_input.get("process_id", "")
                if not process_id:
                    return {"error": "process_id required"}
                include = tool_input.get("include") or ["stats", "variants", "bottlenecks"]
                vlim = int(tool_input.get("variant_limit", 5))
                blim = int(tool_input.get("bottleneck_limit", 5))
                out: dict[str, Any] = {"process_id": process_id}

                if "stats" in include:
                    r = await client.get(f"{PROCESS_URL}/process/by-process/stats/{process_id}", headers=headers)
                    if r.is_success:
                        out["stats"] = r.json()
                if "variants" in include:
                    r = await client.get(
                        f"{PROCESS_URL}/process/by-process/variants/{process_id}",
                        params={"limit": vlim}, headers=headers,
                    )
                    if r.is_success:
                        v = r.json()
                        out["variants"] = {
                            "total_cases": v.get("total_cases"),
                            "spans_objects": v.get("spans_objects"),
                            "top": v.get("variants", []),
                        }
                if "bottlenecks" in include:
                    r = await client.get(
                        f"{PROCESS_URL}/process/by-process/bottlenecks/{process_id}",
                        params={"top_n": blim}, headers=headers,
                    )
                    if r.is_success:
                        out["bottlenecks"] = r.json().get("bottlenecks", [])
                return out

            elif tool_name == "find_object_touchpoints":
                otid = tool_input.get("object_type_id", "")
                oid = tool_input.get("object_id", "")
                lim = int(tool_input.get("limit", 200))
                if not otid or not oid:
                    return {"error": "object_type_id and object_id required"}
                r = await client.get(
                    f"{PROCESS_URL}/process/by-process/by-object-instance/{otid}/{oid}/touchpoints",
                    params={"limit": lim}, headers=headers,
                )
                if not r.is_success:
                    return {"error": f"process service error: {r.status_code}"}
                data = r.json()
                # Trim attributes blob from each event to keep token cost down
                for e in data.get("events", []):
                    attrs = e.get("attributes") or {}
                    e["attributes_summary"] = {
                        k: attrs.get(k) for k in ("case_key", "process_id", "related_objects")
                        if k in attrs
                    }
                    e.pop("attributes", None)
                return data

            elif tool_name == "utility_list":
                category = tool_input.get("category")
                r = await client.get(f"{UTILITY_URL}/utilities", headers=headers, timeout=10)
                utilities = r.json() if r.is_success else []
                if category:
                    utilities = [u for u in utilities if u.get("category", "").lower() == category.lower()]
                return {"utilities": utilities, "count": len(utilities)}

            elif tool_name == "utility_run":
                utility_id = tool_input.get("utility_id", "")
                inputs = tool_input.get("inputs", {})
                if not utility_id:
                    return {"error": "utility_id is required"}
                r = await client.post(
                    f"{UTILITY_URL}/utilities/{utility_id}/run",
                    json={"inputs": inputs},
                    headers=headers,
                    timeout=60,
                )
                data = r.json() if r.is_success else {"error": r.text}
                return data.get("result", data) if isinstance(data, dict) else data

            elif tool_name == "list_connectors":
                r = await client.get(f"{CONNECTOR_URL}/connectors", headers=headers)
                connectors = r.json() if r.is_success else []
                return {
                    "connectors": [
                        {
                            "id": c.get("id"),
                            "name": c.get("name"),
                            "type": c.get("type"),
                            "category": c.get("category"),
                            "status": c.get("status"),
                            "description": c.get("description", ""),
                        }
                        for c in connectors
                    ],
                    "count": len(connectors),
                }

            elif tool_name == "list_pipelines":
                r = await client.get(f"{PIPELINE_URL}/pipelines", headers=headers)
                pipelines = r.json() if r.is_success else []
                return {
                    "pipelines": [
                        {
                            "id": p.get("id"),
                            "name": p.get("name"),
                            "status": p.get("status"),
                            "node_count": len(p.get("nodes", [])),
                            "last_run_at": p.get("last_run_at"),
                            "last_run_row_count": p.get("last_run_row_count"),
                        }
                        for p in pipelines
                    ],
                    "count": len(pipelines),
                }

            elif tool_name == "create_pipeline":
                from uuid import uuid4 as _uuid4
                name = tool_input.get("name", "Untitled Pipeline")
                description = tool_input.get("description", "")
                raw_nodes = tool_input.get("nodes", [])
                connector_ids = tool_input.get("connector_ids", [])
                target_ot_id = tool_input.get("target_object_type_id")

                # Build node objects with IDs and positions
                nodes = []
                for i, n in enumerate(raw_nodes):
                    node_id = str(_uuid4())
                    nodes.append({
                        "id": node_id,
                        "type": n.get("type", "SOURCE"),
                        "label": n.get("label", n.get("type", "Node")),
                        "config": n.get("config", {}),
                        "position": {"x": 100 + i * 260, "y": 200},
                        "connector_id": n.get("connector_id"),
                        "object_type_id": n.get("object_type_id"),
                    })

                # Auto-generate edges connecting nodes in sequence
                edges = []
                for i in range(len(nodes) - 1):
                    edges.append({
                        "id": str(_uuid4()),
                        "source": nodes[i]["id"],
                        "target": nodes[i + 1]["id"],
                        "animated": False,
                    })

                # Infer connector_ids from SOURCE nodes if not provided
                if not connector_ids:
                    connector_ids = [
                        n["config"].get("connectorId") or n.get("connector_id", "")
                        for n in nodes
                        if n["type"] == "SOURCE" and (n["config"].get("connectorId") or n.get("connector_id"))
                    ]

                pipeline_body = {
                    "name": name,
                    "description": description,
                    "status": "DRAFT",
                    "nodes": nodes,
                    "edges": edges,
                    "connector_ids": connector_ids,
                    "target_object_type_id": target_ot_id,
                    "tenant_id": tenant_id,
                }

                r = await client.post(
                    f"{PIPELINE_URL}/pipelines",
                    json=pipeline_body,
                    headers=headers,
                    timeout=15,
                )
                if r.is_success:
                    created = r.json()
                    return {
                        "success": True,
                        "pipeline_id": created.get("id"),
                        "name": created.get("name"),
                        "status": created.get("status"),
                        "node_count": len(nodes),
                        "message": f"Pipeline '{name}' created successfully with {len(nodes)} nodes. Go to Pipelines to review and run it.",
                    }
                else:
                    return {"error": f"Failed to create pipeline: {r.text[:300]}"}

            elif tool_name == "run_pipeline":
                pipeline_id = tool_input.get("pipeline_id", "")
                if not pipeline_id:
                    return {"error": "pipeline_id is required"}
                r = await client.post(
                    f"{PIPELINE_URL}/pipelines/{pipeline_id}/run",
                    headers=headers,
                    timeout=30,
                )
                if r.is_success:
                    return {"success": True, "message": f"Pipeline {pipeline_id} started", "result": r.json()}
                else:
                    return {"error": f"Failed to run pipeline: {r.text[:300]}"}

            else:
                return {"error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"error": str(e)}
