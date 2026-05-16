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
SCRAPING_URL   = os.environ.get("SCRAPING_SERVICE_URL",   "http://scraping-service:8027")


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
    "web_search": {
        "name": "web_search",
        "description": (
            "Search the public web (DuckDuckGo) and return the top organic results "
            "as a list of {url, title, snippet}. Use this to discover candidate "
            "supplier pages, product listings, manufacturer datasheets, etc. "
            "Then call scrape_url on the most promising 2-3 URLs to pull pricing / "
            "spec details. Always cite a real URL in any memo you propose; never "
            "invent suppliers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query — be specific (include manufacturer part number, "
                                   "model, or unambiguous identifier). Avoid vague terms.",
                },
                "max_results": {
                    "type": "integer",
                    "description": "Number of results to return (1-30). Default 10.",
                    "default": 10,
                },
            },
            "required": ["query"],
        },
    },
    "scrape_url": {
        "name": "scrape_url",
        "description": (
            "Fetch a URL and return its main text content (capped) plus optional "
            "selector matches. Use AFTER web_search to extract structured info "
            "like price, availability, lead time, MOQ, supplier name from a "
            "specific page. The text is cleaned and truncated to fit in context. "
            "If the page is JS-rendered or protected by Cloudflare, set "
            "use_stealth=true (slower, only enable on demand). Quote actual page "
            "content in your reasoning — do not paraphrase numbers."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Absolute URL starting with http:// or https://",
                },
                "selector": {
                    "type": "string",
                    "description": "Optional CSS selector to pull specific elements (e.g. '.product-price'). Returns up to 50 matches.",
                },
                "extract_text": {
                    "type": "boolean",
                    "description": "Return cleaned page text (capped at 8000 chars). Default true.",
                    "default": True,
                },
                "extract_links": {
                    "type": "boolean",
                    "description": "Return outbound http(s) links from the page (cap 100). Default false.",
                    "default": False,
                },
                "use_stealth": {
                    "type": "boolean",
                    "description": "Use Camoufox stealth fetcher for sites with bot protection. Slower; only set true if a normal fetch fails.",
                    "default": False,
                },
            },
            "required": ["url"],
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

    # ── Lifecycle: connectors ────────────────────────────────────────────────
    "update_connector": {
        "name": "update_connector",
        "description": "Update a connector's name, description, base_url, headers, or config. Pass only the fields you want to change. ASK FOR CONFIRMATION before destructive changes.",
        "input_schema": {
            "type": "object",
            "properties": {
                "connector_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "base_url": {"type": "string"},
                "config": {"type": "object", "description": "Partial config to merge"},
            },
            "required": ["connector_id"],
        },
    },
    "delete_connector": {
        "name": "delete_connector",
        "description": "Delete a connector permanently. ASK FOR CONFIRMATION FIRST. Pipelines that depend on this connector will break.",
        "input_schema": {
            "type": "object",
            "properties": {"connector_id": {"type": "string"}},
            "required": ["connector_id"],
        },
    },
    "test_connector": {
        "name": "test_connector",
        "description": "Test a connector's credentials and connectivity. Returns success/error and latency. Safe to call any time.",
        "input_schema": {
            "type": "object",
            "properties": {"connector_id": {"type": "string"}},
            "required": ["connector_id"],
        },
    },

    # ── Lifecycle: pipelines ─────────────────────────────────────────────────
    "update_pipeline": {
        "name": "update_pipeline",
        "description": "Update a pipeline's name, description, nodes, or edges. ASK FOR CONFIRMATION before changing structure.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "nodes": {"type": "array", "items": {"type": "object"}},
                "edges": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["pipeline_id"],
        },
    },
    "delete_pipeline": {
        "name": "delete_pipeline",
        "description": "Delete a pipeline. ASK FOR CONFIRMATION. This stops all schedules and triggers attached to it.",
        "input_schema": {
            "type": "object",
            "properties": {"pipeline_id": {"type": "string"}},
            "required": ["pipeline_id"],
        },
    },
    "get_pipeline_runs": {
        "name": "get_pipeline_runs",
        "description": "Fetch the recent run history for a pipeline (status, rows in/out, duration, error if any).",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "limit": {"type": "integer", "default": 20},
            },
            "required": ["pipeline_id"],
        },
    },

    # ── Pipeline schedules ────────────────────────────────────────────────────
    "list_pipeline_schedules": {
        "name": "list_pipeline_schedules",
        "description": "List cron schedules attached to a pipeline.",
        "input_schema": {
            "type": "object",
            "properties": {"pipeline_id": {"type": "string"}},
            "required": ["pipeline_id"],
        },
    },
    "create_pipeline_schedule": {
        "name": "create_pipeline_schedule",
        "description": "Create a recurring cron schedule for a pipeline (e.g. cron='0 */6 * * *' = every 6 hours).",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "name": {"type": "string"},
                "cron_expression": {"type": "string", "description": "Standard 5-field cron"},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["pipeline_id", "cron_expression"],
        },
    },
    "update_pipeline_schedule": {
        "name": "update_pipeline_schedule",
        "description": "Update a pipeline schedule's name/cron/enabled.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "schedule_id": {"type": "string"},
                "name": {"type": "string"},
                "cron_expression": {"type": "string"},
                "enabled": {"type": "boolean"},
            },
            "required": ["pipeline_id", "schedule_id"],
        },
    },
    "delete_pipeline_schedule": {
        "name": "delete_pipeline_schedule",
        "description": "Delete a pipeline schedule.",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "schedule_id": {"type": "string"},
            },
            "required": ["pipeline_id", "schedule_id"],
        },
    },
    "run_pipeline_schedule_now": {
        "name": "run_pipeline_schedule_now",
        "description": "Manually fire a pipeline schedule immediately (does not affect the next scheduled run).",
        "input_schema": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "schedule_id": {"type": "string"},
            },
            "required": ["pipeline_id", "schedule_id"],
        },
    },

    # ── Object types & links ─────────────────────────────────────────────────
    "update_object_type": {
        "name": "update_object_type",
        "description": "Update an object type definition (name, displayName, properties). Snapshots a new version.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string"},
                "name": {"type": "string"},
                "displayName": {"type": "string"},
                "description": {"type": "string"},
                "properties": {"type": "array", "items": {"type": "object"}},
            },
            "required": ["object_type_id"],
        },
    },
    "delete_object_type": {
        "name": "delete_object_type",
        "description": "Delete an object type and all its records and versions. ASK FOR CONFIRMATION — this is destructive.",
        "input_schema": {
            "type": "object",
            "properties": {"object_type_id": {"type": "string"}},
            "required": ["object_type_id"],
        },
    },
    "apply_enrichment": {
        "name": "apply_enrichment",
        "description": "Apply an enrichment proposal to an object type (adds new fields and links from inferred schema).",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string"},
                "proposal": {"type": "object", "description": "EnrichmentProposal payload from inference-service"},
            },
            "required": ["object_type_id", "proposal"],
        },
    },
    "list_ontology_links": {
        "name": "list_ontology_links",
        "description": "List all ontology links (relationships between object types) for the tenant.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "delete_ontology_link": {
        "name": "delete_ontology_link",
        "description": "Delete an ontology link by id.",
        "input_schema": {
            "type": "object",
            "properties": {"link_id": {"type": "string"}},
            "required": ["link_id"],
        },
    },

    # ── Logic functions ──────────────────────────────────────────────────────
    "list_logic_functions": {
        "name": "list_logic_functions",
        "description": "List all logic functions (visual function builder definitions).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "update_logic_function": {
        "name": "update_logic_function",
        "description": (
            "Update a logic function's blocks, name, description, or input schema. Increments version.\n"
            "\n"
            "Every block MUST be fully populated and runnable. Empty fields make the Builder show "
            "placeholder dropdowns and break execution. Use EXACTLY these type strings and field paths.\n"
            "\n"
            "BLOCK CATALOG (note which fields are nested under `config` vs. top-level):\n"
            "\n"
            "1) ontology_query — read or aggregate records. Fields nested under `config`.\n"
            "   List mode:\n"
            "     {\"id\":\"b1\",\"type\":\"ontology_query\",\"label\":\"…\",\n"
            "      \"config\":{\"object_type\":\"<NAME from list_object_types — the `name` field, NOT id, NOT displayName>\",\n"
            "                 \"filters\":[{\"field\":\"<field>\",\"op\":\"==|!=|>|>=|<|<=|contains\",\"value\":\"<v or {inputs.x}>\"}],\n"
            "                 \"limit\":100}}\n"
            "   Aggregate mode (counts/sums/avg/group-by/time-bucket):\n"
            "     {\"id\":\"b1\",\"type\":\"ontology_query\",\"label\":\"…\",\n"
            "      \"config\":{\"object_type\":\"<NAME>\",\"filters\":[…],\n"
            "                 \"aggregate\":{\"group_by\":\"<field>\",\n"
            "                              \"time_bucket\":{\"field\":\"<datetime field>\",\"interval\":\"hour|day|week|month|quarter|year\"},\n"
            "                              \"aggregations\":[{\"method\":\"count\",\"alias\":\"<name>\"},\n"
            "                                              {\"method\":\"avg|min|max|sum\",\"field\":\"<numeric field>\",\"alias\":\"<name>\"}],\n"
            "                              \"limit\":5000}}}\n"
            "\n"
            "2) llm_call — call Claude. Fields are TOP-LEVEL on the block, NOT under `config`.\n"
            "     {\"id\":\"b2\",\"type\":\"llm_call\",\"label\":\"…\",\n"
            "      \"prompt_template\":\"Analyze {b1.result.records} …\",\n"
            "      \"system_prompt\":\"You are a …\",\"model\":\"claude-haiku-4-5-20251001\",\"max_tokens\":1024,\n"
            "      \"output_schema\":{\"category\":\"string\",\"priority\":\"low|medium|high|critical\"}}\n"
            "\n"
            "3) action — invoke an ontology Action by name. TOP-LEVEL fields.\n"
            "     {\"id\":\"b3\",\"type\":\"action\",\"label\":\"…\",\"action_name\":\"<exact action name>\",\n"
            "      \"params\":{\"<field>\":\"{b2.result.category}\"},\"reasoning\":\"…\"}\n"
            "\n"
            "4) ontology_update — write fields back to ONE record. NESTED in `config`.\n"
            "   NOTE: this one wants `object_type_id` (UUID), not `object_type` (name).\n"
            "     {\"id\":\"b4\",\"type\":\"ontology_update\",\"label\":\"…\",\n"
            "      \"config\":{\"object_type_id\":\"<UUID from list_object_types>\",\n"
            "                 \"match_field\":\"<pk field name>\",\"match_value\":\"{b1.result.records[0].id}\",\n"
            "                 \"fields\":{\"<field>\":\"{b2.result.score}\"}}}\n"
            "\n"
            "5) http_call — generic HTTP. NESTED in `config`. ONLY for EXTERNAL services.\n"
            "   Never use http_call for ontology operations (use ontology_query/ontology_update/action instead).\n"
            "     {\"id\":\"b5\",\"type\":\"http_call\",\"label\":\"…\",\n"
            "      \"config\":{\"url\":\"https://api.example.com/x\",\"method\":\"GET|POST|PUT|PATCH|DELETE\",\n"
            "                 \"headers\":{\"Authorization\":\"Bearer …\"},\"body\":{…},\n"
            "                 \"auth_type\":\"none|bearer|basic|api_key\",\"auth_config\":{…},\"timeout_seconds\":30}}\n"
            "\n"
            "6) transform — pure-Python data shaping. TOP-LEVEL fields. Strict operations only:\n"
            "   `pass`, `extract_field`, `format_string`, `filter_list`, `map_fields`, `pluck`, `first`, `last`, `length`, `to_json`.\n"
            "     {\"id\":\"b6\",\"type\":\"transform\",\"label\":\"…\",\"operation\":\"pass|extract_field|…\",\n"
            "      \"source\":\"b1.result.rows\",      # block ref, NO curly braces inside `source`\n"
            "      \"field\":\"<field>\",              # for extract_field/filter_list/pluck\n"
            "      \"value\":\"<expected>\",           # for filter_list\n"
            "      \"template\":\"Hello {inputs.name} …\",  # for format_string\n"
            "      \"mappings\":{\"pk\":\"{row.device}:{row.time}\",\"device\":\"{row.device}\"},  # for map_fields\n"
            "      \"keep_unmapped\":false}\n"
            "\n"
            "7) send_email — SMTP send. TOP-LEVEL fields.\n"
            "     {\"id\":\"b7\",\"type\":\"send_email\",\"label\":\"…\",\n"
            "      \"to\":\"user@example.com\",          # or {b2.result.email}, or a list of {to,subject,body}\n"
            "      \"subject\":\"Subject with {inputs.x}\",\"body\":\"Plain-text body\",\n"
            "      \"from_name\":\"Nexus\",\"bcc\":\"audit@example.com\"}\n"
            "\n"
            "8) utility_call — invoke a utility (PDF extract, OCR, scrape, geocode, …). TOP-LEVEL fields.\n"
            "     {\"id\":\"b8\",\"type\":\"utility_call\",\"label\":\"…\",\"utility_id\":\"<id>\",\"utility_params\":{…}}\n"
            "\n"
            "VARIABLE RESOLUTION:\n"
            "  {inputs.<name>}              function input parameter\n"
            "  {<block_id>.result}          full result of a previous block\n"
            "  {<block_id>.result.<field>}  nested field\n"
            "  {<block_id>.result[0].<field>}  first item of a list result\n"
            "  {now}, {now_minus_1d|3d|7d|14d|30d|90d}  built-in ISO timestamps\n"
            "\n"
            "HARD RULES (violations produce non-runnable functions):\n"
            "  - Use exactly the type strings above. NEVER `llm` (→`llm_call`), `condition` (unsupported), `http_request` (→`http_call`), `notification` (→`send_email`).\n"
            "  - For ontology aggregations, ALWAYS use ontology_query+aggregate, NEVER http_call.\n"
            "  - For writes, prefer ontology_update or action over raw http_call.\n"
            "  - Every config field MUST be present with a real value — no `<id>`, `TODO`, or empty strings.\n"
            "  - ontology_query.config.object_type is the NAME from list_object_types (e.g. \"DeviceTelemetry\"); ontology_update.config.object_type_id is the UUID. Calling list_object_types first is the safe way to get exact name + id.\n"
            "  - Block IDs MUST match ^[a-z][a-z0-9_]*$ (e.g. `b1`, `agg`, `classify`).\n"
            "  - `output_block` at the function root MUST be the id of the LAST meaningful block.\n"
            "  - Patches replace the blocks array — include EVERY block you want to keep, not just the ones you're changing."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "function_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "blocks": {"type": "array", "items": {"type": "object"}},
                "input_schema": {"type": "array", "items": {"type": "object"}},
                "output_block": {"type": "string"},
            },
            "required": ["function_id"],
        },
    },
    "delete_logic_function": {
        "name": "delete_logic_function",
        "description": "Delete a logic function. ASK FOR CONFIRMATION.",
        "input_schema": {
            "type": "object",
            "properties": {"function_id": {"type": "string"}},
            "required": ["function_id"],
        },
    },
    "publish_logic_function": {
        "name": "publish_logic_function",
        "description": "Mark the current version of a logic function as published (production).",
        "input_schema": {
            "type": "object",
            "properties": {"function_id": {"type": "string"}},
            "required": ["function_id"],
        },
    },
    "create_logic_schedule": {
        "name": "create_logic_schedule",
        "description": "Create a cron schedule for a logic function with default inputs.",
        "input_schema": {
            "type": "object",
            "properties": {
                "function_id": {"type": "string"},
                "label": {"type": "string"},
                "cron": {"type": "string"},
                "inputs": {"type": "object", "description": "Default inputs for each run"},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["function_id", "cron"],
        },
    },
    "delete_logic_schedule": {
        "name": "delete_logic_schedule",
        "description": "Delete a logic function schedule.",
        "input_schema": {
            "type": "object",
            "properties": {
                "function_id": {"type": "string"},
                "schedule_id": {"type": "string"},
            },
            "required": ["function_id", "schedule_id"],
        },
    },
    "list_logic_runs": {
        "name": "list_logic_runs",
        "description": (
            "List recent runs of logic functions in this tenant (Operations history). "
            "Use this to diagnose failures, see what a scheduled function did last, or surface "
            "the most recent run_id to pass to get_logic_run for a full trace. "
            "Returns runs newest-first with id, function_id, status (queued/running/succeeded/failed), "
            "started_at, finished_at, triggered_by, and a short error preview when failed."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "function_id": {"type": "string", "description": "Optional — filter to one function."},
                "status": {"type": "string", "description": "Optional — filter (e.g. 'failed', 'succeeded', 'running')."},
                "limit": {"type": "integer", "default": 20, "description": "Max runs to return (1-200)."},
            },
            "required": [],
        },
    },
    "get_logic_run": {
        "name": "get_logic_run",
        "description": (
            "Fetch the full record for one logic function run, including the per-block trace "
            "(inputs, outputs, errors, timings). Use this to pinpoint which block in a function failed "
            "and why. Get the run_id from list_logic_runs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "run_id": {"type": "string"},
            },
            "required": ["run_id"],
        },
    },

    # ── Agents ────────────────────────────────────────────────────────────────
    "list_agents": {
        "name": "list_agents",
        "description": "List all agents in the tenant with their model, enabled tools, and status.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_agent": {
        "name": "create_agent",
        "description": "Create a new AI agent with a system prompt, model, and tool whitelist. ASK FOR CONFIRMATION.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "description": {"type": "string"},
                "system_prompt": {"type": "string"},
                "model": {"type": "string", "description": "e.g. claude-haiku-4-5-20251001"},
                "enabled_tools": {"type": "array", "items": {"type": "string"}},
                "max_iterations": {"type": "integer", "default": 10},
            },
            "required": ["name", "system_prompt"],
        },
    },
    "update_agent": {
        "name": "update_agent",
        "description": "Update an agent's prompt, model, tools, or settings.",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "system_prompt": {"type": "string"},
                "model": {"type": "string"},
                "enabled_tools": {"type": "array", "items": {"type": "string"}},
                "max_iterations": {"type": "integer"},
            },
            "required": ["agent_id"],
        },
    },
    "delete_agent": {
        "name": "delete_agent",
        "description": "Delete an agent. ASK FOR CONFIRMATION. This also removes its threads, schedules, and triggers.",
        "input_schema": {
            "type": "object",
            "properties": {"agent_id": {"type": "string"}},
            "required": ["agent_id"],
        },
    },
    "set_agent_knowledge_scope": {
        "name": "set_agent_knowledge_scope",
        "description": "Restrict an agent's data access to a specific list of object types (with optional row-level filters).",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "scope": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "object_type_id": {"type": "string"},
                            "label": {"type": "string"},
                            "filters": {"type": "array", "items": {"type": "object"}},
                        },
                    },
                },
            },
            "required": ["agent_id", "scope"],
        },
    },
    "create_agent_schedule": {
        "name": "create_agent_schedule",
        "description": "Schedule an agent to run a prompt on a cron schedule.",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "name": {"type": "string"},
                "prompt": {"type": "string", "description": "The prompt the agent will run each tick"},
                "cron_expression": {"type": "string"},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["agent_id", "prompt", "cron_expression"],
        },
    },
    "delete_agent_schedule": {
        "name": "delete_agent_schedule",
        "description": "Delete an agent schedule.",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "schedule_id": {"type": "string"},
            },
            "required": ["agent_id", "schedule_id"],
        },
    },
    "create_pipeline_trigger": {
        "name": "create_pipeline_trigger",
        "description": "Wire an agent to fire after a pipeline completes. mode='per_row' fires once per new record; 'per_batch' fires once with the batch.",
        "input_schema": {
            "type": "object",
            "properties": {
                "agent_id": {"type": "string"},
                "pipeline_id": {"type": "string"},
                "mode": {"type": "string", "enum": ["per_row", "per_batch"]},
                "on_new_only": {"type": "boolean", "default": True},
                "min_new_rows": {"type": "integer", "default": 1},
                "prompt_template": {"type": "string"},
            },
            "required": ["agent_id", "pipeline_id", "mode"],
        },
    },
    "test_fire_trigger": {
        "name": "test_fire_trigger",
        "description": "Fire a pipeline trigger manually for testing (does not require a real pipeline run).",
        "input_schema": {
            "type": "object",
            "properties": {"trigger_id": {"type": "string"}},
            "required": ["trigger_id"],
        },
    },
    "delete_pipeline_trigger": {
        "name": "delete_pipeline_trigger",
        "description": "Delete a pipeline trigger.",
        "input_schema": {
            "type": "object",
            "properties": {"trigger_id": {"type": "string"}},
            "required": ["trigger_id"],
        },
    },

    # ── Eval suites ──────────────────────────────────────────────────────────
    "list_eval_suites": {
        "name": "list_eval_suites",
        "description": "List all eval suites (test suites for agents/logic functions).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_eval_suite": {
        "name": "create_eval_suite",
        "description": "Create an eval suite tied to an agent or logic function with a list of evaluators (exact_match, contains_key_details, rouge_score, json_schema_match, custom_expression).",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "target_type": {"type": "string", "enum": ["agent", "logic_function", "logic_flow"]},
                "target_id": {"type": "string"},
                "evaluator_configs": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "evaluator_id": {"type": "string"},
                            "weight": {"type": "number", "default": 1.0},
                            "config": {"type": "object"},
                        },
                    },
                },
                "pass_threshold": {"type": "number", "default": 0.8},
            },
            "required": ["name", "target_type", "target_id", "evaluator_configs"],
        },
    },
    "add_eval_case": {
        "name": "add_eval_case",
        "description": "Add a test case (input + expected output) to an eval suite.",
        "input_schema": {
            "type": "object",
            "properties": {
                "suite_id": {"type": "string"},
                "name": {"type": "string"},
                "inputs": {"type": "object"},
                "expected_outputs": {"type": "object"},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["suite_id", "name", "inputs", "expected_outputs"],
        },
    },
    "run_eval_suite": {
        "name": "run_eval_suite",
        "description": "Execute an eval suite and return the run id (poll get_eval_run for results).",
        "input_schema": {
            "type": "object",
            "properties": {"suite_id": {"type": "string"}},
            "required": ["suite_id"],
        },
    },
    "get_eval_run": {
        "name": "get_eval_run",
        "description": "Fetch the status and per-case results of an eval run.",
        "input_schema": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },

    # ── Alerts ───────────────────────────────────────────────────────────────
    "list_alert_rules": {
        "name": "list_alert_rules",
        "description": "List all alert rules with their type, enabled status, and last fired timestamp.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_alert_rule": {
        "name": "create_alert_rule",
        "description": "Create a new alert rule. rule_type: stuck_case | slow_transition | rework_spike | case_volume_anomaly. config varies per type.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "rule_type": {"type": "string", "enum": ["stuck_case", "slow_transition", "rework_spike", "case_volume_anomaly"]},
                "object_type_id": {"type": "string"},
                "process_id": {"type": "string"},
                "config": {"type": "object", "description": "Rule-type-specific config (threshold_hours, from_activity, to_activity, spike_multiplier, stddev_threshold, …)"},
                "cooldown_minutes": {"type": "integer", "default": 60},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["name", "rule_type", "config"],
        },
    },
    "update_alert_rule": {
        "name": "update_alert_rule",
        "description": "Update an alert rule's config, cooldown, or enabled status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "rule_id": {"type": "string"},
                "name": {"type": "string"},
                "config": {"type": "object"},
                "cooldown_minutes": {"type": "integer"},
                "enabled": {"type": "boolean"},
            },
            "required": ["rule_id"],
        },
    },
    "delete_alert_rule": {
        "name": "delete_alert_rule",
        "description": "Delete an alert rule. ASK FOR CONFIRMATION.",
        "input_schema": {
            "type": "object",
            "properties": {"rule_id": {"type": "string"}},
            "required": ["rule_id"],
        },
    },
    "test_alert_rule": {
        "name": "test_alert_rule",
        "description": "Dry-run an alert rule against current data without firing notifications. Returns matching cases / transitions.",
        "input_schema": {
            "type": "object",
            "properties": {"rule_id": {"type": "string"}},
            "required": ["rule_id"],
        },
    },
    "configure_notification_channel": {
        "name": "configure_notification_channel",
        "description": "Configure or update tenant notification channels (email, Slack webhook).",
        "input_schema": {
            "type": "object",
            "properties": {
                "email_enabled": {"type": "boolean"},
                "email_recipients": {"type": "string", "description": "Comma-separated emails"},
                "slack_enabled": {"type": "boolean"},
                "slack_webhook_url": {"type": "string"},
            },
            "required": [],
        },
    },
    "test_notification_channels": {
        "name": "test_notification_channels",
        "description": "Send a test message through the configured channels (Slack today; email TBD).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "acknowledge_notification": {
        "name": "acknowledge_notification",
        "description": "Mark an alert notification as read.",
        "input_schema": {
            "type": "object",
            "properties": {"notification_id": {"type": "string"}},
            "required": ["notification_id"],
        },
    },
    "snooze_notification": {
        "name": "snooze_notification",
        "description": "Snooze an alert notification until a future timestamp (ISO 8601).",
        "input_schema": {
            "type": "object",
            "properties": {
                "notification_id": {"type": "string"},
                "until": {"type": "string", "description": "ISO 8601 timestamp"},
            },
            "required": ["notification_id", "until"],
        },
    },

    # ── Approvals & checkpoints ──────────────────────────────────────────────
    "list_approval_workflows": {
        "name": "list_approval_workflows",
        "description": "List approval workflow definitions for the tenant.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_approval_workflow": {
        "name": "create_approval_workflow",
        "description": "Define an approval workflow: which resource/operations require how many approvals from which roles.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "resource_type": {"type": "string", "enum": ["object_type", "pipeline", "agent"]},
                "operations": {"type": "array", "items": {"type": "string"}, "description": "e.g. ['delete', 'export', 'bulk_run']"},
                "required_approvers": {"type": "integer", "default": 1},
                "eligible_roles": {"type": "array", "items": {"type": "string"}, "description": "e.g. ['admin', 'analyst']"},
                "expiry_hours": {"type": "integer", "default": 72},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["name", "resource_type", "operations", "required_approvers"],
        },
    },
    "update_approval_workflow": {
        "name": "update_approval_workflow",
        "description": "Update an approval workflow.",
        "input_schema": {
            "type": "object",
            "properties": {
                "workflow_id": {"type": "string"},
                "name": {"type": "string"},
                "operations": {"type": "array", "items": {"type": "string"}},
                "required_approvers": {"type": "integer"},
                "eligible_roles": {"type": "array", "items": {"type": "string"}},
                "expiry_hours": {"type": "integer"},
                "enabled": {"type": "boolean"},
            },
            "required": ["workflow_id"],
        },
    },
    "delete_approval_workflow": {
        "name": "delete_approval_workflow",
        "description": "Delete an approval workflow.",
        "input_schema": {
            "type": "object",
            "properties": {"workflow_id": {"type": "string"}},
            "required": ["workflow_id"],
        },
    },
    "list_pending_approvals": {
        "name": "list_pending_approvals",
        "description": "List approval requests assigned to the current user that are pending decision.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "approve_request": {
        "name": "approve_request",
        "description": "Approve a pending approval request. If required_approvers reached, the action is auto-executed.",
        "input_schema": {
            "type": "object",
            "properties": {
                "request_id": {"type": "string"},
                "note": {"type": "string"},
            },
            "required": ["request_id"],
        },
    },
    "reject_request": {
        "name": "reject_request",
        "description": "Reject a pending approval request.",
        "input_schema": {
            "type": "object",
            "properties": {
                "request_id": {"type": "string"},
                "reason": {"type": "string"},
            },
            "required": ["request_id", "reason"],
        },
    },
    "list_checkpoints": {
        "name": "list_checkpoints",
        "description": "List justification checkpoints (gates that prompt for a reason before sensitive operations).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_checkpoint": {
        "name": "create_checkpoint",
        "description": "Define a justification gate: a prompt that appears before a user can perform certain operations.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "prompt_text": {"type": "string", "description": "Question shown to the user (e.g. 'Why are you deleting this?')"},
                "applies_to": {"type": "array", "items": {"type": "object", "properties": {"resource_type": {"type": "string"}, "operations": {"type": "array", "items": {"type": "string"}}}}},
                "applies_to_roles": {"type": "array", "items": {"type": "string"}, "description": "Empty = all roles"},
                "enabled": {"type": "boolean", "default": True},
            },
            "required": ["name", "prompt_text", "applies_to"],
        },
    },
    "update_checkpoint": {
        "name": "update_checkpoint",
        "description": "Update a checkpoint definition.",
        "input_schema": {
            "type": "object",
            "properties": {
                "checkpoint_id": {"type": "string"},
                "name": {"type": "string"},
                "prompt_text": {"type": "string"},
                "applies_to": {"type": "array", "items": {"type": "object"}},
                "applies_to_roles": {"type": "array", "items": {"type": "string"}},
                "enabled": {"type": "boolean"},
            },
            "required": ["checkpoint_id"],
        },
    },
    "delete_checkpoint": {
        "name": "delete_checkpoint",
        "description": "Delete a checkpoint definition.",
        "input_schema": {
            "type": "object",
            "properties": {"checkpoint_id": {"type": "string"}},
            "required": ["checkpoint_id"],
        },
    },
    "query_audit_log": {
        "name": "query_audit_log",
        "description": "Query the audit log with filters (actor, resource type, action, time range).",
        "input_schema": {
            "type": "object",
            "properties": {
                "actor_id": {"type": "string"},
                "resource_type": {"type": "string"},
                "resource_id": {"type": "string"},
                "action": {"type": "string"},
                "from_time": {"type": "string", "description": "ISO 8601"},
                "to_time": {"type": "string"},
                "limit": {"type": "integer", "default": 50},
            },
            "required": [],
        },
    },

    # ── Users & tenants ──────────────────────────────────────────────────────
    "list_users": {
        "name": "list_users",
        "description": "List users in the current tenant (or a specific tenant if x-tenant-id is set).",
        "input_schema": {
            "type": "object",
            "properties": {"tenant_id": {"type": "string"}},
            "required": [],
        },
    },
    "invite_user": {
        "name": "invite_user",
        "description": "Create a new user. Tenant is derived from email domain or explicit tenant_id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "email": {"type": "string"},
                "name": {"type": "string"},
                "role": {"type": "string", "enum": ["superadmin", "admin", "analyst", "viewer"]},
                "password": {"type": "string", "description": "Temporary password (12+ chars, mixed case, digit, special)"},
                "allowed_modules": {"type": "array", "items": {"type": "string"}},
                "tenant_id": {"type": "string"},
            },
            "required": ["email", "name", "role"],
        },
    },
    "update_user": {
        "name": "update_user",
        "description": "Update a user's name, role, or active status.",
        "input_schema": {
            "type": "object",
            "properties": {
                "user_id": {"type": "string"},
                "name": {"type": "string"},
                "role": {"type": "string"},
                "is_active": {"type": "boolean"},
                "allowed_modules": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["user_id"],
        },
    },
    "delete_user": {
        "name": "delete_user",
        "description": "Delete a user. ASK FOR CONFIRMATION.",
        "input_schema": {
            "type": "object",
            "properties": {"user_id": {"type": "string"}},
            "required": ["user_id"],
        },
    },
    "list_tenants": {
        "name": "list_tenants",
        "description": "List all tenants on the platform (superadmin only).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "list_model_providers": {
        "name": "list_model_providers",
        "description": "List configured model providers (Anthropic, OpenAI, Azure, Bedrock, local) for the tenant.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "update_model_provider": {
        "name": "update_model_provider",
        "description": "Update a model provider's name, base_url, models list, or default flag.",
        "input_schema": {
            "type": "object",
            "properties": {
                "provider_id": {"type": "string"},
                "name": {"type": "string"},
                "api_key": {"type": "string"},
                "base_url": {"type": "string"},
                "models": {"type": "array", "items": {"type": "object"}},
                "is_default": {"type": "boolean"},
                "enabled": {"type": "boolean"},
            },
            "required": ["provider_id"],
        },
    },
    "delete_model_provider": {
        "name": "delete_model_provider",
        "description": "Delete a model provider configuration.",
        "input_schema": {
            "type": "object",
            "properties": {"provider_id": {"type": "string"}},
            "required": ["provider_id"],
        },
    },
    "test_model_provider": {
        "name": "test_model_provider",
        "description": "Validate a provider's API key by sending a tiny test request.",
        "input_schema": {
            "type": "object",
            "properties": {"provider_id": {"type": "string"}},
            "required": ["provider_id"],
        },
    },

    # ── Apps & shares ────────────────────────────────────────────────────────
    "list_apps": {
        "name": "list_apps",
        "description": "List dashboards and apps for the tenant.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string", "description": "Filter to apps for one object type"},
                "kind": {"type": "string", "enum": ["dashboard", "app"]},
                "include_ephemeral": {"type": "boolean", "default": False},
            },
            "required": [],
        },
    },
    "update_app": {
        "name": "update_app",
        "description": "Update an app/dashboard's name, components, or settings.",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "string"},
                "name": {"type": "string"},
                "description": {"type": "string"},
                "components": {"type": "array", "items": {"type": "object"}},
                "settings": {"type": "object"},
            },
            "required": ["app_id"],
        },
    },
    "delete_app": {
        "name": "delete_app",
        "description": "Delete an app/dashboard. ASK FOR CONFIRMATION.",
        "input_schema": {
            "type": "object",
            "properties": {"app_id": {"type": "string"}},
            "required": ["app_id"],
        },
    },
    "create_app_share": {
        "name": "create_app_share",
        "description": "Create an external share link for an app. mode='view' (read-only) or 'submit' (forms). access_mode='public'/'password'/'email_whitelist'/'nexus_user'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "string"},
                "mode": {"type": "string", "enum": ["view", "submit"]},
                "access_mode": {"type": "string", "enum": ["public", "password", "email_whitelist", "nexus_user"]},
                "password": {"type": "string"},
                "expires_at": {"type": "string", "description": "ISO 8601"},
                "max_uses": {"type": "integer"},
            },
            "required": ["app_id", "mode"],
        },
    },
    "revoke_app_share": {
        "name": "revoke_app_share",
        "description": "Revoke an app share by share id.",
        "input_schema": {
            "type": "object",
            "properties": {
                "app_id": {"type": "string"},
                "share_id": {"type": "string"},
            },
            "required": ["app_id", "share_id"],
        },
    },

    # ── API gateway ──────────────────────────────────────────────────────────
    "list_api_endpoints": {
        "name": "list_api_endpoints",
        "description": "List external `/v1/{slug}` API endpoints registered for the tenant.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_api_endpoint": {
        "name": "create_api_endpoint",
        "description": "Register a new external API endpoint backed by an object type or events.",
        "input_schema": {
            "type": "object",
            "properties": {
                "slug": {"type": "string", "description": "URL slug, must be unique"},
                "object_type_id": {"type": "string"},
                "object_type_name": {"type": "string"},
                "resource_type": {"type": "string", "enum": ["records", "events"]},
            },
            "required": ["slug", "resource_type"],
        },
    },
    "delete_api_endpoint": {
        "name": "delete_api_endpoint",
        "description": "Delete an external API endpoint.",
        "input_schema": {
            "type": "object",
            "properties": {"endpoint_id": {"type": "string"}},
            "required": ["endpoint_id"],
        },
    },
    "mint_api_key": {
        "name": "mint_api_key",
        "description": "Generate a new API key. Returns the raw key ONCE; it is hashed in storage. Scopes: read:records, read:events, write:records, read:all, write:all.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "scopes": {"type": "array", "items": {"type": "string"}},
                "rate_limit_per_min": {"type": "integer", "default": 1000},
                "ip_allowlist": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["name", "scopes"],
        },
    },
    "revoke_api_key": {
        "name": "revoke_api_key",
        "description": "Revoke an API key by id.",
        "input_schema": {
            "type": "object",
            "properties": {"key_id": {"type": "string"}},
            "required": ["key_id"],
        },
    },
    "toggle_api_key": {
        "name": "toggle_api_key",
        "description": "Enable or disable an API key.",
        "input_schema": {
            "type": "object",
            "properties": {
                "key_id": {"type": "string"},
                "enabled": {"type": "boolean"},
            },
            "required": ["key_id", "enabled"],
        },
    },
    "get_gateway_usage_summary": {
        "name": "get_gateway_usage_summary",
        "description": "Get usage stats for the external API gateway (requests, errors, bandwidth, top IPs).",
        "input_schema": {
            "type": "object",
            "properties": {
                "time_range": {"type": "string", "enum": ["24h", "7d", "30d"], "default": "7d"},
            },
            "required": [],
        },
    },

    # ── Process mining (advanced) ────────────────────────────────────────────
    "discover_processes": {
        "name": "discover_processes",
        "description": "Auto-discover processes from the event log; returns ranked candidate case_keys with confidence.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "backfill_process_case_key": {
        "name": "backfill_process_case_key",
        "description": "Backfill the case_key attribute on events from record_snapshot for a given process.",
        "input_schema": {
            "type": "object",
            "properties": {"process_id": {"type": "string"}},
            "required": ["process_id"],
        },
    },
    "list_conformance_models": {
        "name": "list_conformance_models",
        "description": "List conformance models for a process or object type.",
        "input_schema": {
            "type": "object",
            "properties": {
                "process_id": {"type": "string"},
                "object_type_id": {"type": "string"},
            },
            "required": [],
        },
    },
    "create_conformance_model": {
        "name": "create_conformance_model",
        "description": "Create an expected-flow model: ordered list of activities. Used to score fitness of real cases.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "process_id": {"type": "string"},
                "object_type_id": {"type": "string"},
                "activities": {"type": "array", "items": {"type": "string"}},
                "is_active": {"type": "boolean", "default": True},
            },
            "required": ["name", "activities"],
        },
    },
    "check_conformance": {
        "name": "check_conformance",
        "description": "Run a conformance check against a model and return per-case fitness scores + deviations.",
        "input_schema": {
            "type": "object",
            "properties": {
                "model_id": {"type": "string"},
                "process_id": {"type": "string"},
                "object_type_id": {"type": "string"},
            },
            "required": ["model_id"],
        },
    },

    # ── Read-only intel ──────────────────────────────────────────────────────
    "search_everything": {
        "name": "search_everything",
        "description": "Full-text search across object types, records, pipelines, connectors, agents. Use this for 'find anything called X'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 20},
            },
            "required": ["query"],
        },
    },
    "get_lineage_graph": {
        "name": "get_lineage_graph",
        "description": "Get the full data lineage graph (connectors → pipelines → object types → logic → agents → actions) with health annotations.",
        "input_schema": {
            "type": "object",
            "properties": {
                "with_health": {"type": "boolean", "default": True},
            },
            "required": [],
        },
    },
    "get_node_upstream": {
        "name": "get_node_upstream",
        "description": "Trace all nodes that feed into a given lineage node (BFS upstream).",
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string", "description": "e.g. 'pipeline:abc-123' or 'objecttype:xyz'"}},
            "required": ["node_id"],
        },
    },
    "get_node_downstream": {
        "name": "get_node_downstream",
        "description": "Trace all nodes that this lineage node feeds into (BFS downstream).",
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string"}},
            "required": ["node_id"],
        },
    },
    "get_impact_analysis": {
        "name": "get_impact_analysis",
        "description": "Compute downstream blast radius if this node breaks (counts + grouped by type).",
        "input_schema": {
            "type": "object",
            "properties": {"node_id": {"type": "string"}},
            "required": ["node_id"],
        },
    },
    "get_data_quality_summary": {
        "name": "get_data_quality_summary",
        "description": "Get the data-quality summary for all object types (score, total records, computed_at).",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "get_data_quality_for_object_type": {
        "name": "get_data_quality_for_object_type",
        "description": "Property-level data quality for a single object type (null rate, distinctness, top values).",
        "input_schema": {
            "type": "object",
            "properties": {"object_type_id": {"type": "string"}},
            "required": ["object_type_id"],
        },
    },
    "scan_pii_for_object_type": {
        "name": "scan_pii_for_object_type",
        "description": "Detect PII fields in a single object type (regex pre-filter + Claude verification).",
        "input_schema": {
            "type": "object",
            "properties": {"object_type_id": {"type": "string"}},
            "required": ["object_type_id"],
        },
    },
    "scan_all_pii": {
        "name": "scan_all_pii",
        "description": "Trigger an async PII sweep across ALL object types. Returns a scan_id; poll get_pii_scan_results.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "get_pii_scan_results": {
        "name": "get_pii_scan_results",
        "description": "Poll the results of a PII sweep started by scan_all_pii.",
        "input_schema": {
            "type": "object",
            "properties": {"scan_id": {"type": "string"}},
            "required": ["scan_id"],
        },
    },
    "extract_document_fields": {
        "name": "extract_document_fields",
        "description": "Run vision OCR + structured field extraction on an uploaded document.",
        "input_schema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string"},
                "schema": {"type": "array", "items": {"type": "object"}, "description": "Fields to extract: [{name, type, description}]"},
                "document_kind": {"type": "string", "description": "e.g. 'invoice', 'receipt', 'contract'"},
            },
            "required": ["document_id", "schema"],
        },
    },

    # ── Notebooks & comments ─────────────────────────────────────────────────
    "list_notebooks": {
        "name": "list_notebooks",
        "description": "List notebooks in the workbench.",
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    "create_notebook": {
        "name": "create_notebook",
        "description": "Create a new notebook with optional starting cells.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "cells": {"type": "array", "items": {"type": "object"}, "default": []},
            },
            "required": ["name"],
        },
    },
    "delete_notebook": {
        "name": "delete_notebook",
        "description": "Delete a notebook.",
        "input_schema": {
            "type": "object",
            "properties": {"notebook_id": {"type": "string"}},
            "required": ["notebook_id"],
        },
    },
    "list_comments": {
        "name": "list_comments",
        "description": "List comments on an entity.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {"type": "string", "enum": ["object_type", "pipeline", "agent", "record", "ontology_link"]},
                "entity_id": {"type": "string"},
            },
            "required": ["entity_type", "entity_id"],
        },
    },
    "add_comment": {
        "name": "add_comment",
        "description": "Add a comment on any entity. Set parent_id to reply.",
        "input_schema": {
            "type": "object",
            "properties": {
                "entity_type": {"type": "string"},
                "entity_id": {"type": "string"},
                "body": {"type": "string"},
                "parent_id": {"type": "string"},
            },
            "required": ["entity_type", "entity_id", "body"],
        },
    },
    "resolve_comment": {
        "name": "resolve_comment",
        "description": "Mark a comment as resolved.",
        "input_schema": {
            "type": "object",
            "properties": {"comment_id": {"type": "string"}},
            "required": ["comment_id"],
        },
    },
    "web_search": {
        "name": "web_search",
        "description": (
            "Search the public web (DuckDuckGo HTML) for a query and return up to "
            "`max_results` results, each {url, title, snippet}. Use this to find "
            "supplier / catalog / vendor pages for a manufacturer part number. "
            "Pair with scrape_url on the most credible URLs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "max_results": {"type": "integer", "default": 5, "description": "How many results to return (max 10)"},
            },
            "required": ["query"],
        },
    },
    "scrape_url": {
        "name": "scrape_url",
        "description": (
            "Fetch a single URL and return {title, text, selected, links}. "
            "Pass use_stealth=true to retry with a headless-browser fetcher if a "
            "normal fetch returns a Cloudflare challenge or empty body. "
            "Use this AFTER web_search to pull supplier price / lead time / MOQ from page bodies."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "Full URL to fetch"},
                "use_stealth": {"type": "boolean", "default": False, "description": "Retry with stealthy headless browser"},
                "extract_text": {"type": "boolean", "default": True},
            },
            "required": ["url"],
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

                # Auto-bootstrap: if the action template doesn't exist yet,
                # create a stub one so the agent can land its memo without
                # an out-of-band seed step. Default to requires_confirmation
                # so nothing fires automatically — it always queues for
                # human approval. Same pattern as LLM_CLASSIFY's pnc_alert
                # auto-create. Property types are inferred from the proposed
                # inputs (string/number/array/object); the action's owner can
                # tighten the schema later via the Ontology UI.
                check = await client.get(
                    f"{ONTOLOGY_URL}/actions/{action_name}", headers=headers
                )
                if check.status_code == 404:
                    def _infer_type(v: Any) -> str:
                        if isinstance(v, bool):
                            return "boolean"
                        if isinstance(v, (int, float)):
                            return "number"
                        if isinstance(v, list):
                            return "array"
                        if isinstance(v, dict):
                            return "object"
                        return "string"
                    inferred_schema = {
                        str(k): _infer_type(v) for k, v in (inputs or {}).items()
                    }
                    create_resp = await client.post(
                        f"{ONTOLOGY_URL}/actions",
                        json={
                            "name": action_name,
                            "description": (
                                f"Auto-created by agent {agent_id} on first proposal. "
                                "Edit description / schema in the Ontology UI."
                            ),
                            "requires_confirmation": True,
                            "enabled": True,
                            "input_schema": inferred_schema,
                        },
                        headers=headers,
                    )
                    if not create_resp.is_success and create_resp.status_code != 409:
                        return {
                            "error": (
                                f"action template '{action_name}' did not exist and auto-create "
                                f"failed: HTTP {create_resp.status_code} {create_resp.text[:200]}"
                            )
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

            elif tool_name == "web_search":
                # Proxy to scraping-service. Keep timeout generous because DDG
                # occasionally takes a few seconds; the agent is already
                # bounded by its overall step budget.
                query = (tool_input.get("query") or "").strip()
                if not query:
                    return {"error": "query is required"}
                max_results = int(tool_input.get("max_results") or 10)
                try:
                    r = await client.post(
                        f"{SCRAPING_URL}/search",
                        json={"query": query, "max_results": max_results},
                        timeout=30,
                    )
                    if not r.is_success:
                        return {"error": f"scraping-service /search HTTP {r.status_code}: {r.text[:200]}"}
                    return r.json()
                except httpx.HTTPError as exc:
                    return {"error": f"scraping-service unreachable: {exc}"}

            elif tool_name == "scrape_url":
                url = (tool_input.get("url") or "").strip()
                if not url.startswith(("http://", "https://")):
                    return {"error": "url must start with http:// or https://"}
                payload = {
                    "url": url,
                    "extract_text": bool(tool_input.get("extract_text", True)),
                    "extract_links": bool(tool_input.get("extract_links", False)),
                    "use_stealth": bool(tool_input.get("use_stealth", False)),
                }
                if tool_input.get("selector"):
                    payload["selector"] = str(tool_input["selector"])
                # Allow more time for stealth fetches (Camoufox is slow)
                request_timeout = 60 if payload["use_stealth"] else 30
                try:
                    r = await client.post(
                        f"{SCRAPING_URL}/scrape",
                        json=payload,
                        timeout=request_timeout,
                    )
                    if not r.is_success:
                        return {"error": f"scraping-service /scrape HTTP {r.status_code}: {r.text[:200]}"}
                    return r.json()
                except httpx.HTTPError as exc:
                    return {"error": f"scraping-service unreachable: {exc}"}

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

            # ── Lifecycle: connectors ────────────────────────────────────────
            elif tool_name == "update_connector":
                cid = tool_input.get("connector_id")
                if not cid: return {"error": "connector_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "connector_id" and v is not None}
                r = await client.put(f"{CONNECTOR_URL}/connectors/{cid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_connector: {r.text[:300]}"}

            elif tool_name == "delete_connector":
                cid = tool_input.get("connector_id")
                if not cid: return {"error": "connector_id is required"}
                r = await client.delete(f"{CONNECTOR_URL}/connectors/{cid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "test_connector":
                cid = tool_input.get("connector_id")
                if not cid: return {"error": "connector_id is required"}
                r = await client.post(f"{CONNECTOR_URL}/connectors/{cid}/test", headers=headers, timeout=30)
                return r.json() if r.is_success else {"error": f"test_connector: {r.text[:300]}"}

            # ── Lifecycle: pipelines ─────────────────────────────────────────
            elif tool_name == "update_pipeline":
                pid = tool_input.get("pipeline_id")
                if not pid: return {"error": "pipeline_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "pipeline_id" and v is not None}
                r = await client.put(f"{PIPELINE_URL}/pipelines/{pid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_pipeline: {r.text[:300]}"}

            elif tool_name == "delete_pipeline":
                pid = tool_input.get("pipeline_id")
                if not pid: return {"error": "pipeline_id is required"}
                r = await client.delete(f"{PIPELINE_URL}/pipelines/{pid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "get_pipeline_runs":
                pid = tool_input.get("pipeline_id")
                limit = tool_input.get("limit", 20)
                if not pid: return {"error": "pipeline_id is required"}
                r = await client.get(f"{PIPELINE_URL}/pipelines/{pid}/runs", headers=headers, params={"limit": limit})
                return r.json() if r.is_success else {"runs": [], "error": r.text[:200]}

            # ── Pipeline schedules ───────────────────────────────────────────
            elif tool_name == "list_pipeline_schedules":
                pid = tool_input.get("pipeline_id")
                if not pid: return {"error": "pipeline_id is required"}
                r = await client.get(f"{PIPELINE_URL}/pipelines/{pid}/schedules", headers=headers)
                return {"schedules": r.json() if r.is_success else []}

            elif tool_name == "create_pipeline_schedule":
                pid = tool_input.get("pipeline_id")
                if not pid: return {"error": "pipeline_id is required"}
                body = {
                    "name": tool_input.get("name", "Schedule"),
                    "cron_expression": tool_input.get("cron_expression"),
                    "enabled": tool_input.get("enabled", True),
                }
                r = await client.post(f"{PIPELINE_URL}/pipelines/{pid}/schedules", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_pipeline_schedule: {r.text[:300]}"}

            elif tool_name == "update_pipeline_schedule":
                pid = tool_input.get("pipeline_id"); sid = tool_input.get("schedule_id")
                if not pid or not sid: return {"error": "pipeline_id and schedule_id required"}
                body = {k: v for k, v in tool_input.items() if k not in ("pipeline_id", "schedule_id") and v is not None}
                r = await client.put(f"{PIPELINE_URL}/pipelines/{pid}/schedules/{sid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_pipeline_schedule: {r.text[:300]}"}

            elif tool_name == "delete_pipeline_schedule":
                pid = tool_input.get("pipeline_id"); sid = tool_input.get("schedule_id")
                if not pid or not sid: return {"error": "pipeline_id and schedule_id required"}
                r = await client.delete(f"{PIPELINE_URL}/pipelines/{pid}/schedules/{sid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "run_pipeline_schedule_now":
                pid = tool_input.get("pipeline_id"); sid = tool_input.get("schedule_id")
                if not pid or not sid: return {"error": "pipeline_id and schedule_id required"}
                r = await client.post(f"{PIPELINE_URL}/pipelines/{pid}/schedules/{sid}/run-now", headers=headers, timeout=15)
                return r.json() if r.is_success else {"error": f"run_now: {r.text[:300]}"}

            # ── Object types & links ─────────────────────────────────────────
            elif tool_name == "update_object_type":
                otid = tool_input.get("object_type_id")
                if not otid: return {"error": "object_type_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "object_type_id" and v is not None}
                r = await client.put(f"{ONTOLOGY_URL}/object-types/{otid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_object_type: {r.text[:300]}"}

            elif tool_name == "delete_object_type":
                otid = tool_input.get("object_type_id")
                if not otid: return {"error": "object_type_id is required"}
                r = await client.delete(f"{ONTOLOGY_URL}/object-types/{otid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "apply_enrichment":
                otid = tool_input.get("object_type_id")
                proposal = tool_input.get("proposal")
                if not otid or not proposal: return {"error": "object_type_id and proposal required"}
                r = await client.post(f"{ONTOLOGY_URL}/object-types/{otid}/enrich", json=proposal, headers=headers)
                return r.json() if r.is_success else {"error": f"apply_enrichment: {r.text[:300]}"}

            elif tool_name == "list_ontology_links":
                r = await client.get(f"{ONTOLOGY_URL}/object-types/links/all", headers=headers)
                return {"links": r.json() if r.is_success else []}

            elif tool_name == "delete_ontology_link":
                lid = tool_input.get("link_id")
                if not lid: return {"error": "link_id is required"}
                r = await client.delete(f"{ONTOLOGY_URL}/object-types/links/{lid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            # ── Logic functions ──────────────────────────────────────────────
            elif tool_name == "list_logic_functions":
                r = await client.get(f"{LOGIC_URL}/logic/functions", headers=headers)
                return {"functions": r.json() if r.is_success else []}

            elif tool_name == "update_logic_function":
                fid = tool_input.get("function_id")
                if not fid: return {"error": "function_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "function_id" and v is not None}
                r = await client.put(f"{LOGIC_URL}/logic/functions/{fid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_logic_function: {r.text[:300]}"}

            elif tool_name == "delete_logic_function":
                fid = tool_input.get("function_id")
                if not fid: return {"error": "function_id is required"}
                r = await client.delete(f"{LOGIC_URL}/logic/functions/{fid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "publish_logic_function":
                fid = tool_input.get("function_id")
                if not fid: return {"error": "function_id is required"}
                r = await client.post(f"{LOGIC_URL}/logic/functions/{fid}/publish", headers=headers)
                return r.json() if r.is_success else {"error": f"publish: {r.text[:300]}"}

            elif tool_name == "create_logic_schedule":
                fid = tool_input.get("function_id")
                if not fid: return {"error": "function_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "function_id" and v is not None}
                r = await client.post(f"{LOGIC_URL}/logic/functions/{fid}/schedules", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_logic_schedule: {r.text[:300]}"}

            elif tool_name == "delete_logic_schedule":
                fid = tool_input.get("function_id"); sid = tool_input.get("schedule_id")
                if not fid or not sid: return {"error": "function_id and schedule_id required"}
                r = await client.delete(f"{LOGIC_URL}/logic/functions/{fid}/schedules/{sid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "list_logic_runs":
                params: dict[str, Any] = {"limit": max(1, min(int(tool_input.get("limit", 20)), 200))}
                if tool_input.get("function_id"): params["function_id"] = tool_input["function_id"]
                if tool_input.get("status"): params["status"] = tool_input["status"]
                r = await client.get(f"{LOGIC_URL}/logic/runs", headers=headers, params=params)
                if not r.is_success:
                    return {"error": f"list_logic_runs: {r.text[:300]}"}
                runs = r.json()
                # Trim each run to a digestible summary — full trace is huge and
                # the agent should call get_logic_run for the details it needs.
                summary = [
                    {
                        "id": run.get("id"),
                        "function_id": run.get("function_id"),
                        "function_version": run.get("function_version"),
                        "status": run.get("status"),
                        "triggered_by": run.get("triggered_by"),
                        "started_at": run.get("started_at"),
                        "finished_at": run.get("finished_at"),
                        "error_preview": (run.get("error") or "")[:200] if run.get("error") else None,
                    }
                    for run in runs
                ]
                return {"runs": summary, "count": len(summary)}

            elif tool_name == "get_logic_run":
                rid = tool_input.get("run_id")
                if not rid: return {"error": "run_id is required"}
                r = await client.get(f"{LOGIC_URL}/logic/runs/{rid}", headers=headers)
                return r.json() if r.is_success else {"error": f"get_logic_run: {r.status_code} {r.text[:300]}"}

            # ── Agents ────────────────────────────────────────────────────────
            elif tool_name == "list_agents":
                r = await client.get(f"{AGENT_URL}/agents", headers=headers)
                agents = r.json() if r.is_success else []
                return {"agents": [{"id": a.get("id"), "name": a.get("name"), "model": a.get("model"), "enabled_tools": a.get("enabled_tools", [])} for a in agents]}

            elif tool_name == "create_agent":
                body = {
                    "name": tool_input.get("name"),
                    "description": tool_input.get("description", ""),
                    "system_prompt": tool_input.get("system_prompt"),
                    "model": tool_input.get("model", "claude-haiku-4-5-20251001"),
                    "enabled_tools": tool_input.get("enabled_tools", []),
                    "max_iterations": tool_input.get("max_iterations", 10),
                }
                r = await client.post(f"{AGENT_URL}/agents", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_agent: {r.text[:300]}"}

            elif tool_name == "update_agent":
                aid = tool_input.get("agent_id")
                if not aid: return {"error": "agent_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "agent_id" and v is not None}
                r = await client.put(f"{AGENT_URL}/agents/{aid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_agent: {r.text[:300]}"}

            elif tool_name == "delete_agent":
                aid = tool_input.get("agent_id")
                if not aid: return {"error": "agent_id is required"}
                r = await client.delete(f"{AGENT_URL}/agents/{aid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "set_agent_knowledge_scope":
                aid = tool_input.get("agent_id"); scope = tool_input.get("scope", [])
                if not aid: return {"error": "agent_id is required"}
                r = await client.put(f"{AGENT_URL}/agents/{aid}/knowledge-scope", json={"scope": scope}, headers=headers)
                return r.json() if r.is_success else {"error": f"set_scope: {r.text[:300]}"}

            elif tool_name == "create_agent_schedule":
                aid = tool_input.get("agent_id")
                if not aid: return {"error": "agent_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "agent_id" and v is not None}
                r = await client.post(f"{AGENT_URL}/agents/{aid}/schedules", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_agent_schedule: {r.text[:300]}"}

            elif tool_name == "delete_agent_schedule":
                aid = tool_input.get("agent_id"); sid = tool_input.get("schedule_id")
                if not aid or not sid: return {"error": "agent_id and schedule_id required"}
                r = await client.delete(f"{AGENT_URL}/agents/{aid}/schedules/{sid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "create_pipeline_trigger":
                body = {
                    "agent_id": tool_input.get("agent_id"),
                    "pipeline_id": tool_input.get("pipeline_id"),
                    "mode": tool_input.get("mode", "per_batch"),
                    "on_new_only": tool_input.get("on_new_only", True),
                    "min_new_rows": tool_input.get("min_new_rows", 1),
                    "prompt_template": tool_input.get("prompt_template", ""),
                }
                r = await client.post(f"{AGENT_URL}/triggers", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_pipeline_trigger: {r.text[:300]}"}

            elif tool_name == "test_fire_trigger":
                tid = tool_input.get("trigger_id")
                if not tid: return {"error": "trigger_id is required"}
                r = await client.post(f"{AGENT_URL}/triggers/{tid}/test-fire", headers=headers, timeout=15)
                return r.json() if r.is_success else {"error": f"test_fire: {r.text[:300]}"}

            elif tool_name == "delete_pipeline_trigger":
                tid = tool_input.get("trigger_id")
                if not tid: return {"error": "trigger_id is required"}
                r = await client.delete(f"{AGENT_URL}/triggers/{tid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            # ── Eval suites ──────────────────────────────────────────────────
            elif tool_name == "list_eval_suites":
                EVAL_URL = os.environ.get("EVAL_SERVICE_URL", "http://eval-service:8016")
                r = await client.get(f"{EVAL_URL}/suites", headers=headers)
                return {"suites": r.json() if r.is_success else []}

            elif tool_name == "create_eval_suite":
                EVAL_URL = os.environ.get("EVAL_SERVICE_URL", "http://eval-service:8016")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{EVAL_URL}/suites", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_eval_suite: {r.text[:300]}"}

            elif tool_name == "add_eval_case":
                EVAL_URL = os.environ.get("EVAL_SERVICE_URL", "http://eval-service:8016")
                sid = tool_input.get("suite_id")
                if not sid: return {"error": "suite_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "suite_id" and v is not None}
                r = await client.post(f"{EVAL_URL}/suites/{sid}/cases", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"add_eval_case: {r.text[:300]}"}

            elif tool_name == "run_eval_suite":
                EVAL_URL = os.environ.get("EVAL_SERVICE_URL", "http://eval-service:8016")
                sid = tool_input.get("suite_id")
                if not sid: return {"error": "suite_id is required"}
                r = await client.post(f"{EVAL_URL}/suites/{sid}/run", headers=headers, timeout=15)
                return r.json() if r.is_success else {"error": f"run_eval_suite: {r.text[:300]}"}

            elif tool_name == "get_eval_run":
                EVAL_URL = os.environ.get("EVAL_SERVICE_URL", "http://eval-service:8016")
                rid = tool_input.get("run_id")
                if not rid: return {"error": "run_id is required"}
                r = await client.get(f"{EVAL_URL}/runs/{rid}", headers=headers)
                return r.json() if r.is_success else {"error": f"get_eval_run: {r.text[:300]}"}

            # ── Alerts ────────────────────────────────────────────────────────
            elif tool_name == "list_alert_rules":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                r = await client.get(f"{ALERT_URL}/alerts/rules", headers=headers)
                return {"rules": r.json() if r.is_success else []}

            elif tool_name == "create_alert_rule":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{ALERT_URL}/alerts/rules", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_alert_rule: {r.text[:300]}"}

            elif tool_name == "update_alert_rule":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                rid = tool_input.get("rule_id")
                if not rid: return {"error": "rule_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "rule_id" and v is not None}
                r = await client.patch(f"{ALERT_URL}/alerts/rules/{rid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_alert_rule: {r.text[:300]}"}

            elif tool_name == "delete_alert_rule":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                rid = tool_input.get("rule_id")
                if not rid: return {"error": "rule_id is required"}
                r = await client.delete(f"{ALERT_URL}/alerts/rules/{rid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "test_alert_rule":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                rid = tool_input.get("rule_id")
                if not rid: return {"error": "rule_id is required"}
                r = await client.post(f"{ALERT_URL}/alerts/rules/{rid}/test", headers=headers, timeout=20)
                return r.json() if r.is_success else {"error": f"test_alert_rule: {r.text[:300]}"}

            elif tool_name == "configure_notification_channel":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.put(f"{ALERT_URL}/alerts/channels", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"configure_channel: {r.text[:300]}"}

            elif tool_name == "test_notification_channels":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                r = await client.post(f"{ALERT_URL}/alerts/channels/test", headers=headers, timeout=15)
                return r.json() if r.is_success else {"error": f"test_channels: {r.text[:300]}"}

            elif tool_name == "acknowledge_notification":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                nid = tool_input.get("notification_id")
                if not nid: return {"error": "notification_id is required"}
                r = await client.post(f"{ALERT_URL}/alerts/notifications/{nid}/read", headers=headers)
                return {"success": r.is_success}

            elif tool_name == "snooze_notification":
                ALERT_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
                nid = tool_input.get("notification_id"); until = tool_input.get("until")
                if not nid or not until: return {"error": "notification_id and until required"}
                r = await client.post(f"{ALERT_URL}/alerts/notifications/{nid}/snooze", json={"until": until}, headers=headers)
                return {"success": r.is_success}

            # ── Approvals & checkpoints ──────────────────────────────────────
            elif tool_name == "list_approval_workflows":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                r = await client.get(f"{AUDIT_URL}/audit/approvals/workflows", headers=headers)
                return {"workflows": r.json() if r.is_success else []}

            elif tool_name == "create_approval_workflow":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{AUDIT_URL}/audit/approvals/workflows", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_workflow: {r.text[:300]}"}

            elif tool_name == "update_approval_workflow":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                wid = tool_input.get("workflow_id")
                if not wid: return {"error": "workflow_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "workflow_id" and v is not None}
                r = await client.put(f"{AUDIT_URL}/audit/approvals/workflows/{wid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_workflow: {r.text[:300]}"}

            elif tool_name == "delete_approval_workflow":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                wid = tool_input.get("workflow_id")
                if not wid: return {"error": "workflow_id is required"}
                r = await client.delete(f"{AUDIT_URL}/audit/approvals/workflows/{wid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "list_pending_approvals":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                r = await client.get(f"{AUDIT_URL}/audit/approvals/requests/mine/pending", headers=headers)
                return {"requests": r.json() if r.is_success else []}

            elif tool_name == "approve_request":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                rid = tool_input.get("request_id")
                if not rid: return {"error": "request_id is required"}
                body = {"note": tool_input.get("note", "")}
                r = await client.post(f"{AUDIT_URL}/audit/approvals/requests/{rid}/approve", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"approve: {r.text[:300]}"}

            elif tool_name == "reject_request":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                rid = tool_input.get("request_id"); reason = tool_input.get("reason", "")
                if not rid: return {"error": "request_id is required"}
                r = await client.post(f"{AUDIT_URL}/audit/approvals/requests/{rid}/reject", json={"reason": reason}, headers=headers)
                return r.json() if r.is_success else {"error": f"reject: {r.text[:300]}"}

            elif tool_name == "list_checkpoints":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                r = await client.get(f"{AUDIT_URL}/audit/checkpoints", headers=headers)
                return {"checkpoints": r.json() if r.is_success else []}

            elif tool_name == "create_checkpoint":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{AUDIT_URL}/audit/checkpoints", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_checkpoint: {r.text[:300]}"}

            elif tool_name == "update_checkpoint":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                cid = tool_input.get("checkpoint_id")
                if not cid: return {"error": "checkpoint_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "checkpoint_id" and v is not None}
                r = await client.put(f"{AUDIT_URL}/audit/checkpoints/{cid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_checkpoint: {r.text[:300]}"}

            elif tool_name == "delete_checkpoint":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                cid = tool_input.get("checkpoint_id")
                if not cid: return {"error": "checkpoint_id is required"}
                r = await client.delete(f"{AUDIT_URL}/audit/checkpoints/{cid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "query_audit_log":
                AUDIT_URL = os.environ.get("AUDIT_SERVICE_URL", "http://audit-service:8006")
                params = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.get(f"{AUDIT_URL}/audit", params=params, headers=headers)
                return {"events": r.json() if r.is_success else []}

            # ── Users & tenants ──────────────────────────────────────────────
            elif tool_name == "list_users":
                AUTH_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")
                h = {**headers}
                if tool_input.get("tenant_id"): h["x-tenant-id"] = tool_input["tenant_id"]
                r = await client.get(f"{AUTH_URL}/auth/users", headers=h)
                return {"users": r.json() if r.is_success else []}

            elif tool_name == "invite_user":
                AUTH_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")
                body = {k: v for k, v in tool_input.items() if v is not None}
                h = {**headers}
                if tool_input.get("tenant_id"): h["x-tenant-id"] = tool_input["tenant_id"]
                r = await client.post(f"{AUTH_URL}/auth/users", json=body, headers=h)
                return r.json() if r.is_success else {"error": f"invite_user: {r.text[:300]}"}

            elif tool_name == "update_user":
                AUTH_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")
                uid = tool_input.get("user_id")
                if not uid: return {"error": "user_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "user_id" and v is not None}
                r = await client.patch(f"{AUTH_URL}/auth/users/{uid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_user: {r.text[:300]}"}

            elif tool_name == "delete_user":
                AUTH_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")
                uid = tool_input.get("user_id")
                if not uid: return {"error": "user_id is required"}
                r = await client.delete(f"{AUTH_URL}/auth/users/{uid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "list_tenants":
                ADMIN_URL = os.environ.get("ADMIN_SERVICE_URL", "http://admin-service:8022")
                r = await client.get(f"{ADMIN_URL}/admin/tenants", headers=headers)
                return {"tenants": r.json() if r.is_success else []}

            elif tool_name == "list_model_providers":
                r = await client.get(f"{AGENT_URL}/model-providers", headers=headers)
                return {"providers": r.json() if r.is_success else []}

            elif tool_name == "update_model_provider":
                pid = tool_input.get("provider_id")
                if not pid: return {"error": "provider_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "provider_id" and v is not None}
                r = await client.put(f"{AGENT_URL}/model-providers/{pid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_provider: {r.text[:300]}"}

            elif tool_name == "delete_model_provider":
                pid = tool_input.get("provider_id")
                if not pid: return {"error": "provider_id is required"}
                r = await client.delete(f"{AGENT_URL}/model-providers/{pid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "test_model_provider":
                pid = tool_input.get("provider_id")
                if not pid: return {"error": "provider_id is required"}
                r = await client.post(f"{AGENT_URL}/model-providers/{pid}/test", headers=headers, timeout=20)
                return r.json() if r.is_success else {"error": f"test_provider: {r.text[:300]}"}

            # ── Apps & shares ────────────────────────────────────────────────
            elif tool_name == "list_apps":
                params = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.get(f"{ONTOLOGY_URL}/apps", params=params, headers=headers)
                return {"apps": r.json() if r.is_success else []}

            elif tool_name == "update_app":
                aid = tool_input.get("app_id")
                if not aid: return {"error": "app_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "app_id" and v is not None}
                r = await client.put(f"{ONTOLOGY_URL}/apps/{aid}", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"update_app: {r.text[:300]}"}

            elif tool_name == "delete_app":
                aid = tool_input.get("app_id")
                if not aid: return {"error": "app_id is required"}
                r = await client.delete(f"{ONTOLOGY_URL}/apps/{aid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "create_app_share":
                aid = tool_input.get("app_id")
                if not aid: return {"error": "app_id is required"}
                body = {k: v for k, v in tool_input.items() if k != "app_id" and v is not None}
                r = await client.post(f"{ONTOLOGY_URL}/shares/apps/{aid}/shares", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_share: {r.text[:300]}"}

            elif tool_name == "revoke_app_share":
                sid = tool_input.get("share_id")
                if not sid: return {"error": "share_id is required"}
                r = await client.delete(f"{ONTOLOGY_URL}/shares/{sid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            # ── API gateway ──────────────────────────────────────────────────
            elif tool_name == "list_api_endpoints":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                r = await client.get(f"{GW_URL}/gateway/manage", headers=headers)
                return {"endpoints": r.json() if r.is_success else []}

            elif tool_name == "create_api_endpoint":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{GW_URL}/gateway/manage", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_endpoint: {r.text[:300]}"}

            elif tool_name == "delete_api_endpoint":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                eid = tool_input.get("endpoint_id")
                if not eid: return {"error": "endpoint_id is required"}
                r = await client.delete(f"{GW_URL}/gateway/manage/{eid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "mint_api_key":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{GW_URL}/gateway/keys", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"mint_api_key: {r.text[:300]}"}

            elif tool_name == "revoke_api_key":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                kid = tool_input.get("key_id")
                if not kid: return {"error": "key_id is required"}
                r = await client.delete(f"{GW_URL}/gateway/keys/{kid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "toggle_api_key":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                kid = tool_input.get("key_id"); enabled = tool_input.get("enabled", True)
                if not kid: return {"error": "key_id is required"}
                r = await client.patch(f"{GW_URL}/gateway/keys/{kid}/toggle", json={"enabled": enabled}, headers=headers)
                return r.json() if r.is_success else {"error": f"toggle_key: {r.text[:300]}"}

            elif tool_name == "get_gateway_usage_summary":
                GW_URL = os.environ.get("API_GATEWAY_URL", "http://api-gateway-service:8021")
                params = {"time_range": tool_input.get("time_range", "7d")}
                r = await client.get(f"{GW_URL}/gateway/usage/summary", params=params, headers=headers)
                return r.json() if r.is_success else {"error": f"usage_summary: {r.text[:300]}"}

            # ── Process mining ───────────────────────────────────────────────
            elif tool_name == "discover_processes":
                r = await client.post(f"{PROCESS_URL}/process/processes/auto-discover", headers=headers, timeout=20)
                return r.json() if r.is_success else {"error": f"discover: {r.text[:300]}"}

            elif tool_name == "backfill_process_case_key":
                pid = tool_input.get("process_id")
                if not pid: return {"error": "process_id is required"}
                r = await client.post(f"{PROCESS_URL}/process/processes/{pid}/backfill", headers=headers, timeout=60)
                return r.json() if r.is_success else {"error": f"backfill: {r.text[:300]}"}

            elif tool_name == "list_conformance_models":
                pid = tool_input.get("process_id"); otid = tool_input.get("object_type_id")
                if pid:
                    r = await client.get(f"{PROCESS_URL}/process/conformance/models/by-process/{pid}", headers=headers)
                elif otid:
                    r = await client.get(f"{PROCESS_URL}/process/conformance/models/{otid}", headers=headers)
                else:
                    return {"error": "process_id or object_type_id required"}
                return {"models": r.json() if r.is_success else []}

            elif tool_name == "create_conformance_model":
                pid = tool_input.get("process_id"); otid = tool_input.get("object_type_id")
                body = {"name": tool_input.get("name"), "activities": tool_input.get("activities", []), "is_active": tool_input.get("is_active", True)}
                if pid:
                    r = await client.post(f"{PROCESS_URL}/process/conformance/models/by-process/{pid}", json=body, headers=headers)
                elif otid:
                    r = await client.post(f"{PROCESS_URL}/process/conformance/models/{otid}", json=body, headers=headers)
                else:
                    return {"error": "process_id or object_type_id required"}
                return r.json() if r.is_success else {"error": f"create_model: {r.text[:300]}"}

            elif tool_name == "check_conformance":
                mid = tool_input.get("model_id")
                pid = tool_input.get("process_id"); otid = tool_input.get("object_type_id")
                if not mid: return {"error": "model_id is required"}
                if pid:
                    r = await client.get(f"{PROCESS_URL}/process/conformance/check/by-process/{pid}/{mid}", headers=headers)
                elif otid:
                    r = await client.get(f"{PROCESS_URL}/process/conformance/check/{otid}/{mid}", headers=headers)
                else:
                    return {"error": "process_id or object_type_id required"}
                return r.json() if r.is_success else {"error": f"check_conformance: {r.text[:300]}"}

            # ── Read-only intel ──────────────────────────────────────────────
            elif tool_name == "search_everything":
                SEARCH_URL = os.environ.get("SEARCH_SERVICE_URL", "http://search-service:8018")
                params = {"q": tool_input.get("query", ""), "limit": tool_input.get("limit", 20)}
                r = await client.get(f"{SEARCH_URL}/search", params=params, headers=headers)
                return {"results": r.json() if r.is_success else []}

            elif tool_name == "get_lineage_graph":
                LINEAGE_URL = os.environ.get("LINEAGE_SERVICE_URL", "http://lineage-service:8017")
                path = "/lineage/graph/health" if tool_input.get("with_health", True) else "/lineage/graph"
                r = await client.get(f"{LINEAGE_URL}{path}", headers=headers, timeout=15)
                return r.json() if r.is_success else {"nodes": [], "edges": []}

            elif tool_name == "get_node_upstream":
                LINEAGE_URL = os.environ.get("LINEAGE_SERVICE_URL", "http://lineage-service:8017")
                nid = tool_input.get("node_id")
                if not nid: return {"error": "node_id is required"}
                r = await client.get(f"{LINEAGE_URL}/lineage/node/{nid}/upstream", headers=headers)
                return r.json() if r.is_success else {"error": f"upstream: {r.text[:300]}"}

            elif tool_name == "get_node_downstream":
                LINEAGE_URL = os.environ.get("LINEAGE_SERVICE_URL", "http://lineage-service:8017")
                nid = tool_input.get("node_id")
                if not nid: return {"error": "node_id is required"}
                r = await client.get(f"{LINEAGE_URL}/lineage/node/{nid}/downstream", headers=headers)
                return r.json() if r.is_success else {"error": f"downstream: {r.text[:300]}"}

            elif tool_name == "get_impact_analysis":
                LINEAGE_URL = os.environ.get("LINEAGE_SERVICE_URL", "http://lineage-service:8017")
                nid = tool_input.get("node_id")
                if not nid: return {"error": "node_id is required"}
                r = await client.get(f"{LINEAGE_URL}/lineage/impact/{nid}", headers=headers)
                return r.json() if r.is_success else {"error": f"impact: {r.text[:300]}"}

            elif tool_name == "get_data_quality_summary":
                DQ_URL = os.environ.get("DATA_QUALITY_URL", "http://data-quality-service:8019")
                r = await client.get(f"{DQ_URL}/quality/summary", headers=headers, timeout=15)
                return {"summary": r.json() if r.is_success else []}

            elif tool_name == "get_data_quality_for_object_type":
                DQ_URL = os.environ.get("DATA_QUALITY_URL", "http://data-quality-service:8019")
                otid = tool_input.get("object_type_id")
                if not otid: return {"error": "object_type_id is required"}
                r = await client.get(f"{DQ_URL}/quality/{otid}", headers=headers, timeout=20)
                return r.json() if r.is_success else {"error": f"quality: {r.text[:300]}"}

            elif tool_name == "scan_pii_for_object_type":
                INFER_URL = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8003")
                otid = tool_input.get("object_type_id")
                if not otid: return {"error": "object_type_id is required"}
                r = await client.post(f"{INFER_URL}/infer/scan-pii", json={"object_type_id": otid}, headers=headers, timeout=60)
                return r.json() if r.is_success else {"error": f"scan_pii: {r.text[:300]}"}

            elif tool_name == "scan_all_pii":
                INFER_URL = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8003")
                r = await client.post(f"{INFER_URL}/infer/scan-all", headers=headers, timeout=15)
                return r.json() if r.is_success else {"error": f"scan_all: {r.text[:300]}"}

            elif tool_name == "get_pii_scan_results":
                INFER_URL = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8003")
                sid = tool_input.get("scan_id")
                if not sid: return {"error": "scan_id is required"}
                r = await client.get(f"{INFER_URL}/infer/scan-results/{sid}", headers=headers)
                return r.json() if r.is_success else {"error": f"scan_results: {r.text[:300]}"}

            elif tool_name == "extract_document_fields":
                INFER_URL = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8003")
                body = {k: v for k, v in tool_input.items() if v is not None}
                r = await client.post(f"{INFER_URL}/infer/extract-from-document", json=body, headers=headers, timeout=120)
                return r.json() if r.is_success else {"error": f"extract: {r.text[:300]}"}

            # ── Notebooks & comments ─────────────────────────────────────────
            elif tool_name == "list_notebooks":
                r = await client.get(f"{ONTOLOGY_URL}/notebooks", headers=headers)
                return {"notebooks": r.json() if r.is_success else []}

            elif tool_name == "create_notebook":
                body = {"name": tool_input.get("name"), "cells": tool_input.get("cells", [])}
                r = await client.post(f"{ONTOLOGY_URL}/notebooks", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"create_notebook: {r.text[:300]}"}

            elif tool_name == "delete_notebook":
                nid = tool_input.get("notebook_id")
                if not nid: return {"error": "notebook_id is required"}
                r = await client.delete(f"{ONTOLOGY_URL}/notebooks/{nid}", headers=headers)
                return {"success": r.is_success, "status": r.status_code}

            elif tool_name == "list_comments":
                COLL_URL = os.environ.get("COLLABORATION_URL", "http://collaboration-service:8020")
                params = {"entity_type": tool_input.get("entity_type"), "entity_id": tool_input.get("entity_id")}
                r = await client.get(f"{COLL_URL}/comments", params=params, headers=headers)
                return {"comments": r.json() if r.is_success else []}

            elif tool_name == "add_comment":
                COLL_URL = os.environ.get("COLLABORATION_URL", "http://collaboration-service:8020")
                body = {k: v for k, v in tool_input.items() if v is not None}
                # Default author info from headers — caller may override
                r = await client.post(f"{COLL_URL}/comments", json=body, headers=headers)
                return r.json() if r.is_success else {"error": f"add_comment: {r.text[:300]}"}

            elif tool_name == "resolve_comment":
                COLL_URL = os.environ.get("COLLABORATION_URL", "http://collaboration-service:8020")
                cid = tool_input.get("comment_id")
                if not cid: return {"error": "comment_id is required"}
                r = await client.patch(f"{COLL_URL}/comments/{cid}", json={"resolved": True}, headers=headers)
                return r.json() if r.is_success else {"error": f"resolve_comment: {r.text[:300]}"}

            elif tool_name == "web_search":
                query = tool_input.get("query", "").strip()
                if not query:
                    return {"error": "query is required"}
                max_results = min(int(tool_input.get("max_results", 5) or 5), 10)
                r = await client.post(
                    f"{SCRAPING_URL}/search",
                    json={"query": query, "max_results": max_results},
                    timeout=20,
                )
                return r.json() if r.is_success else {"error": f"web_search: {r.text[:300]}"}

            elif tool_name == "scrape_url":
                url = tool_input.get("url", "").strip()
                if not url:
                    return {"error": "url is required"}
                body = {
                    "url": url,
                    "use_stealth": bool(tool_input.get("use_stealth", False)),
                    "extract_text": bool(tool_input.get("extract_text", True)),
                }
                r = await client.post(f"{SCRAPING_URL}/scrape", json=body, timeout=30)
                return r.json() if r.is_success else {"error": f"scrape_url: {r.text[:300]}"}

            else:
                return {"error": f"Unknown tool: {tool_name}"}

        except Exception as e:
            return {"error": str(e)}
