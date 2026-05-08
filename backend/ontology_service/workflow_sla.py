"""
SLA timer loop — periodic background task that finds workflow stages whose
SLA elapsed and applies their on_timeout action.

on_timeout shapes:
  {"action": "approve"}                       — auto-advance as if approved
  {"action": "reject"}                        — auto-terminate as rejected
  {"action": "reassign", "to": <assignee>}    — keep stage active but reassign

We never block the request path on this — it ticks every TICK_INTERVAL_S in
its own task and uses its own session.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select

from database import (
    ActionDefinitionRow, ActionExecutionRow, NotificationRow, AsyncSessionLocal,
)
import workflow as wf
import user_directory

logger = logging.getLogger(__name__)

TICK_INTERVAL_S = float(os.environ.get("WORKFLOW_SLA_TICK_S", "60"))


async def sla_loop() -> None:
    """Forever-running tick. Errors get logged but don't crash the loop."""
    # Cold-start grace — let DB / other deps come up first
    await asyncio.sleep(15)
    logger.info("Workflow SLA loop started (tick=%ss)", TICK_INTERVAL_S)
    while True:
        try:
            await _tick()
        except Exception:
            logger.exception("workflow SLA tick failed")
        await asyncio.sleep(TICK_INTERVAL_S)


async def _tick() -> None:
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db:
        # Pull every active workflow row. There won't be many; an index on
        # current_stage scoped to non-terminal makes this cheap.
        result = await db.execute(
            select(ActionExecutionRow).where(
                ActionExecutionRow.status.in_(["pending_confirmation", "in_progress"]),
                ActionExecutionRow.current_stage.is_not(None),
            )
        )
        rows = result.scalars().all()
        if not rows:
            return

        # Group by tenant+template for cheap lookups
        cache: dict[tuple[str, str], Optional[ActionDefinitionRow]] = {}

        for row in rows:
            template = cache.get((row.tenant_id, row.action_name))
            if template is None and (row.tenant_id, row.action_name) not in cache:
                t_result = await db.execute(
                    select(ActionDefinitionRow).where(
                        ActionDefinitionRow.tenant_id == row.tenant_id,
                        ActionDefinitionRow.name == row.action_name,
                    )
                )
                template = t_result.scalar_one_or_none()
                cache[(row.tenant_id, row.action_name)] = template
            if not template or not template.workflow_stages:
                continue

            timed = wf.find_timed_out_stages(row.stage_state or {}, template.workflow_stages or [], now)
            for entry in timed:
                stage_name = entry["stage_name"]
                on_timeout = entry["on_timeout"] or {"action": "reject"}
                await _apply_timeout(db, row, template, stage_name, on_timeout, now)
        await db.commit()


async def _apply_timeout(
    db,
    row: ActionExecutionRow,
    template: ActionDefinitionRow,
    stage_name: str,
    on_timeout: dict,
    now: datetime,
) -> None:
    action = (on_timeout.get("action") or "reject").lower()

    if action == "reassign":
        target_spec = wf.normalize_assignee_spec(on_timeout.get("to"))
        if not target_spec:
            logger.warning("SLA reassign on stage %s missing valid 'to' spec", stage_name)
            return
        resolved = await user_directory.resolve_assignee(row.tenant_id, target_spec, row.inputs or {})
        if not resolved.get("user_id"):
            logger.warning("SLA reassign couldn't resolve target on stage %s", stage_name)
            return
        # Keep stage active but flip assignee; reset SLA to current stage's sla
        prev_uid, prev_email = row.assigned_to_user_id, row.assigned_to_email
        row.assigned_to_user_id = resolved["user_id"]
        row.assigned_to_email = resolved.get("user_email")
        # Reset entered_at + sla_at on the active stage so the new owner gets a full window
        st = (row.stage_state or {}).get(stage_name)
        if isinstance(st, dict):
            st["entered_at"] = now.isoformat()
            stage_def = next((s for s in template.workflow_stages if s.get("name") == stage_name), {})
            secs = stage_def.get("sla_seconds")
            if secs:
                from datetime import timedelta as _td
                st["sla_at"] = (now + _td(seconds=int(secs))).isoformat()
        row.stage_history = (row.stage_history or []) + [{
            "stage": stage_name,
            "actor_user_id": "system",
            "actor_email": "system",
            "at": now.isoformat(),
            "decision": "sla_reassign",
            "from_user_id": prev_uid,
            "from_user_email": prev_email,
            "to_user_id": resolved["user_id"],
            "to_user_email": resolved.get("user_email"),
        }]
        # Notify the new assignee
        db.add(NotificationRow(
            id=__import__("uuid").uuid4().hex,
            tenant_id=row.tenant_id,
            user_id=resolved["user_id"],
            user_email=resolved.get("user_email"),
            kind="stage_reassigned_sla",
            action_execution_id=row.id,
            action_name=row.action_name,
            title=f"SLA reassigned: '{row.action_name}' stage '{stage_name}'",
            body="Previous reviewer didn't decide in time. You now own this.",
            deep_link=f"/human-actions/{row.id}",
            payload={"stage": stage_name},
        ))
        return

    # approve/reject auto-decision: synthesize a decision from the system actor.
    decision = wf.DECISION_APPROVE if action == "approve" else wf.DECISION_REJECT
    try:
        new_state = wf.apply_decision(
            stages=template.workflow_stages or [],
            current_stage=row.current_stage,
            stage_state=row.stage_state,
            stage_history=row.stage_history,
            payload=row.inputs or {},
            options=row.options,
            decision=decision,
            decided_in_stage=stage_name,
            actor_user_id="system",
            actor_email="system",
            note=f"Auto-{action} via SLA timeout",
        )
    except ValueError as e:
        logger.warning("SLA auto-decision failed on %s/%s: %s", row.id, stage_name, e)
        return

    row.current_stage = new_state["current_stage"]
    row.stage_state = new_state["stage_state"]
    row.stage_history = new_state["stage_history"]
    if new_state.get("options") is not None:
        row.options = new_state["options"]

    next_assignee = {}
    if new_state.get("assignee_spec") and not new_state.get("terminal_status"):
        next_assignee = await user_directory.resolve_assignee(
            row.tenant_id, new_state["assignee_spec"], row.inputs or {},
        )
    row.assigned_to_user_id = next_assignee.get("user_id")
    row.assigned_to_email = next_assignee.get("user_email")

    terminal = new_state.get("terminal_status")
    if terminal == wf.TERMINAL_COMPLETED:
        row.status = "completed"
        row.confirmed_by = "system:sla"
        row.result = {"applied": row.inputs, "selected_option_ids": row.selected_option_ids or []}
    elif terminal == wf.TERMINAL_REJECTED:
        row.status = "rejected"
        row.rejected_by = "system:sla"
        row.rejection_reason = f"SLA timeout — auto-{action}"

    # Notify requester
    if row.requester_user_id:
        db.add(NotificationRow(
            id=__import__("uuid").uuid4().hex,
            tenant_id=row.tenant_id,
            user_id=row.requester_user_id,
            user_email=row.requester_email,
            kind="sla_warning" if not terminal else f"execution_{terminal}",
            action_execution_id=row.id,
            action_name=row.action_name,
            title=f"SLA expired on '{row.action_name}' stage '{stage_name}'",
            body=f"Auto-{action} applied. Outcome: {terminal or 'advancing'}",
            deep_link=f"/human-actions/{row.id}",
            payload={"stage": stage_name, "auto_action": action},
        ))
