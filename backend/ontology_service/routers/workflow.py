"""
Workflow + notifications API.

  POST /workflow/decisions/{execution_id}     — submit a decision on the active stage
  GET  /workflow/users                         — list users in the tenant (for picker UIs)
  GET  /workflow/queue                         — list executions assigned to me / unassigned / all
  GET  /workflow/notifications                 — current user's notifications (unread or recent)
  POST /workflow/notifications/{id}/read       — mark one read
  POST /workflow/notifications/read-all        — mark all read

The decisions endpoint is the authoritative replacement for /confirm + /reject
when an action template has workflow_stages set. Legacy templates with no
stages keep using the confirm/reject endpoints.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import (
    ActionDefinitionRow, ActionExecutionRow, NotificationRow, get_session,
)
import workflow as wf
import user_directory

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request models ───────────────────────────────────────────────────────────

class DecisionBody(BaseModel):
    decision: str = Field(..., description="approve | reject | review_options | select_options")
    decided_in_stage: Optional[str] = None  # defaults to current_stage; pass for parallel sub-stages
    note: Optional[str] = None
    approved_option_ids: Optional[list[str]] = None
    selected_option_ids: Optional[list[str]] = None
    payload_diff: Optional[dict[str, Any]] = None
    actor_user_id: Optional[str] = None    # falls back to header auth
    actor_email: Optional[str] = None


# ── Internal helpers ─────────────────────────────────────────────────────────

async def _persist_notification(
    db: AsyncSession,
    *,
    tenant_id: str,
    user_id: str,
    user_email: Optional[str],
    kind: str,
    title: str,
    body: Optional[str],
    action_execution_id: Optional[str],
    action_name: Optional[str],
    deep_link: Optional[str] = None,
    payload: Optional[dict] = None,
) -> None:
    if not user_id:
        return
    db.add(NotificationRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        user_id=user_id,
        user_email=user_email,
        kind=kind,
        action_execution_id=action_execution_id,
        action_name=action_name,
        title=title,
        body=body,
        deep_link=deep_link,
        payload=payload or {},
    ))


async def _emit_workflow_events(
    db: AsyncSession,
    *,
    tenant_id: str,
    execution: ActionExecutionRow,
    template: ActionDefinitionRow,
    events: list[dict],
    new_assignee: dict,
) -> None:
    """Translate engine events into notification rows + email side-effects."""
    stages_by_name = {s["name"]: s for s in (template.workflow_stages or []) if isinstance(s, dict)}

    for ev in events:
        kind = ev.get("kind")
        stage_name = ev.get("stage")
        stage_def = stages_by_name.get(stage_name) or {}

        if kind == "stage_entered":
            # Notify the new assignee
            if new_assignee.get("user_id"):
                await _persist_notification(
                    db,
                    tenant_id=tenant_id,
                    user_id=new_assignee["user_id"],
                    user_email=new_assignee.get("user_email"),
                    kind="stage_assigned",
                    title=f"Action awaiting your decision: {execution.action_name}",
                    body=f"Stage '{stage_name}' was assigned to you.",
                    action_execution_id=execution.id,
                    action_name=execution.action_name,
                    deep_link=f"/human-actions/{execution.id}",
                    payload={"stage": stage_name},
                )
            # Extra notify_on_enter targets
            for spec_raw in (stage_def.get("notify_on_enter") or []):
                spec = wf.normalize_assignee_spec(spec_raw)
                if spec is None:
                    continue
                target = await user_directory.resolve_assignee(tenant_id, spec, execution.inputs or {})
                if target.get("user_id"):
                    await _persist_notification(
                        db,
                        tenant_id=tenant_id,
                        user_id=target["user_id"],
                        user_email=target.get("user_email"),
                        kind="stage_entered_cc",
                        title=f"FYI: action '{execution.action_name}' entered stage '{stage_name}'",
                        body=None,
                        action_execution_id=execution.id,
                        action_name=execution.action_name,
                        deep_link=f"/human-actions/{execution.id}",
                    )

        elif kind == "stage_completed":
            # Notify the requester (and anyone listed in notify_on_exit) when
            # stage closes. Default behavior: requester always gets a ping
            # when their action progresses.
            if execution.requester_user_id:
                outcome = ev.get("outcome", "approved")
                await _persist_notification(
                    db,
                    tenant_id=tenant_id,
                    user_id=execution.requester_user_id,
                    user_email=execution.requester_email,
                    kind="stage_completed",
                    title=f"Stage '{stage_name}' {outcome} on '{execution.action_name}'",
                    body=ev.get("note") or "",
                    action_execution_id=execution.id,
                    action_name=execution.action_name,
                    deep_link=f"/human-actions/{execution.id}",
                    payload={"stage": stage_name, "outcome": outcome},
                )
            for spec_raw in (stage_def.get("notify_on_exit") or []):
                spec = wf.normalize_assignee_spec(spec_raw)
                if spec is None:
                    continue
                target = await user_directory.resolve_assignee(tenant_id, spec, execution.inputs or {})
                if target.get("user_id"):
                    await _persist_notification(
                        db,
                        tenant_id=tenant_id,
                        user_id=target["user_id"],
                        user_email=target.get("user_email"),
                        kind="stage_completed_cc",
                        title=f"'{execution.action_name}' — stage '{stage_name}' {ev.get('outcome', 'completed')}",
                        body=None,
                        action_execution_id=execution.id,
                        action_name=execution.action_name,
                        deep_link=f"/human-actions/{execution.id}",
                    )


# ── Decision endpoint ────────────────────────────────────────────────────────

@router.post("/decisions/{execution_id}")
async def submit_decision(
    execution_id: str,
    body: DecisionBody,
    x_tenant_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_email: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    actor_user_id = body.actor_user_id or x_user_id
    actor_email = body.actor_email or x_user_email

    # Pull row + template
    exec_row: Optional[ActionExecutionRow] = (await db.execute(
        select(ActionExecutionRow).where(
            ActionExecutionRow.id == execution_id,
            ActionExecutionRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not exec_row:
        raise HTTPException(status_code=404, detail="Execution not found")

    template: Optional[ActionDefinitionRow] = (await db.execute(
        select(ActionDefinitionRow).where(
            ActionDefinitionRow.name == exec_row.action_name,
            ActionDefinitionRow.tenant_id == tenant_id,
        )
    )).scalar_one_or_none()
    if not template or not template.workflow_stages:
        raise HTTPException(
            status_code=400,
            detail="This execution doesn't use a multi-stage workflow. Use /executions/{id}/confirm or /reject.",
        )

    # Validate actor is allowed to decide on this stage. Two passes — exact
    # user_id, then email — so callers without access to the JWT subject can
    # still authenticate by header email.
    if exec_row.assigned_to_user_id and actor_user_id and exec_row.assigned_to_user_id != actor_user_id:
        # Allow if actor has an admin role in our directory
        actor_record = None
        if actor_user_id:
            actor_record = await user_directory.lookup_by_id(tenant_id, actor_user_id)
        elif actor_email:
            actor_record = await user_directory.lookup_by_email(tenant_id, actor_email)
        if not (actor_record and actor_record.get("role") in ("admin", "superadmin")):
            raise HTTPException(
                status_code=403,
                detail="You're not the assigned decider for this stage.",
            )

    decided_in = body.decided_in_stage or exec_row.current_stage
    if not decided_in:
        raise HTTPException(status_code=400, detail="Execution has no active stage")

    try:
        new_state = wf.apply_decision(
            stages=template.workflow_stages or [],
            current_stage=exec_row.current_stage,
            stage_state=exec_row.stage_state,
            stage_history=exec_row.stage_history,
            payload=exec_row.inputs or {},
            options=exec_row.options,
            decision=body.decision,
            decided_in_stage=decided_in,
            actor_user_id=actor_user_id,
            actor_email=actor_email,
            note=body.note,
            approved_option_ids=body.approved_option_ids,
            selected_option_ids=body.selected_option_ids,
            payload_diff=body.payload_diff,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    # Resolve next assignee (if any)
    new_assignee = {}
    if new_state.get("assignee_spec") and not new_state.get("terminal_status"):
        new_assignee = await user_directory.resolve_assignee(
            tenant_id, new_state["assignee_spec"], exec_row.inputs or {},
        )

    # Persist
    exec_row.current_stage = new_state["current_stage"]
    exec_row.stage_state = new_state["stage_state"]
    exec_row.stage_history = new_state["stage_history"]
    if new_state.get("options") is not None:
        exec_row.options = new_state["options"]
    if new_state.get("selected_option_ids") is not None:
        exec_row.selected_option_ids = new_state["selected_option_ids"]
    exec_row.assigned_to_user_id = new_assignee.get("user_id")
    exec_row.assigned_to_email = new_assignee.get("user_email")

    terminal = new_state.get("terminal_status")
    if terminal == wf.TERMINAL_COMPLETED:
        exec_row.status = "completed"
        exec_row.confirmed_by = actor_email or actor_user_id
        # In a full system this is where we'd dispatch the actual write side-effect
        exec_row.result = {
            "applied": exec_row.inputs,
            "selected_option_ids": exec_row.selected_option_ids or [],
        }
        if exec_row.requester_user_id:
            await _persist_notification(
                db,
                tenant_id=tenant_id,
                user_id=exec_row.requester_user_id,
                user_email=exec_row.requester_email,
                kind="execution_completed",
                title=f"'{exec_row.action_name}' was approved end-to-end",
                body="All stages completed. The action will execute.",
                action_execution_id=exec_row.id,
                action_name=exec_row.action_name,
                deep_link=f"/human-actions/{exec_row.id}",
                payload={"selected_option_ids": exec_row.selected_option_ids or []},
            )
    elif terminal == wf.TERMINAL_REJECTED:
        exec_row.status = "rejected"
        exec_row.rejected_by = actor_email or actor_user_id
        exec_row.rejection_reason = body.note or ""
        if exec_row.requester_user_id:
            await _persist_notification(
                db,
                tenant_id=tenant_id,
                user_id=exec_row.requester_user_id,
                user_email=exec_row.requester_email,
                kind="execution_rejected",
                title=f"'{exec_row.action_name}' was rejected",
                body=body.note or "",
                action_execution_id=exec_row.id,
                action_name=exec_row.action_name,
                deep_link=f"/human-actions/{exec_row.id}",
            )

    # Emit notifications for stage_entered / stage_completed
    await _emit_workflow_events(
        db,
        tenant_id=tenant_id,
        execution=exec_row,
        template=template,
        events=new_state.get("events") or [],
        new_assignee=new_assignee,
    )

    await db.commit()

    return {
        "id": exec_row.id,
        "status": exec_row.status,
        "current_stage": exec_row.current_stage,
        "stage_state": exec_row.stage_state,
        "stage_history": exec_row.stage_history,
        "options": exec_row.options,
        "selected_option_ids": exec_row.selected_option_ids,
        "assigned_to_user_id": exec_row.assigned_to_user_id,
        "assigned_to_email": exec_row.assigned_to_email,
        "terminal_status": terminal,
    }


# ── User picker proxy ────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(
    x_tenant_id: Optional[str] = Header(None),
    refresh: bool = False,
):
    tenant_id = x_tenant_id or "tenant-001"
    users = await user_directory.list_users(tenant_id, force_refresh=refresh)
    return {"users": users}


# ── Queue + assignee filter ──────────────────────────────────────────────────

@router.get("/queue")
async def list_queue(
    assigned_to: str = "anyone",  # "me" | "unassigned" | "anyone"
    stage: Optional[str] = None,
    limit: int = 100,
    x_tenant_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(ActionExecutionRow).where(
        ActionExecutionRow.tenant_id == tenant_id,
        ActionExecutionRow.status.in_(["pending_confirmation", "in_progress"]),
    )
    if assigned_to == "me":
        if not x_user_id:
            raise HTTPException(status_code=400, detail="x-user-id header required for assigned_to=me")
        stmt = stmt.where(ActionExecutionRow.assigned_to_user_id == x_user_id)
    elif assigned_to == "unassigned":
        stmt = stmt.where(ActionExecutionRow.assigned_to_user_id.is_(None))
    if stage:
        stmt = stmt.where(ActionExecutionRow.current_stage == stage)
    stmt = stmt.order_by(ActionExecutionRow.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    return {"executions": [_exec_summary(r) for r in result.scalars().all()]}


def _exec_summary(row: ActionExecutionRow) -> dict:
    return {
        "id": row.id,
        "action_name": row.action_name,
        "status": row.status,
        "current_stage": row.current_stage,
        "assigned_to_user_id": row.assigned_to_user_id,
        "assigned_to_email": row.assigned_to_email,
        "requester_user_id": row.requester_user_id,
        "requester_email": row.requester_email,
        "options_count": len(row.options or []) if row.options else 0,
        "selected_option_ids": row.selected_option_ids or [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── Notifications ────────────────────────────────────────────────────────────

@router.get("/notifications")
async def list_notifications(
    only_unread: bool = False,
    limit: int = 50,
    x_tenant_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if not x_user_id:
        return {"notifications": [], "unread_count": 0}
    stmt = select(NotificationRow).where(
        NotificationRow.tenant_id == tenant_id,
        NotificationRow.user_id == x_user_id,
    )
    if only_unread:
        stmt = stmt.where(NotificationRow.read_at.is_(None))
    stmt = stmt.order_by(NotificationRow.created_at.desc()).limit(limit)
    result = await db.execute(stmt)
    rows = result.scalars().all()

    # unread count (regardless of limit)
    count_result = await db.execute(
        select(NotificationRow).where(
            NotificationRow.tenant_id == tenant_id,
            NotificationRow.user_id == x_user_id,
            NotificationRow.read_at.is_(None),
        )
    )
    unread_count = len(count_result.scalars().all())

    return {
        "notifications": [_notif_to_dict(r) for r in rows],
        "unread_count": unread_count,
    }


def _notif_to_dict(row: NotificationRow) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "action_execution_id": row.action_execution_id,
        "action_name": row.action_name,
        "title": row.title,
        "body": row.body,
        "deep_link": row.deep_link,
        "payload": row.payload or {},
        "read_at": row.read_at.isoformat() if row.read_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


@router.post("/notifications/{notif_id}/read")
async def mark_read(
    notif_id: str,
    x_tenant_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if not x_user_id:
        raise HTTPException(status_code=401, detail="x-user-id header required")
    row = (await db.execute(
        select(NotificationRow).where(
            NotificationRow.id == notif_id,
            NotificationRow.tenant_id == tenant_id,
            NotificationRow.user_id == x_user_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    if not row.read_at:
        row.read_at = datetime.now(timezone.utc)
        await db.commit()
    return _notif_to_dict(row)


@router.post("/notifications/read-all")
async def mark_all_read(
    x_tenant_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if not x_user_id:
        raise HTTPException(status_code=401, detail="x-user-id header required")
    now = datetime.now(timezone.utc)
    rows = (await db.execute(
        select(NotificationRow).where(
            NotificationRow.tenant_id == tenant_id,
            NotificationRow.user_id == x_user_id,
            NotificationRow.read_at.is_(None),
        )
    )).scalars().all()
    for r in rows:
        r.read_at = now
    await db.commit()
    return {"marked_read": len(rows)}
