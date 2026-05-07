"""
Pipeline triggers — event-driven autonomous agent runs.

When pipeline_service finishes a run, it POSTs to /triggers/internal/pipeline-event
on this service. We look up matching enabled triggers and, for each:

  1. Pick the candidate rows (newly inserted only, or all rows from the run)
  2. Apply the row_filter clauses (field/op/value, AND-combined)
  3. Dedupe — skip rows whose dedupe_field already has an action_execution
     with action_name == dedupe_action_name
  4. Fire the agent — once per surviving row (per_row) or once for the whole
     surviving batch (per_batch), with prompt_template rendered against row data

This file is the pure-logic side; the HTTP endpoint and CRUD live in
routers/triggers.py and the agent kickoff itself reuses run_agent from runtime.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    AgentConfigRow,
    AgentRunRow,
    AgentThreadRow,
    PipelineTriggerRow,
    AsyncSessionLocal,
)
from runtime import run_agent

logger = logging.getLogger(__name__)

ONTOLOGY_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
ANALYTICS_URL = os.environ.get("ANALYTICS_SERVICE_URL", "http://analytics-service:8021")
INTERNAL_TIMEOUT_S = float(os.environ.get("TRIGGER_INTERNAL_TIMEOUT_S", "30"))


# ── Filter evaluation ────────────────────────────────────────────────────────

def _coerce_for_compare(value: Any, target: Any) -> Any:
    """Best-effort coerce target to value's type so 5 == "5" works."""
    if value is None or target is None:
        return target
    if isinstance(value, bool):
        if isinstance(target, str):
            return target.strip().lower() in ("true", "1", "yes")
        return bool(target)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return type(value)(target)
        except (TypeError, ValueError):
            return target
    return target


def _eval_clause(row: dict, clause: dict) -> bool:
    """Evaluate one filter clause against a row.

    Supported ops: eq, ne, gt, gte, lt, lte, in, not_in, contains, starts_with,
    ends_with, is_null, is_not_null.
    """
    field = clause.get("field")
    op = (clause.get("op") or "eq").lower()
    target = clause.get("value")
    if not field:
        return True
    actual = row.get(field)

    if op in ("is_null", "isnull"):
        return actual is None
    if op in ("is_not_null", "notnull"):
        return actual is not None

    if op == "in":
        if not isinstance(target, (list, tuple, set)):
            return False
        return any(actual == _coerce_for_compare(actual, t) for t in target)
    if op in ("not_in", "nin"):
        if not isinstance(target, (list, tuple, set)):
            return True
        return all(actual != _coerce_for_compare(actual, t) for t in target)

    if op == "contains":
        if actual is None:
            return False
        return str(target).lower() in str(actual).lower()
    if op in ("starts_with", "startswith"):
        return str(actual or "").lower().startswith(str(target or "").lower())
    if op in ("ends_with", "endswith"):
        return str(actual or "").lower().endswith(str(target or "").lower())

    coerced = _coerce_for_compare(actual, target)
    if op == "eq":
        return actual == coerced
    if op == "ne":
        return actual != coerced
    try:
        if op == "gt":
            return actual > coerced  # type: ignore[operator]
        if op == "gte":
            return actual >= coerced  # type: ignore[operator]
        if op == "lt":
            return actual < coerced  # type: ignore[operator]
        if op == "lte":
            return actual <= coerced  # type: ignore[operator]
    except TypeError:
        return False
    return True  # unknown op — don't drop rows


def apply_filter(rows: list[dict], clauses: list[dict]) -> list[dict]:
    """AND-combine all clauses. Empty list = pass-through."""
    if not clauses:
        return list(rows)
    return [r for r in rows if all(_eval_clause(r, c) for c in clauses)]


# ── Prompt template rendering ────────────────────────────────────────────────

_TEMPLATE_RE = re.compile(r"\{\{\s*row\.([a-zA-Z0-9_\-\.]+)\s*\}\}")


def render_prompt(template: str, row: dict) -> str:
    """Replace {{row.field}} placeholders with values from row.

    Missing fields render as empty string (matches user expectation that a
    missing column shouldn't blow up the run). Nested fields with dot-paths
    aren't traversed in v1; users can request them later.
    """
    if not template:
        return ""

    def _sub(match: re.Match) -> str:
        key = match.group(1)
        v = row.get(key)
        if v is None:
            return ""
        if isinstance(v, (dict, list)):
            import json as _json
            return _json.dumps(v, ensure_ascii=False, default=str)
        return str(v)

    return _TEMPLATE_RE.sub(_sub, template)


# ── Dedupe via ontology action_executions ────────────────────────────────────

async def dedupe_rows(
    rows: list[dict],
    action_name: Optional[str],
    field: Optional[str],
    tenant_id: str,
) -> tuple[list[dict], int]:
    """Filter out rows whose dedupe_field value already has a recent
    action_execution under action_name. Returns (kept_rows, skipped_count)."""
    if not action_name or not field or not rows:
        return list(rows), 0

    # Pull the latest 500 executions of this action and build a set of
    # already-processed dedupe keys. Action executions don't currently have a
    # filter-by-input endpoint, so we read the recent slice and intersect.
    try:
        async with httpx.AsyncClient(timeout=INTERNAL_TIMEOUT_S) as client:
            resp = await client.get(
                f"{ONTOLOGY_URL}/actions/{action_name}/executions",
                headers={"x-tenant-id": tenant_id},
                params={"limit": 500},
            )
            if not resp.is_success:
                logger.warning(
                    "Dedupe lookup failed (%s %s): %s",
                    resp.status_code, action_name, resp.text[:200],
                )
                return list(rows), 0
            executions = resp.json() or []
    except Exception:
        logger.exception("Dedupe lookup raised")
        return list(rows), 0

    seen: set[str] = set()
    for ex in executions:
        inputs = ex.get("inputs") or {}
        v = inputs.get(field)
        if v is not None and v != "":
            seen.add(str(v))

    kept = [r for r in rows if str(r.get(field) or "") not in seen]
    return kept, len(rows) - len(kept)


# ── Row hydration ────────────────────────────────────────────────────────────

async def hydrate_rows(object_type: str, row_ids: list[str], tenant_id: str) -> list[dict]:
    """Fetch full row data via analytics_service /explore/query.

    `object_type` may be either an OT UUID (preferred — pipeline_service
    passes target_object_type_id) or a slug. Falls back to ID-only stubs
    if the lookup fails so the trigger still fires rather than silently
    dropping the event.
    """
    if not row_ids or not object_type:
        return []
    headers = {"x-tenant-id": tenant_id}
    try:
        async with httpx.AsyncClient(timeout=INTERNAL_TIMEOUT_S) as client:
            ot_id = object_type
            # Resolve slug → UUID if necessary (UUIDs contain dashes; slugs
            # historically don't, so this is an OK heuristic for v1).
            if "-" not in object_type or len(object_type) < 30:
                try:
                    list_resp = await client.get(
                        f"{ONTOLOGY_URL}/object-types",
                        headers=headers,
                    )
                    if list_resp.is_success:
                        for ot in list_resp.json() or []:
                            if ot.get("name") == object_type:
                                ot_id = ot.get("id") or object_type
                                break
                except Exception:
                    pass

            resp = await client.post(
                f"{ANALYTICS_URL}/explore/query",
                headers=headers,
                json={
                    "object_type_id": ot_id,
                    "filters": [{"field": "_source_id", "op": "in", "value": row_ids}],
                    "limit": max(len(row_ids), 1),
                },
            )
            if resp.is_success:
                data = resp.json() or {}
                rows = data.get("rows") or []
                if rows:
                    return list(rows)
            else:
                logger.warning(
                    "hydrate_rows query failed (%s): %s",
                    resp.status_code, resp.text[:200],
                )
    except Exception:
        logger.exception("hydrate_rows failed")
    # Fallback so the run still goes through
    return [{"_source_id": rid} for rid in row_ids]


# ── Firing ───────────────────────────────────────────────────────────────────

async def _fire_one(
    *,
    agent: AgentConfigRow,
    tenant_id: str,
    title: str,
    user_message: str,
) -> tuple[bool, str]:
    """Create a thread + invoke run_agent + persist run record. Returns
    (ok, error_or_final_text). Mirrors scheduler.fire_schedule's pattern so
    trigger-fired runs show up in the same Agent Runs history view."""
    try:
        async with AsyncSessionLocal() as db:
            thread = AgentThreadRow(
                id=str(uuid4()),
                tenant_id=tenant_id,
                agent_id=agent.id,
                title=title,
                created_by="trigger",
            )
            db.add(thread)
            await db.flush()
            thread_id = thread.id
            await db.commit()

        system_prompt = agent.system_prompt
        if agent.knowledge_scope:
            scope_lines = "\n".join(
                f"  - {e.get('label', e.get('object_type_id', '?'))}"
                for e in agent.knowledge_scope
            )
            system_prompt = system_prompt.rstrip() + f"\n\nDATA SCOPE:\n{scope_lines}"

        outcome = await run_agent(
            agent_id=agent.id,
            system_prompt=system_prompt,
            model=agent.model,
            enabled_tools=agent.enabled_tools or [],
            max_iterations=agent.max_iterations,
            conversation_history=[],
            new_user_message=user_message,
            tenant_id=tenant_id,
            knowledge_scope=agent.knowledge_scope,
        )

        # Persist a run record for observability — same shape scheduler uses
        tool_calls: list[dict] = []
        for msg in outcome.get("new_messages", []) or []:
            content = msg.get("content", [])
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use":
                        tool_calls.append({"tool": block.get("name")})

        async with AsyncSessionLocal() as db:
            db.add(AgentRunRow(
                id=str(uuid4()),
                agent_id=agent.id,
                thread_id=thread_id,
                tenant_id=tenant_id,
                iterations=outcome.get("iterations", 0),
                tool_calls=tool_calls,
                final_text_len=len(outcome.get("final_text", "")),
                is_test=False,
                error=outcome.get("error"),
            ))
            await db.commit()

        return True, str(outcome.get("final_text", ""))[:240]
    except Exception as exc:
        logger.exception("trigger fire failed")
        return False, str(exc)[:240]


async def fire_trigger(
    trigger: PipelineTriggerRow,
    *,
    pipeline_id: str,
    run_id: str,
    object_type: str,
    new_row_ids: list[str],
    all_row_ids: list[str],
) -> dict:
    """Run a single trigger end-to-end. Returns a summary dict.

    Safe to call concurrently for multiple triggers; we cap parallelism
    *within* a trigger via trigger.max_concurrent.
    """
    summary = {
        "trigger_id": trigger.id,
        "matched": 0,
        "fired": 0,
        "skipped_filter": 0,
        "skipped_dedupe": 0,
        "errors": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    candidate_ids = list(new_row_ids if trigger.on_new_only else all_row_ids)
    if len(candidate_ids) < (trigger.min_new_rows or 1):
        summary["skipped_below_threshold"] = True
        return summary

    rows = await hydrate_rows(object_type, candidate_ids, trigger.tenant_id)
    summary["matched"] = len(rows)

    after_filter = apply_filter(rows, list(trigger.row_filter or []))
    summary["skipped_filter"] = len(rows) - len(after_filter)

    after_dedupe, skipped_dedupe = await dedupe_rows(
        after_filter,
        trigger.dedupe_action_name,
        trigger.dedupe_field,
        trigger.tenant_id,
    )
    summary["skipped_dedupe"] = skipped_dedupe

    if not after_dedupe:
        return summary

    # Resolve agent
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(AgentConfigRow).where(AgentConfigRow.id == trigger.agent_id)
        )
        agent = result.scalar_one_or_none()
    if not agent or not agent.enabled:
        summary["errors"] = 1
        summary["error"] = "agent not found or disabled"
        return summary

    template = trigger.prompt_template or ""

    if (trigger.mode or "per_row") == "per_batch":
        import json as _json
        rendered_intro = render_prompt(template, after_dedupe[0]) if "{{row." in template else template
        body = (
            f"{rendered_intro}\n\n"
            f"The following {len(after_dedupe)} record(s) were just ingested by "
            f"pipeline {pipeline_id}. Process each one:\n\n"
            f"```json\n{_json.dumps(after_dedupe, ensure_ascii=False, default=str, indent=2)}\n```"
        )
        ok, _ = await _fire_one(
            agent=agent,
            tenant_id=trigger.tenant_id,
            title=f"[Trigger] {trigger.name} — {len(after_dedupe)} row(s)",
            user_message=body,
        )
        summary["fired" if ok else "errors"] = 1
        return summary

    # per_row mode — bound parallelism
    sem = asyncio.Semaphore(max(1, trigger.max_concurrent or 5))
    fired = 0
    errors = 0
    lock = asyncio.Lock()

    async def _worker(row: dict) -> None:
        nonlocal fired, errors
        async with sem:
            user_message = render_prompt(template, row)
            if not user_message.strip():
                # No template — fall back to a JSON dump of the row
                import json as _json
                user_message = (
                    f"A new record was just ingested by pipeline {pipeline_id}. "
                    f"Process it:\n\n```json\n{_json.dumps(row, ensure_ascii=False, default=str, indent=2)}\n```"
                )
            label = str(row.get(trigger.dedupe_field) or row.get("_id") or "row")[:40]
            ok, _ = await _fire_one(
                agent=agent,
                tenant_id=trigger.tenant_id,
                title=f"[Trigger] {trigger.name} — {label}",
                user_message=user_message,
            )
            async with lock:
                if ok:
                    fired += 1
                else:
                    errors += 1

    await asyncio.gather(*(_worker(r) for r in after_dedupe))
    summary["fired"] = fired
    summary["errors"] = errors
    return summary


async def fire_event(
    *,
    db: AsyncSession,
    tenant_id: str,
    pipeline_id: str,
    run_id: str,
    object_type: str,
    new_row_ids: list[str],
    all_row_ids: list[str],
) -> list[dict]:
    """Look up matching triggers and fire each in parallel.

    Returns a list of summary dicts (one per trigger that ran).
    """
    result = await db.execute(
        select(PipelineTriggerRow).where(
            PipelineTriggerRow.tenant_id == tenant_id,
            PipelineTriggerRow.pipeline_id == pipeline_id,
            PipelineTriggerRow.enabled == True,  # noqa: E712
        )
    )
    triggers = list(result.scalars().all())
    if not triggers:
        return []

    # Detach from session — we'll write summaries back at the end
    summaries = await asyncio.gather(*(
        fire_trigger(
            t,
            pipeline_id=pipeline_id,
            run_id=run_id,
            object_type=object_type,
            new_row_ids=new_row_ids,
            all_row_ids=all_row_ids,
        )
        for t in triggers
    ))

    # Persist last_fired_at + last_fire_summary
    now = datetime.now(timezone.utc)
    for t, s in zip(triggers, summaries):
        t.last_fired_at = now
        t.last_fire_summary = {k: v for k, v in s.items() if k != "trigger_id"}
    await db.commit()

    return list(summaries)
