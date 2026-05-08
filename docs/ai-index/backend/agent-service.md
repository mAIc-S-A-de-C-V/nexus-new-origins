# agent-service (port 8013)

**Purpose:** Configurable AI agents with tool use, conversation threads, model-provider management, schedules, event-driven pipeline triggers. **Owns the `model_providers` table** read by `shared/llm_router.py` from every other service.
**Stack:** Python FastAPI, SQLAlchemy async, asyncpg, APScheduler, anthropic + openai SDKs, httpx.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/agent_service/`

## Files

```
agent_service/
├── main.py                 FastAPI; 5 routers; lifespan: load_schedules_from_db, start scheduler
├── database.py             ORM: AgentConfig, AgentThread, AgentMessage, AgentRun, ModelProvider, AgentSchedule, PipelineTrigger, AgentConfigVersion
├── runtime.py              run_agent(), stream_agent() — agentic loop with Claude/OpenAI + tool_use
├── tools.py                TOOL_DEFINITIONS dict + execute_tool() dispatcher (34+ tools)
├── scheduler.py            APScheduler + schedule loading/firing
├── triggers.py             fire_trigger() + fire_event() — event-driven agent execution
├── auth_middleware.py      Local copy
├── nexus_logging.py        Local copy
├── routers/
│   ├── agents.py           CRUD + test + analytics + versions + knowledge-scope
│   ├── threads.py          Thread CRUD + messages (sync/stream)
│   ├── model_providers.py  Provider CRUD + test (validates API key)
│   ├── schedules.py        Per-agent cron schedules
│   └── triggers.py         Pipeline triggers + internal /events receiver
├── requirements.txt
└── Dockerfile
```

## Tables

| Table | Purpose |
|-------|---------|
| `agent_configs` | tenant_id, name, system_prompt, model, enabled_tools[], tool_config, max_iterations, knowledge_scope JSON |
| `agent_config_versions` | snapshot history for restore |
| `agent_threads` | tenant_id, agent_id, title, status (open/closed), created_by |
| `agent_messages` | thread_id, role (user/assistant/tool_use/tool_result), content, tool_name, tool_use_id, tool_input, tool_result |
| `agent_runs` | iterations, tool_calls[], steps[], final_text, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, duration_ms |
| **`model_providers`** | tenant_id, name, **provider_type** (anthropic/openai/google/azure_openai/local), api_key_encrypted, base_url, models[] (with context_window), is_default, enabled — **read by `shared/llm_router.py`** |
| `agent_schedules` | agent_id, name, prompt, cron_expression, enabled, last_run_at |
| `pipeline_triggers` | pipeline_id, agent_id, on_new_only, min_new_rows, mode (per_row/per_batch), max_concurrent, prompt_template, row_filter[], dedupe_action_name, dedupe_field |

## Endpoints

### `/agents` (`routers/agents.py`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/agents/tools` | List all available tools. |
| GET/POST | `/agents` | List / create. |
| GET/PUT/DELETE | `/agents/{id}` | CRUD. |
| PUT | `/agents/{id}/knowledge-scope` | Restrict data access. |
| POST | `/agents/{id}/test` | Run sync. |
| POST | `/agents/{id}/test/stream` | SSE stream. |
| GET | `/agents/{id}/versions` | Version list. |
| POST | `/agents/{id}/versions/{v}/restore` | Restore. |
| GET | `/agents/{id}/analytics` | Run metrics. |

### `/threads` (`routers/threads.py`)

GET/POST `/threads`, GET `/threads/{id}/messages`, POST `/threads/{id}/messages` (sync or stream).

### `/model-providers` (`routers/model_providers.py`)

CRUD + `POST /model-providers/{id}/test` to validate API key.

`provider_type` ∈ `{anthropic, openai, google, azure_openai, local}` (`VALID_TYPES`).

### `/agents/{id}/schedules` (`routers/schedules.py`) and `/triggers` (`routers/triggers.py`)

`POST /triggers/events` is the **internal receiver** — pipeline-service POSTs here after a run completes (with `x-internal: nexus-internal`). Triggers fire matching agents either per-row or per-batch.

## Tool registry (121 tools in `tools.py`)

The registry was expanded in 2026-05 from 20 → 121 tools so agents can drive the platform end-to-end without humans navigating the UI. Every tool is also a candidate `nexus-action` type for the Nexus Assistant via the table-driven dispatcher in `frontend/src/shell/NexusAssistant.tsx:GENERIC_ACTION_REGISTRY`.

### Read / discovery (no side effects)
```
list_object_types       get_object_schema     query_records         count_records
list_actions            list_connectors       list_pipelines        list_logic_functions
list_agents             list_eval_suites      list_alert_rules      list_pending_approvals
list_approval_workflows list_checkpoints      list_users            list_tenants
list_model_providers    list_apps             list_api_endpoints    list_ontology_links
list_pipeline_schedules list_processes_v2     list_conformance_models  list_notebooks
list_comments           query_audit_log       search_everything     get_lineage_graph
get_node_upstream       get_node_downstream   get_impact_analysis
get_data_quality_summary  get_data_quality_for_object_type
get_pii_scan_results    get_pipeline_runs     get_eval_run          query_process
find_object_touchpoints utility_list          get_gateway_usage_summary
```

### Lifecycle CRUD (mutating, prompt for confirmation)
```
update_connector        delete_connector      test_connector
update_pipeline         delete_pipeline
update_object_type      delete_object_type    apply_enrichment      delete_ontology_link
update_logic_function   delete_logic_function publish_logic_function
create_agent            update_agent          delete_agent          set_agent_knowledge_scope
update_app              delete_app            create_app_share      revoke_app_share
update_model_provider   delete_model_provider test_model_provider
delete_user             update_user           invite_user
```

### Schedules + recurring runs
```
create_pipeline_schedule update_pipeline_schedule delete_pipeline_schedule run_pipeline_schedule_now
create_logic_schedule   delete_logic_schedule
create_agent_schedule   delete_agent_schedule
```

### Triggers + agentic chaining
```
create_pipeline_trigger test_fire_trigger     delete_pipeline_trigger    agent_call (recursive)
```

### Eval suites
```
create_eval_suite       add_eval_case         run_eval_suite        get_eval_run
```

### Alerts
```
create_alert_rule       update_alert_rule     delete_alert_rule     test_alert_rule
configure_notification_channel  test_notification_channels
acknowledge_notification snooze_notification
```

### Approvals + checkpoints (audit-service)
```
create_approval_workflow update_approval_workflow delete_approval_workflow
approve_request          reject_request
create_checkpoint        update_checkpoint        delete_checkpoint
```

### API gateway
```
create_api_endpoint      delete_api_endpoint
mint_api_key             revoke_api_key            toggle_api_key
```

### Process mining
```
discover_processes       backfill_process_case_key
create_conformance_model check_conformance
```

### PII + document extraction (inference-service)
```
scan_pii_for_object_type  scan_all_pii         get_pii_scan_results
extract_document_fields
```

### Notebooks + comments
```
create_notebook         delete_notebook
add_comment             resolve_comment
```

### Pipeline + run + utility (existing)
```
create_pipeline         run_pipeline           process_mining        utility_run
```

### Web (scraping-service)
```
web_search              scrape_url
```

Each entry has `input_schema`. `execute_tool()` dispatches to the appropriate async handler that calls another service.

## Cross-service callouts (per tool)

| Tool | Target |
|------|--------|
| `list_object_types`, `get_object_schema`, `query_records`, `count_records`, `action_propose`, `list_actions` | ontology-service |
| `logic_function_run` | logic-service |
| `agent_call` | agent-service (recursive) |
| `process_mining` | process-engine |
| `utility_list`, `utility_run` | utility-service |
| `list_connectors` | connector-service |
| `list_pipelines`, `create_pipeline`, `run_pipeline` | pipeline-service |
| `web_search`, `scrape_url` | scraping-service |

Inbound: pipeline-service POSTs to `/triggers/events` after pipeline completion.

## Env

`DATABASE_URL`, `ONTOLOGY_SERVICE_URL`, `LOGIC_SERVICE_URL`, `UTILITY_SERVICE_URL`, `SCRAPING_SERVICE_URL`, `PIPELINE_SERVICE_URL`, `CONNECTOR_SERVICE_URL`, `PROCESS_ENGINE_URL`, `AGENT_SERVICE_URL`, `ANTHROPIC_API_KEY`, `ADMIN_SERVICE_URL`, `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Add a new tool | `tools.py:TOOL_DEFINITIONS` (input_schema) + handler in `execute_tool()` dispatcher. Frontend `AgentStudio.tsx:TOOL_META` for description. |
| Modify the agent loop | `runtime.py:run_agent` / `stream_agent` (token tracking, max iterations, tool result formatting). |
| Add a new provider type | `routers/model_providers.py:VALID_TYPES` + test handler + `shared/llm_router.py` mapping. |
| Add scheduled automation type | `scheduler.py:load_schedules_from_db()`. |
| Add new trigger mode | `triggers.py:VALID_OPS / VALID_MODES` + `fire_trigger()`. |
| Expose new agent metadata | `database.py:AgentConfigRow` + `routers/agents.py` serialization. |
| Tighten data scope | `runtime.py` apply `knowledge_scope` filter to tool calls. |
