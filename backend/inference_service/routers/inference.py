import os
import json
from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import AsyncAnthropic
import httpx
from shared.models import InferenceResult, SimilarityScore, FieldConflict
from claude_client import ClaudeInferenceClient

PIPELINE_SERVICE_URL = os.environ.get("PIPELINE_SERVICE_URL", "http://pipeline-service:8002")
LOGIC_SERVICE_URL = os.environ.get("LOGIC_SERVICE_URL", "http://logic-service:8012")

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
        raise HTTPException(status_code=503, detail=str(e))
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
Connectors pull data from external systems. Supported types: HubSpot, REST_API, Fireflies.
After connecting, run the associated pipeline to sync records into the Ontology.

## SMTP / Email
Set these env vars in docker-compose or .env:
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
- In .env files, escape `$` as `$$`
- GoDaddy Workspace Email: host=smtpout.secureserver.net, port=587 or 465
- If 2FA is enabled, generate an app password from GoDaddy Workspace Email settings

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
            ctx_lines.append(f"- **{ot.get('display_name') or ot.get('name')}** (id: `{ot['id']}`, {len(props)} properties: {', '.join(prop_names)})")
            samples = ot.get("sample_records", [])
            if samples:
                ctx_lines.append(f"  - Sample: `{json.dumps(samples[0])[:300]}`")
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
    object_type_name: str
    fields: list[str] = []
    records: list[dict] = []


@router.post("/chat")
async def chat_with_data(req: ChatRequest):
    """
    Answer a natural language question about provided records.
    Returns a markdown answer from Claude, optionally with embedded widget specs.
    """
    try:
        answer = client.chat_with_data(
            question=req.question,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            fields=req.fields,
            records=req.records,
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
    connectors: list[dict] = []       # [{id, name, type}]
    object_types: list[dict] = []     # [{id, name}]


@router.post("/create-pipeline")
async def create_pipeline(
    req: CreatePipelineRequest,
    x_tenant_id: str = Header(default="tenant-001"),
):
    """Generate and optionally persist a pipeline from a natural language description."""
    try:
        pipeline_config = await client.create_pipeline_from_description(
            description=req.description,
            connectors=req.connectors,
            object_types=req.object_types,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline generation failed: {e}")

    pipeline_name = pipeline_config.get("name", "Untitled Pipeline")

    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
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
