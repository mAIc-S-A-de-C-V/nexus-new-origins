"""
Actions Registry — typed, permissioned write operations that AI agents and Logic Functions
can propose. Humans approve or reject proposals when requires_confirmation=True.
"""
import os
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Any
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from database import ActionDefinitionRow, ActionExecutionRow, get_session

logger = logging.getLogger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("SMTP_FROM", SMTP_USER)


def _send_approval_email(to: str, action_name: str, inputs: dict, confirmed_by: str, note: str = "") -> None:
    """Fire-and-forget email notification on action approval."""
    if not SMTP_HOST or not SMTP_USER:
        logger.warning("SMTP not configured — skipping approval email notification")
        return
    try:
        subject = f"[Nexus] Action approved: {action_name}"
        lines = [
            f"Action '{action_name}' was approved by {confirmed_by}.",
            "",
            "Inputs:",
        ] + [f"  {k}: {v}" for k, v in inputs.items()]
        if note:
            lines += ["", f"Note: {note}"]
        body = "\n".join(lines)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"Nexus Platform <{SMTP_FROM}>"
        msg["To"] = to
        msg.attach(MIMEText(body, "plain"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASSWORD)
            server.sendmail(SMTP_FROM, [to], msg.as_string())
        logger.info(f"Approval email sent to {to} for action '{action_name}'")
    except Exception as e:
        logger.error(f"Failed to send approval email to {to}: {e}")

router = APIRouter()


# ── Pydantic models ───────────────────────────────────────────────────────────

class ActionDefinitionCreate(BaseModel):
    name: str
    description: Optional[str] = None
    input_schema: dict[str, Any] = {}
    requires_confirmation: bool = True
    allowed_roles: list[str] = []
    writes_to_object_type: Optional[str] = None
    enabled: bool = True
    notify_email: Optional[str] = None   # email to notify when approved


class ActionExecuteRequest(BaseModel):
    inputs: dict[str, Any]
    executed_by: Optional[str] = "manual"
    source: Optional[str] = "manual"
    source_id: Optional[str] = None
    reasoning: Optional[str] = None


class ActionConfirmRequest(BaseModel):
    confirmed_by: str
    note: Optional[str] = None


class ActionRejectRequest(BaseModel):
    rejected_by: str
    reason: str


def _def_to_dict(row: ActionDefinitionRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "input_schema": row.input_schema or {},
        "requires_confirmation": row.requires_confirmation,
        "allowed_roles": row.allowed_roles or [],
        "writes_to_object_type": row.writes_to_object_type,
        "enabled": row.enabled,
        "notify_email": row.notify_email,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _exec_to_dict(row: ActionExecutionRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "action_name": row.action_name,
        "inputs": row.inputs or {},
        "status": row.status,
        "result": row.result,
        "error": row.error,
        "executed_by": row.executed_by,
        "confirmed_by": row.confirmed_by,
        "rejected_by": row.rejected_by,
        "rejection_reason": row.rejection_reason,
        "source": row.source,
        "source_id": row.source_id,
        "reasoning": row.reasoning,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ── Action Definition CRUD ────────────────────────────────────────────────────

@router.get("")
async def list_actions(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionDefinitionRow).where(ActionDefinitionRow.tenant_id == tenant_id)
    )
    return [_def_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_action(
    body: ActionDefinitionCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = ActionDefinitionRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        input_schema=body.input_schema,
        requires_confirmation=body.requires_confirmation,
        allowed_roles=body.allowed_roles,
        writes_to_object_type=body.writes_to_object_type,
        enabled=body.enabled,
        notify_email=body.notify_email,
    )
    db.add(row)
    await db.commit()
    return _def_to_dict(row)


@router.get("/{action_name}")
async def get_action(
    action_name: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionDefinitionRow).where(
            ActionDefinitionRow.name == action_name,
            ActionDefinitionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Action not found")
    return _def_to_dict(row)


@router.put("/{action_name}")
async def update_action(
    action_name: str,
    body: ActionDefinitionCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionDefinitionRow).where(
            ActionDefinitionRow.name == action_name,
            ActionDefinitionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Action not found")
    row.description = body.description
    row.input_schema = body.input_schema
    row.requires_confirmation = body.requires_confirmation
    row.allowed_roles = body.allowed_roles
    row.writes_to_object_type = body.writes_to_object_type
    row.enabled = body.enabled
    row.notify_email = body.notify_email
    await db.commit()
    return _def_to_dict(row)


@router.delete("/{action_name}", status_code=204)
async def delete_action(
    action_name: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionDefinitionRow).where(
            ActionDefinitionRow.name == action_name,
            ActionDefinitionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Action not found")
    await db.delete(row)
    await db.commit()


# ── Execute (propose) ─────────────────────────────────────────────────────────

@router.post("/{action_name}/execute")
async def execute_action(
    action_name: str,
    body: ActionExecuteRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Propose or directly execute an action.
    - requires_confirmation=True  → status becomes 'pending_confirmation'
    - requires_confirmation=False → status becomes 'completed' immediately
    """
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionDefinitionRow).where(
            ActionDefinitionRow.name == action_name,
            ActionDefinitionRow.tenant_id == tenant_id,
        )
    )
    action_def = result.scalar_one_or_none()
    if not action_def:
        raise HTTPException(status_code=404, detail=f"Action '{action_name}' not found")
    if not action_def.enabled:
        raise HTTPException(status_code=400, detail=f"Action '{action_name}' is disabled")

    exec_id = str(uuid4())

    if action_def.requires_confirmation:
        # Create a pending proposal — human must approve
        exec_row = ActionExecutionRow(
            id=exec_id,
            tenant_id=tenant_id,
            action_name=action_name,
            inputs=body.inputs,
            status="pending_confirmation",
            executed_by=body.executed_by,
            source=body.source,
            source_id=body.source_id,
            reasoning=body.reasoning,
        )
        db.add(exec_row)
        await db.commit()
        return {**_exec_to_dict(exec_row), "requires_confirmation": True}
    else:
        # Execute immediately — in a real system this would call the write logic
        # For now we record it as completed with the inputs as result
        exec_row = ActionExecutionRow(
            id=exec_id,
            tenant_id=tenant_id,
            action_name=action_name,
            inputs=body.inputs,
            status="completed",
            result={"applied": body.inputs, "action": action_name},
            executed_by=body.executed_by,
            source=body.source,
            source_id=body.source_id,
            reasoning=body.reasoning,
        )
        db.add(exec_row)
        await db.commit()
        return {**_exec_to_dict(exec_row), "requires_confirmation": False}


# ── Execution history + confirmation queue ────────────────────────────────────

@router.get("/{action_name}/executions")
async def list_executions(
    action_name: str,
    status: Optional[str] = None,
    limit: int = 50,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    filters = [
        ActionExecutionRow.tenant_id == tenant_id,
        ActionExecutionRow.action_name == action_name,
    ]
    if status:
        filters.append(ActionExecutionRow.status == status)
    result = await db.execute(
        select(ActionExecutionRow)
        .where(and_(*filters))
        .order_by(ActionExecutionRow.created_at.desc())
        .limit(limit)
    )
    return [_exec_to_dict(r) for r in result.scalars().all()]


@router.get("/executions")
async def list_all_executions(
    status: Optional[str] = None,
    limit: int = 100,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """All executions across all actions — for the history view."""
    tenant_id = x_tenant_id or "tenant-001"
    filters = [ActionExecutionRow.tenant_id == tenant_id]
    if status:
        filters.append(ActionExecutionRow.status == status)
    result = await db.execute(
        select(ActionExecutionRow)
        .where(and_(*filters))
        .order_by(ActionExecutionRow.created_at.desc())
        .limit(limit)
    )
    return [_exec_to_dict(r) for r in result.scalars().all()]


@router.get("/executions/pending")
async def list_pending_executions(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """All pending_confirmation executions across all actions — the approval queue."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionExecutionRow)
        .where(
            ActionExecutionRow.tenant_id == tenant_id,
            ActionExecutionRow.status == "pending_confirmation",
        )
        .order_by(ActionExecutionRow.created_at.desc())
    )
    return [_exec_to_dict(r) for r in result.scalars().all()]


@router.post("/executions/{execution_id}/confirm")
async def confirm_execution(
    execution_id: str,
    body: ActionConfirmRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionExecutionRow).where(
            ActionExecutionRow.id == execution_id,
            ActionExecutionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Execution not found")
    if row.status != "pending_confirmation":
        raise HTTPException(status_code=400, detail=f"Cannot confirm execution in status '{row.status}'")
    action_name = row.action_name
    inputs = row.inputs or {}
    row.status = "completed"
    row.confirmed_by = body.confirmed_by
    row.result = {"applied": inputs, "action": action_name, "confirmed_by": body.confirmed_by}

    # Build response dict while row is still loaded (before commit expires it)
    response = _exec_to_dict(row)
    await db.commit()

    # Send email notification if the action definition has one configured
    def_result = await db.execute(
        select(ActionDefinitionRow).where(
            ActionDefinitionRow.name == action_name,
            ActionDefinitionRow.tenant_id == tenant_id,
        )
    )
    action_def = def_result.scalar_one_or_none()
    if action_def and action_def.notify_email:
        _send_approval_email(
            to=action_def.notify_email,
            action_name=action_name,
            inputs=inputs,
            confirmed_by=body.confirmed_by,
            note=body.note or "",
        )

    return response


@router.post("/executions/{execution_id}/reject")
async def reject_execution(
    execution_id: str,
    body: ActionRejectRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ActionExecutionRow).where(
            ActionExecutionRow.id == execution_id,
            ActionExecutionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Execution not found")
    if row.status != "pending_confirmation":
        raise HTTPException(status_code=400, detail=f"Cannot reject execution in status '{row.status}'")
    row.status = "rejected"
    row.rejected_by = body.rejected_by
    row.rejection_reason = body.reason
    response = _exec_to_dict(row)
    await db.commit()
    return response
