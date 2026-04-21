import os
import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import AsyncAnthropic
import httpx
from shared.models import InferenceResult, SimilarityScore, FieldConflict
from shared.token_tracker import track_token_usage
from claude_client import ClaudeInferenceClient

PIPELINE_SERVICE_URL = os.environ.get("PIPELINE_SERVICE_URL", "http://pipeline-service:8002")
LOGIC_SERVICE_URL = os.environ.get("LOGIC_SERVICE_URL", "http://logic-service:8012")
ONTOLOGY_SERVICE_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
ANALYTICS_SERVICE_URL = os.environ.get("ANALYTICS_SERVICE_URL", "http://analytics-service:8007")
CONNECTOR_SERVICE_URL = os.environ.get("CONNECTOR_SERVICE_URL", "http://connector-service:8001")

router = APIRouter()
client = ClaudeInferenceClient()


class SchemaInferRequest(BaseModel):
    connector_id: str
    raw_schema: dict
    sample_rows: list[dict] = []


class SimilarityRequest(BaseModel):
    schema_a: dict
    schema_a_id: str
    object_type: dict
    object_type_id: str


class ConflictRequest(BaseModel):
    existing_object: dict
    incoming_schema: dict


class NewObjectRequest(BaseModel):
    incoming_schema: dict
    existing_objects: list[dict] = []


@router.post("/schema", response_model=InferenceResult)
async def infer_schema(req: SchemaInferRequest):
    """
    Run AI-powered schema inference on a raw connector schema.
    Returns field-level semantic types, PII levels, and suggested canonical names.
    """
    return client.infer_schema(
        connector_id=req.connector_id,
        raw_schema=req.raw_schema,
        sample_rows=req.sample_rows,
    )


@router.post("/similarity", response_model=SimilarityScore)
async def score_similarity(req: SimilarityRequest):
    """
    Score semantic similarity between an incoming schema and an existing ObjectType.
    Used to determine which scenario (enrichment/conflict/new) applies.
    """
    return client.score_similarity(
        existing_object=req.object_type,
        incoming_schema=req.schema_a,
        schema_a_id=req.schema_a_id,
        object_type_id=req.object_type_id,
    )


@router.post("/conflicts", response_model=list[FieldConflict])
async def detect_conflicts(req: ConflictRequest):
    """
    Detect schema conflicts between an existing ObjectType and incoming schema.
    Returns list of conflicts with suggested resolutions.
    """
    return client.detect_conflicts(
        existing_object=req.existing_object,
        incoming_schema=req.incoming_schema,
    )


@router.post("/suggest-object")
async def suggest_object_type(req: NewObjectRequest):
    """
    Suggest a new ObjectType definition for an incoming schema that has low similarity
    to any existing ObjectType.
    """
    return client.suggest_object_type(
        incoming_schema=req.incoming_schema,
        existing_objects=req.existing_objects,
    )


class GenerateAppRequest(BaseModel):
    description: str
    object_type_id: str
    object_type_name: str
    properties: list[str] = []
    sample_rows: list[dict] = []


@router.post("/generate-app")
async def generate_app_layout(req: GenerateAppRequest):
    """
    Generate a dashboard app layout from a natural language description.
    Returns a list of AppComponent configs ready for the frontend canvas.
    """
    try:
        return client.generate_app(
            description=req.description,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            properties=req.properties,
            sample_rows=req.sample_rows,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"App generation failed: {e}")


class GenerateWidgetRequest(BaseModel):
    description: str
    object_type_id: str
    object_type_name: str
    properties: list[str] = []
    sample_rows: list[dict] = []
    force_code: bool = False  # if True, always generate custom-code


@router.post("/generate-widget")
async def generate_widget(req: GenerateWidgetRequest):
    """
    Generate a single widget config from a natural language description.
    Returns one AppComponent config. If force_code=True or the request is complex,
    returns a custom-code widget with generated JavaScript.
    """
    try:
        if req.force_code:
            return client.generate_code_widget(
                description=req.description,
                object_type_id=req.object_type_id,
                object_type_name=req.object_type_name,
                properties=req.properties,
                sample_rows=req.sample_rows,
            )
        return client.generate_widget(
            description=req.description,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            properties=req.properties,
            sample_rows=req.sample_rows,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Widget generation failed: {e}")


@router.post("/generate-code")
async def generate_code_widget(req: GenerateWidgetRequest):
    """
    Always generates a custom-code widget — Claude writes arbitrary JS/React code
    to render exactly what the user asks for, with no preset widget type constraints.
    """
    try:
        return client.generate_code_widget(
            description=req.description,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            properties=req.properties,
            sample_rows=req.sample_rows,
        )
    except ValueError as e:
        detail = str(e)
        status = 503 if "API key" in detail else 422
        raise HTTPException(status_code=status, detail=detail)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Code widget generation failed: {e}")


class HelpRequest(BaseModel):
    messages: list[dict]  # [{role: "user"|"assistant", content: "..."}]
    context: dict = {}    # live platform state: functions, schedules, object_types, current_page


NEXUS_HELP_SYSTEM = """You are the Nexus platform assistant. Nexus is an AI-powered data operations platform.
Answer questions concisely and practically. Use markdown for formatting. Be direct — no fluff.

## Platform Overview
Nexus connects to external data sources (HubSpot, REST APIs, Fireflies, etc.) via Connectors,
maps that data into a unified Ontology (object types + records), and lets users build Logic Functions
and AI Agents on top of that data.

## Logic Studio (Logic Functions)
Logic Functions are sequential block pipelines that run LLM calls, query data, send emails, and take actions.

### Block Types
- **Ontology Query** — fetch records from any object type in the Ontology. Configure object type, filters, and limit.
- **LLM Call** — call Claude with a prompt template. Reference previous block outputs in the prompt. Define an output_schema to get structured JSON back.
- **Send Email** — send one or many emails via SMTP. If "To" resolves to a list, sends one per item.
- **Action** — propose or execute a write action on the Ontology.
- **Transform** — pass, extract a field, format a string, or filter a list in memory.

### Variable References
Use `{variable}` syntax anywhere in block fields:
- `{inputs.param_name}` — function input parameters
- `{block_id.result}` — result of a previous block
- `{block_id.result.field}` — nested field from a block result
- `{now}` — current UTC datetime
- `{now_minus_1d}` — 1 day ago
- `{now_minus_3d}` — 3 days ago
- `{now_minus_7d}` — 7 days ago
- `{now_minus_14d}` — 14 days ago
- `{now_minus_30d}` — 30 days ago

### Filter Operators
==, !=, contains, not_contains, starts_with, >, >=, <, <=, is_empty, is_not_empty

### Send Email — Batch Mode
If "To" field is set to a block reference like `{b1.result.emails}` that resolves to a list,
and Subject/Body are left blank, the runner sends one email per item using that item's
`to`, `subject`, and `body` fields. The LLM block should return: `{"emails": [{"to": "...", "subject": "...", "body": "..."}]}`

### Schedules
Click the Schedule tab in Logic Studio to set a cron schedule.
Cron format: `minute hour day month day_of_week` (UTC).
Examples: `0 9 * * 1-5` = weekdays at 9am UTC, `0 9 * * *` = every day at 9am UTC.
Use `{now_minus_7d}` in filter values instead of hardcoded dates so the schedule always uses a relative window.

## Agent Studio
Agents are AI assistants backed by Claude that have access to tools:
- ontology_search — search records across object types
- list_object_types — list available object types
- logic_function_run — run a Logic Function by ID
- action_propose — propose a write action
- list_actions — list available actions

Agents maintain conversation threads. Each thread is a persistent multi-turn conversation.

## Ontology
The Ontology is the unified data model. Object types have properties and records.
Records are synced from connectors via pipelines. Use the Ontology page to browse object types and their records.

## Connectors
Connectors pull data from external systems. Supported types: HubSpot, REST_API, Fireflies, WHATSAPP.
After connecting, run the associated pipeline to sync records into the Ontology.

## Pipelines (Data Pipelines)
Pipelines are DAGs (directed acyclic graphs) of processing nodes that ingest, transform, and write data.
Each pipeline has a chain of nodes connected by edges. When you describe a pipeline, mention all the node steps.

### Pipeline Node Types
- **SOURCE** — Ingests raw data from a connector. Config: `connectorId`, `endpoint` (optional). Supports REST_API, HubSpot, Fireflies, WHATSAPP connectors. For WHATSAPP, pulls messages with incremental timestamp watermark.
- **FILTER** — Filters records by a field condition. Config: `field`, `operator` (==, !=, contains, >, <, etc.), `value`.
- **MAP** — Renames or transforms fields. Config: `mappings` array of `{from, to}` pairs.
- **CAST** — Changes field data types. Config: `casts` array of `{field, toType}`.
- **ENRICH** — Adds computed/looked-up fields. Config: `enrichments` array.
- **FLATTEN** — Flattens nested arrays into rows. Config: `arrayField`, `prefix`.
- **DEDUPE** — Removes duplicate records. Config: `keys` (fields to deduplicate on).
- **VALIDATE** — Validates records against rules. Config: `rules` array.
- **LLM_CLASSIFY** — Sends records through Claude for AI classification and field extraction. Config:
  - `textField` — the field containing text to classify (e.g., "body", "message")
  - `prompt` — optional custom classification prompt (if omitted, uses built-in PNC police report classifier)
  - `model` — Claude model to use (default: claude-sonnet-4-6)
  - `batchSize` — records per LLM call (default: 10)
  - `createActions` — **if true, automatically creates Human Actions** for high-priority items (CRITICO/URGENTE). These appear in the Human Actions queue for analyst review and confirmation.
  - The built-in PNC classifier extracts: categoria, tipo_incidente, accion_policial, prioridad, departamento, municipio, lugar, fecha_hora, hecho, involucrados, incautaciones
  - Categories: BASURA (discard/spam), OPERATIVIDAD (routine ops), NOVEDAD RELEVANTE (significant incident)
  - Priority levels: CRITICO, URGENTE, IMPORTANTE, INFORMATIVA
- **SINK_OBJECT** — Writes records to an Ontology object type. Config: `objectTypeId` or `objectTypeName`.
- **SINK_EVENT** — Writes records as events to the process mining event log. Config: `objectTypeId`, `caseIdField`, `activityField`, `timestampField`.
- **AGENT_RUN** — Triggers an AI agent with each record as context.

### Human Actions
Human Actions are a review/approval queue. When LLM_CLASSIFY has `createActions: true`, it automatically creates pending action proposals for urgent items. Analysts see these in the Human Actions tab and can approve, reject, or modify them. This is critical for high-stakes workflows (e.g., police report triage) where AI classifies but humans confirm.

## SMTP / Email
Set these env vars in docker-compose or .env:
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
- In .env files, escape `$` as `$$`
- GoDaddy Workspace Email: host=smtpout.secureserver.net, port=587 or 465
- If 2FA is enabled, generate an app password from GoDaddy Workspace Email settings

## Taking Actions — CRITICAL
When the user asks you to **create** or **run** something (a connector, an object type, a pipeline, a logic function, etc.), do NOT just give instructions.
Instead, present a short plan, then output a fenced action block so the UI can render a confirmation card with Confirm/Cancel buttons.

You MUST use EXACTLY this format — a fenced code block with the language tag `nexus-action` (not `json`, not plain):

```nexus-action
{"type":"create_pipeline","name":"WhatsApp Ingest","summary":["Pull messages from WhatsApp connector","Write records to Ontology"],"payload":{"description":"Pull messages from WhatsApp and write to ontology"}}
```

IMPORTANT: The language tag MUST be `nexus-action` — not `json`, not empty. If you use any other tag the UI will NOT render the confirmation buttons.

Supported action types:
- `create_connector` — payload: `{"name": "...", "type": "REST_API", "category": "API", "description": "...", "base_url": "https://...", "auth_type": "None", "endpoints": [{"path":"/path","method":"GET","label":"..."}]}`
  Use type `REST_API` and category `API` for HTTP endpoints. Include `endpoints` array with the specific paths to call.
- `create_object_type` — payload: `{"name": "snake_case_name", "display_name": "Human Name", "description": "...", "properties": [{"name":"field_name","display_name":"Field Name","type":"string","description":"..."}]}`
  IMPORTANT: Every property MUST include `display_name` (human-readable label). Properties should reflect the expected data shape.
- `create_pipeline` — payload: `{"description": "...", "connectors": [{"id":"<real-id>","name":"<name>","type":"<type>"}], "object_types": [{"id":"<real-id>","name":"<name>"}]}`
  IMPORTANT: Include real connector IDs and object type IDs from the live context, not just names!
- `create_logic` — payload: `{"description": "...", "object_types": [{"id":"<real-id>","name":"<name>"}], "existing_functions": [...]}`
- `run_pipeline` — payload: `{"pipeline_id": "..."}`

Rules for action blocks:
1. Show a brief plan (bullet list) BEFORE the action block.
2. Include a `summary` array (3-6 short bullet strings) inside the block.
3. The `name` field appears as the card title.
4. When the user asks you to create multiple things (connectors + object type + pipeline), output ONE action block per message. After the user confirms and it succeeds, output the NEXT action block. Chain them sequentially — do NOT try to output all blocks at once.
5. If the request is ambiguous, ask a clarifying question instead of guessing.
6. Use the live context (connectors, object types, pipelines) to fill in real IDs and names.

## Answering Data Questions
When the user asks about data, events, records, or "what happened" (e.g., "Que ha pasado hoy?", "Show me recent incidents"),
look at the **recent records** in the Live Platform Context below. These are REAL records from the ontology.
- Summarize the records that match the user's question (filter by date, category, priority, etc.)
- Use the llm_ prefixed fields (llm_categoria, llm_prioridad, llm_tipo_incidente, llm_hecho, llm_departamento, etc.) for classified data
- Present the data in a clear, organized format (tables, bullet lists, grouped by priority/category)
- If there are records but none match the specific filter (e.g., today's date), say so and show the most recent ones available
- NEVER say "no records found" if the context contains records — always reference what IS available

Answer the user's question about how to use Nexus. If they ask about something not covered here, be honest and helpful."""


def build_help_system(context: dict) -> str:
    """Build the system prompt for /help and /stream-help from live platform context."""
    ctx_lines = []
    if context.get("current_page"):
        ctx_lines.append(f"User is currently on the **{context['current_page']}** page.")
    if context.get("functions"):
        fns = context["functions"]
        ctx_lines.append(f"\n## User's Logic Functions ({len(fns)} total)")
        for fn in fns:
            schedules = fn.get("schedules", [])
            sched_str = f", {len(schedules)} schedule(s)" if schedules else ""
            ctx_lines.append(f"- **{fn['name']}** (id: `{fn['id']}`, status: {fn['status']}, {len(fn.get('blocks',[]))} blocks{sched_str})")
            for s in schedules:
                ctx_lines.append(f"  - Schedule: `{s['cron']}` — {s.get('label','')} — inputs: `{json.dumps(s.get('inputs',{}))}`")
            for b in fn.get("blocks", []):
                ctx_lines.append(f"  - Block `{b['id']}` ({b['type']})")
    if context.get("connectors"):
        conns = context["connectors"]
        ctx_lines.append(f"\n## Configured Connectors ({len(conns)} total)")
        for c in conns:
            status = c.get("status", "unknown")
            last_sync = c.get("last_sync") or "never"
            base_url = c.get("base_url") or ""
            ctx_lines.append(f"- **{c['name']}** (type: {c.get('type','REST_API')}, status: {status}, base_url: `{base_url}`, last_sync: {last_sync})")
            fields = c.get("schema_fields", [])
            if fields:
                ctx_lines.append(f"  - Fields: {', '.join(str(f) for f in fields[:20])}")
            sample = c.get("sample_row")
            if sample:
                ctx_lines.append(f"  - Sample record: `{json.dumps(sample)[:300]}`")
    if context.get("pipelines"):
        pipes = context["pipelines"]
        ctx_lines.append(f"\n## Pipelines ({len(pipes)} total)")
        for p in pipes:
            nodes = p.get("nodes", [])
            node_types = [n.get("type", "") for n in nodes]
            last_run = p.get("lastRunAt") or p.get("last_run_at") or "never"
            rows = p.get("lastRunRowCount") or p.get("last_run_row_count") or 0
            ctx_lines.append(f"- **{p['name']}** (status: {p.get('status','unknown')}, steps: {' → '.join(node_types)}, last_run: {last_run}, rows: {rows})")
    if context.get("object_types"):
        ots = context["object_types"]
        ctx_lines.append(f"\n## Ontology Object Types ({len(ots)} total)")
        for ot in ots:
            props = ot.get("properties", [])
            prop_names = [p.get("name", "") for p in props[:15]]
            total = ot.get("total_records", 0)
            ctx_lines.append(f"- **{ot.get('display_name') or ot.get('name')}** (id: `{ot['id']}`, {len(props)} properties: {', '.join(prop_names)}, total_records: {total})")
            records = ot.get("recent_records") or ot.get("sample_records") or []
            if records:
                ctx_lines.append(f"  ### Recent records ({len(records)} most recent of {total} total):")
                for i, rec in enumerate(records[:25]):
                    # Include key fields, truncate very long values
                    compact = {}
                    for k, v in rec.items():
                        if v is None:
                            continue
                        sv = str(v)
                        compact[k] = sv[:150] + "..." if len(sv) > 150 else v
                    ctx_lines.append(f"  - Record {i+1}: `{json.dumps(compact, ensure_ascii=False, default=str)[:500]}`")
    if context.get("selected_function"):
        sf = context["selected_function"]
        ctx_lines.append(f"\n## Currently Selected Function: {sf['name']}")
        ctx_lines.append(f"Input schema: {json.dumps(sf.get('input_schema', []))}")
        ctx_lines.append(f"Output block: {sf.get('output_block', 'not set')}")
        ctx_lines.append("Blocks:")
        for b in sf.get("blocks", []):
            ctx_lines.append(f"  - `{b['id']}` ({b['type']}): {json.dumps({k:v for k,v in b.items() if k not in ('id','type')})[:200]}")

    context_section = "\n".join(ctx_lines)
    system = NEXUS_HELP_SYSTEM
    if context_section:
        system += f"\n\n---\n## Live Platform Context (use this to give specific answers)\n{context_section}"
    return system


@router.post("/help")
async def platform_help(req: HelpRequest):
    """Answer questions about how to use the Nexus platform."""
    import anthropic as _anthropic
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        return {"answer": "ANTHROPIC_API_KEY not configured."}

    system = build_help_system(req.context)

    try:
        client_sdk = _anthropic.Anthropic(api_key=api_key)
        msg = client_sdk.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2048,
            system=system,
            messages=req.messages,
        )
        track_token_usage("unknown", "inference_service", "claude-sonnet-4-6",
                          msg.usage.input_tokens, msg.usage.output_tokens)
        return {"answer": msg.content[0].text}
    except Exception as e:
        return {"answer": f"Error: {e}"}


@router.post("/stream-help")
async def stream_help(req: HelpRequest, x_tenant_id: str = Header(default="tenant-001")):
    """Streaming SSE version of /help — returns token-by-token response."""
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    if not api_key:
        async def _error_gen():
            yield f"data: {json.dumps({'error': 'ANTHROPIC_API_KEY not configured'})}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(_error_gen(), media_type="text/event-stream")

    async_client = AsyncAnthropic(api_key=api_key)
    system = build_help_system(req.context)
    messages = [{"role": m["role"], "content": m["content"]} for m in req.messages]

    async def generate():
        try:
            async with async_client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=2048,
                system=system,
                messages=messages,
            ) as stream:
                async for text in stream.text_stream:
                    yield f"data: {json.dumps({'text': text})}\n\n"
                final_msg = await stream.get_final_message()
                track_token_usage(x_tenant_id, "inference_service", "claude-sonnet-4-6",
                                  final_msg.usage.input_tokens, final_msg.usage.output_tokens)
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


class ChatRequest(BaseModel):
    question: str
    object_type_id: str = ""
    object_type_ids: list[str] = []   # multiple data sources
    object_type_name: str = ""
    fields: list[str] = []
    records: list[dict] = []
    tenant_id: str = ""
    dashboard_widgets: list[dict] | None = None


async def _fetch_records_server_side(
    object_type_id: str, tenant_id: str
) -> tuple[list[dict], list[str], str, int]:
    """Fetch records + metadata from ontology service when frontend doesn't provide them."""
    headers = {"x-tenant-id": tenant_id} if tenant_id else {}
    async with httpx.AsyncClient(timeout=30) as hc:
        # Fetch object type metadata
        ot_name = ""
        fields: list[str] = []
        try:
            r = await hc.get(f"{ONTOLOGY_SERVICE_URL}/object-types/{object_type_id}", headers=headers)
            if r.is_success:
                ot = r.json()
                ot_name = ot.get("display_name") or ot.get("name", "")
                fields = [p["name"] for p in ot.get("properties", []) if not p["name"].endswith("[]")]
        except Exception:
            pass

        # Fetch records (up to 500 for context)
        records: list[dict] = []
        total = 0
        try:
            r = await hc.get(
                f"{ONTOLOGY_SERVICE_URL}/object-types/{object_type_id}/records?limit=500",
                headers=headers,
            )
            if r.is_success:
                d = r.json()
                records = d.get("records", [])
                total = d.get("total", len(records))
        except Exception:
            pass

    return records, fields, ot_name, total


async def _run_query_server_side(
    object_type_id: str, plan: dict, tenant_id: str
) -> list[dict] | dict:
    """Execute a Claude-generated query plan via the analytics service."""
    # Map chat plan operators to analytics filter ops
    op_map = {
        "eq": "eq", "neq": "neq", "contains": "contains",
        "gt": "gt", "gte": "gte", "lt": "lt", "lte": "lte",
        "after": "gt", "before": "lt",
    }
    filters = []
    for f in (plan.get("filters") or []):
        op = op_map.get(f.get("operator", "eq"), "eq")
        filters.append({"field": f["field"], "op": op, "value": str(f.get("value", ""))})

    body: dict = {
        "object_type_id": object_type_id,
        "filters": filters,
        "limit": min(plan.get("limit", 200), 500),
        "offset": 0,
        "select_fields": plan.get("selectFields") or [],
    }
    if plan.get("aggregation") and plan.get("aggregationField"):
        body["aggregate"] = {
            "function": plan["aggregation"].upper(),
            "field": plan["aggregationField"],
        }
    if plan.get("groupBy"):
        body["group_by"] = plan["groupBy"]
    if plan.get("sortBy"):
        body["order_by"] = {"field": plan["sortBy"], "direction": plan.get("sortDir", "asc")}

    headers = {"x-tenant-id": tenant_id} if tenant_id else {}
    try:
        async with httpx.AsyncClient(timeout=30) as hc:
            r = await hc.post(f"{ANALYTICS_SERVICE_URL}/explore/query", json=body, headers=headers)
            if r.is_success:
                result = r.json()
                return result.get("rows", result if isinstance(result, list) else [])
    except Exception:
        pass
    return []


@router.post("/chat")
async def chat_with_data(req: ChatRequest):
    client.tenant_id = req.tenant_id or "unknown"
    """
    Answer a natural language question about data.
    If records are provided, uses them directly (legacy).
    If only object_type_id is provided, fetches records server-side
    and runs queries via the analytics service for full data access.
    """
    try:
        records = req.records
        fields = req.fields
        ot_name = req.object_type_name
        total = len(records)

        # Resolve all object type IDs to fetch from
        all_ot_ids = list(dict.fromkeys(
            req.object_type_ids if req.object_type_ids else
            ([req.object_type_id] if req.object_type_id else [])
        ))

        # Server-side fetch when frontend doesn't send records
        if not records and all_ot_ids:
            all_records: list[dict] = []
            all_fields: list[str] = []
            ot_names: list[str] = []
            total = 0
            for ot_id in all_ot_ids:
                r, f, name, cnt = await _fetch_records_server_side(ot_id, req.tenant_id)
                all_records.extend(r)
                all_fields.extend(f)
                ot_names.append(name)
                total += cnt
            records = all_records
            fields = list(dict.fromkeys(all_fields))  # dedupe preserving order
            ot_name = ot_name or " + ".join(n for n in ot_names if n) or "Data"

        answer = client.chat_with_data(
            question=req.question,
            object_type_id=all_ot_ids[0] if all_ot_ids else "",
            object_type_name=ot_name or "Data",
            fields=fields,
            records=records,
            total_count=total,
            dashboard_widgets=req.dashboard_widgets,
        )
        return {"answer": answer}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")


# ---------------------------------------------------------------------------
# Phase 8 AI Copilot endpoints
# ---------------------------------------------------------------------------

class CreatePipelineRequest(BaseModel):
    description: str
    connectors: list = []             # [{id, name, type}] or ["name", ...]
    object_types: list = []           # [{id, name}] or ["name", ...]


@router.post("/create-pipeline")
async def create_pipeline(
    req: CreatePipelineRequest,
    x_tenant_id: str = Header(default="tenant-001"),
):
    """Generate and optionally persist a pipeline from a natural language description."""
    client.tenant_id = x_tenant_id
    # Normalize: accept string lists or dict lists
    connectors = [c if isinstance(c, dict) else {"name": c} for c in req.connectors]
    object_types = [o if isinstance(o, dict) else {"name": o} for o in req.object_types]

    # Fetch real connector/object-type lookups so we can fix IDs in the generated config
    connector_lookup: dict[str, dict] = {}
    ot_lookup: dict[str, dict] = {}
    headers = {"x-tenant-id": x_tenant_id}
    try:
        async with httpx.AsyncClient(timeout=8) as hc:
            cr = await hc.get(f"{CONNECTOR_SERVICE_URL}/connectors", headers=headers)
            if cr.is_success:
                for c in cr.json():
                    connector_lookup[c["name"].lower()] = c
                    connector_lookup[c["id"]] = c
            otr = await hc.get(f"{ONTOLOGY_SERVICE_URL}/object-types", headers=headers)
            if otr.is_success:
                for ot in otr.json():
                    ot_lookup[(ot.get("display_name") or ot.get("name", "")).lower()] = ot
                    ot_lookup[ot.get("name", "").lower()] = ot
                    ot_lookup[ot["id"]] = ot
    except Exception:
        pass  # best-effort lookup

    # Enrich input connectors/object_types with real IDs for the LLM prompt
    for c in connectors:
        if "id" not in c and c.get("name"):
            found = connector_lookup.get(c["name"].lower())
            if found:
                c["id"] = found["id"]
                c["type"] = found.get("type", "REST_API")
        # Always enrich with base_url and endpoints from connector config
        found = connector_lookup.get(c.get("id", "")) or connector_lookup.get((c.get("name") or "").lower())
        if found:
            c["base_url"] = found.get("base_url", "")
            cfg = found.get("config") or {}
            if cfg.get("endpoints"):
                c["endpoints"] = cfg["endpoints"]
    for ot in object_types:
        if "id" not in ot and ot.get("name"):
            found = ot_lookup.get(ot["name"].lower())
            if found:
                ot["id"] = found["id"]
                ot["name"] = found.get("name", ot["name"])

    try:
        pipeline_config = await client.create_pipeline_from_description(
            description=req.description,
            connectors=connectors,
            object_types=object_types,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline generation failed: {e}")

    # Post-process: fix connector_id and objectTypeId in generated nodes
    for node in pipeline_config.get("nodes", []):
        cfg = node.get("config", {})
        if node.get("type") == "SOURCE":
            cid = cfg.get("connector_id", "")
            if cid and cid not in connector_lookup:
                # LLM used a name or fake ID — resolve it
                for real in connector_lookup.values():
                    if real.get("name", "").lower() in cid.lower() or cid.lower() in real.get("name", "").lower():
                        cfg["connector_id"] = real["id"]
                        break
            # Also try from the request connectors
            if cfg.get("connector_id", "") not in connector_lookup and connectors:
                first = connectors[0]
                if first.get("id"):
                    cfg["connector_id"] = first["id"]
        if node.get("type") in ("SINK_OBJECT", "SINK_EVENT"):
            otid = cfg.get("objectTypeId", "")
            if otid and otid not in ot_lookup:
                for real in ot_lookup.values():
                    name = real.get("display_name") or real.get("name", "")
                    if name.lower() in otid.lower() or otid.lower() in name.lower():
                        cfg["objectTypeId"] = real["id"]
                        break
            if cfg.get("objectTypeId", "") not in ot_lookup and object_types:
                first = object_types[0]
                if first.get("id"):
                    cfg["objectTypeId"] = first["id"]

    pipeline_name = pipeline_config.get("name", "Untitled Pipeline")

    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            resp = await http.post(
                f"{PIPELINE_SERVICE_URL}/pipelines",
                json=pipeline_config,
                headers={"x-tenant-id": x_tenant_id},
            )
            resp.raise_for_status()
            created_data = resp.json()
        return {
            "created": True,
            "pipeline_id": created_data.get("id"),
            "pipeline_name": pipeline_name,
            "message": "Pipeline created successfully.",
            "preview": pipeline_config,
        }
    except Exception as e:
        return {
            "created": False,
            "pipeline_id": None,
            "pipeline_name": pipeline_name,
            "message": str(e),
            "preview": pipeline_config,
        }


class CreateLogicRequest(BaseModel):
    description: str
    object_types: list[dict] = []        # [{id, name, properties: [{name}]}]
    existing_functions: list[dict] = []  # [{id, name}]


@router.post("/create-logic")
async def create_logic(
    req: CreateLogicRequest,
    x_tenant_id: str = Header(default="tenant-001"),
):
    """Generate and optionally persist a logic function from a natural language description."""
    client.tenant_id = x_tenant_id
    try:
        logic_config = await client.create_logic_function(
            description=req.description,
            object_types=req.object_types,
            existing_functions=req.existing_functions,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Logic function generation failed: {e}")

    function_name = logic_config.get("name", "Untitled Function")
    blocks_count = len(logic_config.get("blocks", []))

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            resp = await http.post(
                f"{LOGIC_SERVICE_URL}/logic/functions",
                json=logic_config,
                headers={"x-tenant-id": x_tenant_id},
            )
            resp.raise_for_status()
            created_data = resp.json()
        return {
            "created": True,
            "function_id": created_data.get("id"),
            "function_name": function_name,
            "blocks_count": blocks_count,
            "message": "Logic function created successfully.",
            "preview": logic_config,
        }
    except Exception as e:
        return {
            "created": False,
            "function_id": None,
            "function_name": function_name,
            "blocks_count": blocks_count,
            "message": str(e),
            "preview": logic_config,
        }


class ExplainLineageRequest(BaseModel):
    nodes: list[dict]           # [{id, type, label, status, meta}]
    edges: list[dict]           # [{id, source, target, label}]
    focus_node_id: Optional[str] = None


@router.post("/explain-lineage")
async def explain_lineage(
    req: ExplainLineageRequest,
    x_tenant_id: str = Header(default="tenant-001"),
):
    """Explain a data lineage graph in plain English and surface any anomalies."""
    client.tenant_id = x_tenant_id
    try:
        result = await client.explain_lineage(
            nodes=req.nodes,
            edges=req.edges,
            focus_node_id=req.focus_node_id,
        )
        return {
            "explanation": result.get("explanation", ""),
            "findings": result.get("findings", []),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lineage explanation failed: {e}")


class SurfaceAnomaliesRequest(BaseModel):
    object_type_id: str
    object_type_name: str
    fields: list[str] = []
    records: list[dict] = []   # up to 100 records


@router.post("/surface-anomalies")
async def surface_anomalies(
    req: SurfaceAnomaliesRequest,
    x_tenant_id: str = Header(default="tenant-001"),
):
    """Detect data quality anomalies in a set of records."""
    client.tenant_id = x_tenant_id
    try:
        result = await client.surface_anomalies(
            object_type_name=req.object_type_name,
            fields=req.fields,
            records=req.records[:100],
        )
        return {
            "anomalies": result.get("anomalies", []),
            "summary": result.get("summary", ""),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Anomaly detection failed: {e}")
