"""
Agent configuration CRUD.
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func as sqlfunc
from database import AgentConfigRow, AgentConfigVersionRow, AgentRunRow, get_session
from runtime import run_agent, stream_agent

router = APIRouter()

AVAILABLE_TOOLS = [
    "list_object_types",
    "get_object_schema",
    "query_records",
    "count_records",
    "logic_function_run",
    "action_propose",
    "list_actions",
    "agent_call",
    "process_mining",
    "utility_list",
    "utility_run",
    "list_connectors",
    "list_pipelines",
    "create_pipeline",
    "run_pipeline",
    "web_search",
    "scrape_url",
]


class KnowledgeScopeEntry(BaseModel):
    object_type_id: str
    label: str
    filter: Optional[dict] = None  # { field, op, value } or None


class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    system_prompt: str
    model: str = "claude-haiku-4-5-20251001"
    enabled_tools: list[str] = []
    tool_config: dict = {}
    max_iterations: int = 10
    knowledge_scope: Optional[list[dict]] = None  # null = unrestricted
    enabled: bool = True


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    enabled_tools: Optional[list[str]] = None
    tool_config: Optional[dict] = None
    max_iterations: Optional[int] = None
    knowledge_scope: Optional[list[dict]] = None
    enabled: Optional[bool] = None


def _to_dict(row: AgentConfigRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "system_prompt": row.system_prompt,
        "model": row.model,
        "enabled_tools": row.enabled_tools or [],
        "tool_config": row.tool_config or {},
        "max_iterations": row.max_iterations,
        "knowledge_scope": row.knowledge_scope,  # null = unrestricted
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/tools")
async def list_available_tools():
    """List all tool names the platform supports."""
    return {"tools": AVAILABLE_TOOLS}


@router.get("")
async def list_agents(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow)
        .where(AgentConfigRow.tenant_id == tenant_id)
        .order_by(AgentConfigRow.created_at.desc())
    )
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_agent(
    body: AgentCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = AgentConfigRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
        model=body.model,
        enabled_tools=body.enabled_tools,
        tool_config=body.tool_config,
        max_iterations=body.max_iterations,
        knowledge_scope=body.knowledge_scope,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.get("/{agent_id}")
async def get_agent(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _to_dict(row)


@router.put("/{agent_id}")
async def update_agent(
    agent_id: str,
    body: AgentUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")

    if body.name is not None:
        row.name = body.name
    if body.description is not None:
        row.description = body.description
    if body.system_prompt is not None:
        row.system_prompt = body.system_prompt
    if body.model is not None:
        row.model = body.model
    if body.enabled_tools is not None:
        row.enabled_tools = body.enabled_tools
    if body.tool_config is not None:
        row.tool_config = body.tool_config
    if body.max_iterations is not None:
        row.max_iterations = body.max_iterations
    if body.knowledge_scope is not None:
        row.knowledge_scope = body.knowledge_scope
    if body.enabled is not None:
        row.enabled = body.enabled

    # Commit the row changes first so updated_at is set by the DB
    await db.commit()
    await db.refresh(row)

    # Save version snapshot after commit so all fields (including updated_at) are correct
    version_count_result = await db.execute(
        select(sqlfunc.count()).select_from(AgentConfigVersionRow).where(AgentConfigVersionRow.agent_id == agent_id)
    )
    next_version = (version_count_result.scalar() or 0) + 1
    db.add(AgentConfigVersionRow(
        id=str(uuid4()), agent_id=agent_id, tenant_id=tenant_id,
        version_number=next_version, config_snapshot=_to_dict(row),
    ))
    await db.commit()
    return _to_dict(row)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    await db.delete(row)
    await db.commit()


class KnowledgeScopeUpdate(BaseModel):
    # null clears scope (agent becomes unrestricted again)
    scope: Optional[list[dict]] = None


@router.put("/{agent_id}/knowledge-scope")
async def set_knowledge_scope(
    agent_id: str,
    body: KnowledgeScopeUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Replace the agent's knowledge scope. Pass scope=null to make the agent unrestricted."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    row.knowledge_scope = body.scope  # None = unrestricted
    await db.commit()
    return _to_dict(row)


# ── Inline run (no saved agent required) ─────────────────────────────────────

DEFAULT_WHATSAPP_PROMPT = """Eres el Asistente Nexus en WhatsApp. Responde siempre en español.
Tu trabajo es ayudar al usuario con datos, automatizaciones y tareas de la plataforma Nexus.

PROCEDIMIENTO para cada solicitud:
1. Primero usa list_object_types para entender qué datos existen en la plataforma
2. Si el usuario pide datos, usa get_object_schema para ver los campos y luego query_records para buscar
3. Si el usuario pide ejecutar algo recurrente, busca funciones lógicas existentes (logic_function_run)
4. Si no existe una función para lo que pide, usa las herramientas directamente:
   - utility_run con web_scrape o rss_fetch para datos externos de internet
   - utility_run con http_request para APIs externas
   - create_pipeline para crear flujos de datos nuevos
   - run_pipeline para ejecutar pipelines existentes
5. Para reportes complejos: recopila datos con query_records o utility_run, luego resume

FORMATO DE RESPUESTA:
- Máximo 3000 caracteres (límite de WhatsApp)
- Usa *negrita* para títulos
- Usa listas con - para enumerar datos
- Sé conciso y directo
- No uses bloques de código (backticks)
- No repitas la pregunta del usuario
- Si los datos son muchos, muestra un resumen con los más relevantes"""


class InlineRunRequest(BaseModel):
    message: str
    system_prompt: str = ""
    model: str = "claude-haiku-4-5-20251001"
    enabled_tools: list[str] = []
    max_iterations: int = 12
    conversation_history: list[dict] = []
    knowledge_scope: Optional[list[dict]] = None
    dry_run: bool = False


@router.post("/run-inline")
async def run_inline(
    body: InlineRunRequest,
    x_tenant_id: Optional[str] = Header(None),
):
    """Run the agent loop without a saved agent config. Used by WhatsApp, Slack, etc."""
    tenant_id = x_tenant_id or "tenant-001"
    system_prompt = body.system_prompt or DEFAULT_WHATSAPP_PROMPT
    enabled_tools = body.enabled_tools or AVAILABLE_TOOLS

    outcome = await run_agent(
        agent_id="inline",
        system_prompt=system_prompt,
        model=body.model,
        enabled_tools=enabled_tools,
        max_iterations=body.max_iterations,
        conversation_history=body.conversation_history,
        new_user_message=body.message,
        tenant_id=tenant_id,
        knowledge_scope=body.knowledge_scope,
        dry_run=body.dry_run,
    )

    return {
        "final_text": outcome.get("final_text", ""),
        "iterations": outcome.get("iterations", 0),
        "error": outcome.get("error"),
    }


# ── Phase 4: Test endpoint ────────────────────────────────────────────────────

class TestRequest(BaseModel):
    message: str
    dry_run: bool = True
    pipeline_id: Optional[str] = None
    pipeline_run_id: Optional[str] = None


@router.post("/{agent_id}/test")
async def test_agent(
    agent_id: str,
    body: TestRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Run an agent against a test message without saving to a thread. Supports dry_run."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(AgentConfigRow.id == agent_id, AgentConfigRow.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # Build scoped system prompt
    system_prompt = agent.system_prompt
    knowledge_scope = agent.knowledge_scope
    if knowledge_scope:
        scope_lines = "\n".join(
            f"  - {e.get('label', e.get('object_type_id', '?'))}" for e in knowledge_scope
        )
        system_prompt = system_prompt.rstrip() + f"\n\nDATA SCOPE (test run):\n{scope_lines}"

    outcome = await run_agent(
        agent_id=agent.id,
        system_prompt=system_prompt,
        model=agent.model,
        enabled_tools=agent.enabled_tools or [],
        max_iterations=agent.max_iterations,
        conversation_history=[],
        new_user_message=body.message,
        tenant_id=tenant_id,
        knowledge_scope=knowledge_scope,
        dry_run=body.dry_run,
    )

    # Save run record for analytics — capture full tool inputs + results for audit
    tool_calls = []
    tool_results: dict[str, dict] = {}  # tool_use_id -> result

    for msg in outcome.get("new_messages", []):
        role = msg.get("role")
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        if role == "user":
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_result":
                    tid = block.get("tool_use_id", "")
                    result_content = block.get("content", "")
                    if isinstance(result_content, list):
                        result_content = " ".join(
                            b.get("text", "") for b in result_content if isinstance(b, dict)
                        )
                    tool_results[tid] = {"result": str(result_content)[:500]}
        elif role == "assistant":
            for block in content:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    inp = block.get("input", {})
                    # Trim large fields (record batches) to keep storage lean
                    trimmed = {k: (str(v)[:300] if isinstance(v, str) and len(str(v)) > 300 else v)
                               for k, v in inp.items()} if isinstance(inp, dict) else inp
                    tool_calls.append({
                        "tool": block.get("name"),
                        "tool_use_id": block.get("id", ""),
                        "input": trimmed,
                    })

    # Attach results to their corresponding tool calls
    for tc in tool_calls:
        tid = tc.pop("tool_use_id", "")
        if tid in tool_results:
            tc["result"] = tool_results[tid]["result"]

    final_text = outcome.get("final_text", "")
    run_row = AgentRunRow(
        id=str(uuid4()), agent_id=agent.id, thread_id=None, tenant_id=tenant_id,
        iterations=outcome.get("iterations", 0), tool_calls=tool_calls,
        final_text_len=len(final_text),
        is_test=True, error=outcome.get("error"),
    )
    # Store extended fields if columns exist
    try:
        run_row.final_text = final_text[:4000] if final_text else None
        run_row.pipeline_id = body.pipeline_id
        run_row.pipeline_run_id = body.pipeline_run_id
    except Exception:
        pass
    db.add(run_row)
    await db.commit()

    return {
        "final_text": outcome.get("final_text", ""),
        "iterations": outcome.get("iterations", 0),
        "trace": outcome.get("new_messages", []),
        "error": outcome.get("error"),
        "dry_run": body.dry_run,
    }


# ── Phase 6: Version history ──────────────────────────────────────────────────

@router.get("/{agent_id}/versions")
async def list_versions(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigVersionRow)
        .where(AgentConfigVersionRow.agent_id == agent_id, AgentConfigVersionRow.tenant_id == tenant_id)
        .order_by(AgentConfigVersionRow.version_number.desc())
        .limit(50)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id, "version_number": r.version_number,
            "config_snapshot": r.config_snapshot,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/{agent_id}/test/stream")
async def test_agent_stream(
    agent_id: str,
    body: TestRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Same surface as /test but emits SSE events as the agent works.

    Each chunk is an SSE `data: {...}\\n\\n` block whose JSON `type` is one of:
      - tool_start    {tool, tool_use_id}                    — agent is about to call this tool
      - tool_calling  {tool, input}                          — full input args resolved
      - tool_result   {tool, result}                         — tool returned (truncated by runtime)
      - text_delta    {text}                                 — partial agent reasoning text
      - done          {iterations, error?}                   — terminal event
      - error         {error, iterations}                    — fatal mid-run

    Frontend renders each as a step in a live timeline so the user can watch
    web_search → scrape_url → action_propose unfold instead of staring at a
    spinner until the whole loop finishes.
    """
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(AgentConfigRow.id == agent_id, AgentConfigRow.tenant_id == tenant_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    system_prompt = agent.system_prompt
    knowledge_scope = agent.knowledge_scope
    if knowledge_scope:
        scope_lines = "\n".join(
            f"  - {e.get('label', e.get('object_type_id', '?'))}" for e in knowledge_scope
        )
        system_prompt = system_prompt.rstrip() + f"\n\nDATA SCOPE (test run):\n{scope_lines}"

    async def gen():
        async for chunk in stream_agent(
            agent_id=agent.id,
            system_prompt=system_prompt,
            model=agent.model,
            enabled_tools=agent.enabled_tools or [],
            max_iterations=agent.max_iterations,
            conversation_history=[],
            new_user_message=body.message,
            tenant_id=tenant_id,
            knowledge_scope=knowledge_scope,
            dry_run=body.dry_run,
        ):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable buffering at the reverse proxy
            "Connection": "keep-alive",
        },
    )


@router.post("/{agent_id}/versions/{version_id}/restore")
async def restore_version(
    agent_id: str,
    version_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    ver_result = await db.execute(
        select(AgentConfigVersionRow).where(
            AgentConfigVersionRow.id == version_id, AgentConfigVersionRow.agent_id == agent_id
        )
    )
    ver = ver_result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Version not found")

    agent_result = await db.execute(
        select(AgentConfigRow).where(AgentConfigRow.id == agent_id, AgentConfigRow.tenant_id == tenant_id)
    )
    row = agent_result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")

    snap = ver.config_snapshot
    row.name = snap.get("name", row.name)
    row.description = snap.get("description", row.description)
    row.system_prompt = snap.get("system_prompt", row.system_prompt)
    row.model = snap.get("model", row.model)
    row.enabled_tools = snap.get("enabled_tools", row.enabled_tools)
    row.tool_config = snap.get("tool_config", row.tool_config)
    row.max_iterations = snap.get("max_iterations", row.max_iterations)
    row.knowledge_scope = snap.get("knowledge_scope", row.knowledge_scope)
    await db.commit()
    return _to_dict(row)


# ── Phase 6: Analytics ────────────────────────────────────────────────────────

@router.get("/{agent_id}/analytics")
async def get_analytics(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentRunRow)
        .where(AgentRunRow.agent_id == agent_id, AgentRunRow.tenant_id == tenant_id)
        .order_by(AgentRunRow.created_at.desc())
        .limit(500)
    )
    runs = result.scalars().all()

    total = len(runs)
    avg_iterations = round(sum(r.iterations for r in runs) / total, 1) if total else 0
    error_count = sum(1 for r in runs if r.error)

    # Tool usage frequency
    tool_freq: dict[str, int] = {}
    for r in runs:
        for tc in (r.tool_calls or []):
            name = tc.get("tool", "unknown")
            tool_freq[name] = tool_freq.get(name, 0) + 1
    top_tools = sorted(tool_freq.items(), key=lambda x: -x[1])[:10]

    # Runs per day (last 14 days)
    from collections import defaultdict
    from datetime import datetime, timezone, timedelta
    today = datetime.now(timezone.utc).date()
    runs_per_day: dict[str, int] = defaultdict(int)
    for r in runs:
        if r.created_at:
            day = r.created_at.date()
            if (today - day).days <= 14:
                runs_per_day[day.isoformat()] += 1

    return {
        "total_runs": total,
        "avg_iterations": avg_iterations,
        "error_rate": round(error_count / total * 100, 1) if total else 0,
        "top_tools": [{"tool": t, "count": c} for t, c in top_tools],
        "runs_per_day": [{"date": d, "count": c} for d, c in sorted(runs_per_day.items())],
        "recent_runs": [
            {
                "id": r.id, "iterations": r.iterations, "is_test": r.is_test,
                "tool_count": len(r.tool_calls or []),
                "error": r.error, "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in runs[:20]
        ],
    }


# ── Agent Run Audit Log ───────────────────────────────────────────────────────

@router.get("/runs/audit")
async def get_audit_runs(
    limit: int = 100,
    agent_id: Optional[str] = None,
    pipeline_id: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Return detailed audit log of agent runs across all agents for a tenant."""
    tenant_id = x_tenant_id or "tenant-001"
    q = select(AgentRunRow, AgentConfigRow.name.label("agent_name")).join(
        AgentConfigRow, AgentRunRow.agent_id == AgentConfigRow.id, isouter=True
    ).where(AgentRunRow.tenant_id == tenant_id)
    if agent_id:
        q = q.where(AgentRunRow.agent_id == agent_id)
    if pipeline_id:
        q = q.where(AgentRunRow.pipeline_id == pipeline_id)
    q = q.order_by(AgentRunRow.created_at.desc()).limit(min(limit, 500))
    rows = (await db.execute(q)).all()

    return [
        {
            "id": r.AgentRunRow.id,
            "agent_id": r.AgentRunRow.agent_id,
            "agent_name": r.agent_name or r.AgentRunRow.agent_id[:8],
            "pipeline_id": getattr(r.AgentRunRow, "pipeline_id", None),
            "pipeline_run_id": getattr(r.AgentRunRow, "pipeline_run_id", None),
            "iterations": r.AgentRunRow.iterations,
            "tool_calls": r.AgentRunRow.tool_calls or [],
            "final_text": getattr(r.AgentRunRow, "final_text", None),
            "error": r.AgentRunRow.error,
            "created_at": r.AgentRunRow.created_at.isoformat() if r.AgentRunRow.created_at else None,
        }
        for r in rows
    ]


# ── Recent runs across all agents (for Operations grid) ──────────────────────

@router.get("/runs/recent")
async def list_recent_agent_runs(
    limit: int = 50,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    q = (
        select(AgentRunRow,
               AgentConfigRow.name.label("agent_name"),
               AgentConfigRow.model.label("agent_model"))
        .join(AgentConfigRow, AgentRunRow.agent_id == AgentConfigRow.id, isouter=True)
        .where(AgentRunRow.tenant_id == tenant_id)
        .order_by(AgentRunRow.created_at.desc())
        .limit(min(limit, 200))
    )
    rows = (await db.execute(q)).all()
    return [
        {
            "id": r.AgentRunRow.id,
            "agent_id": r.AgentRunRow.agent_id,
            "agent_name": r.agent_name or r.AgentRunRow.agent_id[:8],
            "model": r.agent_model,
            "iterations": r.AgentRunRow.iterations,
            "tool_count": len(r.AgentRunRow.tool_calls or []),
            "input_tokens": getattr(r.AgentRunRow, "input_tokens", 0) or 0,
            "output_tokens": getattr(r.AgentRunRow, "output_tokens", 0) or 0,
            "cache_read_tokens": getattr(r.AgentRunRow, "cache_read_tokens", 0) or 0,
            "cost_usd": float(getattr(r.AgentRunRow, "cost_usd", 0) or 0),
            "duration_ms": getattr(r.AgentRunRow, "duration_ms", None),
            "error": r.AgentRunRow.error,
            "created_at": r.AgentRunRow.created_at.isoformat() if r.AgentRunRow.created_at else None,
        }
        for r in rows
    ]


# ── Single agent run with full step trace ─────────────────────────────────────

@router.get("/runs/{run_id}")
async def get_agent_run(
    run_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Return a single agent run with its full reasoning trace, used by the
    Operations / Run Drilldown view."""
    tenant_id = x_tenant_id or "tenant-001"
    q = (
        select(AgentRunRow, AgentConfigRow.name.label("agent_name"),
               AgentConfigRow.model.label("agent_model"))
        .join(AgentConfigRow, AgentRunRow.agent_id == AgentConfigRow.id, isouter=True)
        .where(AgentRunRow.tenant_id == tenant_id, AgentRunRow.id == run_id)
    )
    res = (await db.execute(q)).first()
    if not res:
        raise HTTPException(status_code=404, detail="Agent run not found")
    run = res.AgentRunRow
    return {
        "id": run.id,
        "agent_id": run.agent_id,
        "agent_name": res.agent_name or run.agent_id[:8],
        "model": res.agent_model,
        "thread_id": run.thread_id,
        "pipeline_id": getattr(run, "pipeline_id", None),
        "pipeline_run_id": getattr(run, "pipeline_run_id", None),
        "iterations": run.iterations,
        "tool_calls": run.tool_calls or [],
        "steps": getattr(run, "steps", None) or [],
        "final_text": getattr(run, "final_text", None),
        "final_text_len": run.final_text_len,
        "input_tokens": getattr(run, "input_tokens", 0) or 0,
        "output_tokens": getattr(run, "output_tokens", 0) or 0,
        "cache_creation_tokens": getattr(run, "cache_creation_tokens", 0) or 0,
        "cache_read_tokens": getattr(run, "cache_read_tokens", 0) or 0,
        "cost_usd": float(getattr(run, "cost_usd", 0) or 0),
        "duration_ms": getattr(run, "duration_ms", None),
        "is_test": run.is_test,
        "error": run.error,
        "created_at": run.created_at.isoformat() if run.created_at else None,
    }
