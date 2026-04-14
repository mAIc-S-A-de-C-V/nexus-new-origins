"""
Checkpoints — justification gates before sensitive operations.

GET  /audit/checkpoints                  List all checkpoints (admin)
POST /audit/checkpoints                  Create checkpoint definition
PUT  /audit/checkpoints/{id}             Update
DELETE /audit/checkpoints/{id}           Delete

POST /audit/checkpoints/evaluate
  body: { resource_type, operation, user_role }
  returns: { required: bool, checkpoint_id?, prompt_text? }

POST /audit/checkpoints/{id}/respond
  body: { resource_type, resource_id, operation, justification, user_id, user_email }
  returns: { token, expires_at }

GET  /audit/checkpoints/{id}/responses   List responses (admin)
"""
import secrets
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import get_session, CheckpointDefinitionRow, CheckpointResponseRow

router = APIRouter()

TOKEN_TTL_MINUTES = 10


def _def_to_dict(row: CheckpointDefinitionRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "prompt_text": row.prompt_text,
        "applies_to": row.applies_to or [],
        "applies_to_roles": row.applies_to_roles or [],
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _resp_to_dict(row: CheckpointResponseRow) -> dict:
    return {
        "id": row.id,
        "checkpoint_id": row.checkpoint_id,
        "user_id": row.user_id,
        "user_email": row.user_email,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "operation": row.operation,
        "justification": row.justification,
        "token": row.token,
        "token_expires_at": row.token_expires_at.isoformat() if row.token_expires_at else None,
        "responded_at": row.responded_at.isoformat() if row.responded_at else None,
    }


@router.get("/checkpoints")
async def list_checkpoints(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(CheckpointDefinitionRow)
        .where(CheckpointDefinitionRow.tenant_id == tenant_id)
        .order_by(CheckpointDefinitionRow.created_at.desc())
    )
    return [_def_to_dict(r) for r in result.scalars().all()]


@router.post("/checkpoints", status_code=201)
async def create_checkpoint(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = CheckpointDefinitionRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.get("name", "Unnamed Checkpoint"),
        prompt_text=body.get("prompt_text", "Please justify this action."),
        applies_to=body.get("applies_to", []),
        applies_to_roles=body.get("applies_to_roles", []),
        enabled=body.get("enabled", True),
    )
    db.add(row)
    await db.commit()
    return _def_to_dict(row)


@router.put("/checkpoints/{checkpoint_id}")
async def update_checkpoint(
    checkpoint_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(CheckpointDefinitionRow).where(
            CheckpointDefinitionRow.id == checkpoint_id,
            CheckpointDefinitionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    for field in ("name", "prompt_text", "applies_to", "applies_to_roles", "enabled"):
        if field in body:
            setattr(row, field, body[field])
    await db.commit()
    return _def_to_dict(row)


@router.delete("/checkpoints/{checkpoint_id}", status_code=204)
async def delete_checkpoint(
    checkpoint_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(CheckpointDefinitionRow).where(
            CheckpointDefinitionRow.id == checkpoint_id,
            CheckpointDefinitionRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Checkpoint not found")
    await db.delete(row)
    await db.commit()


@router.post("/checkpoints/evaluate")
async def evaluate_checkpoint(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Check if a checkpoint is required for a given resource_type + operation + user_role.
    Returns { required, checkpoint_id, prompt_text } or { required: false }.
    """
    tenant_id = x_tenant_id or "tenant-001"
    resource_type = body.get("resource_type", "")
    operation = body.get("operation", "")
    user_role = body.get("user_role", "")

    result = await db.execute(
        select(CheckpointDefinitionRow).where(
            CheckpointDefinitionRow.tenant_id == tenant_id,
            CheckpointDefinitionRow.enabled == True,
        )
    )
    checkpoints = result.scalars().all()

    for cp in checkpoints:
        applies_to = cp.applies_to or []
        applies_to_roles = cp.applies_to_roles or []

        # Check role match (empty = all roles)
        if applies_to_roles and user_role not in applies_to_roles:
            continue

        # Check resource_type + operation match
        for rule in applies_to:
            if rule.get("resource_type") == resource_type:
                ops = rule.get("operations", [])
                if not ops or operation in ops:
                    return {
                        "required": True,
                        "checkpoint_id": cp.id,
                        "prompt_text": cp.prompt_text,
                        "checkpoint_name": cp.name,
                    }

    return {"required": False}


@router.post("/checkpoints/{checkpoint_id}/respond")
async def respond_to_checkpoint(
    checkpoint_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Record a justification response. Returns a short-lived proof token (10 min TTL).
    """
    tenant_id = x_tenant_id or "tenant-001"
    justification = body.get("justification", "").strip()
    if not justification:
        raise HTTPException(status_code=400, detail="justification is required")

    result = await db.execute(
        select(CheckpointDefinitionRow).where(
            CheckpointDefinitionRow.id == checkpoint_id,
            CheckpointDefinitionRow.tenant_id == tenant_id,
        )
    )
    cp = result.scalar_one_or_none()
    if not cp:
        raise HTTPException(status_code=404, detail="Checkpoint not found")

    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=TOKEN_TTL_MINUTES)

    response_row = CheckpointResponseRow(
        id=str(uuid4()),
        checkpoint_id=checkpoint_id,
        tenant_id=tenant_id,
        user_id=body.get("user_id", "_unknown"),
        user_email=body.get("user_email"),
        resource_type=body.get("resource_type"),
        resource_id=body.get("resource_id"),
        operation=body.get("operation"),
        justification=justification,
        token=token,
        token_expires_at=expires_at,
    )
    db.add(response_row)
    await db.commit()

    return {
        "token": token,
        "expires_at": expires_at.isoformat(),
        "checkpoint_id": checkpoint_id,
    }


@router.get("/checkpoints/{checkpoint_id}/responses")
async def list_checkpoint_responses(
    checkpoint_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(CheckpointResponseRow).where(
            CheckpointResponseRow.checkpoint_id == checkpoint_id,
            CheckpointResponseRow.tenant_id == tenant_id,
        ).order_by(CheckpointResponseRow.responded_at.desc()).limit(100)
    )
    return [_resp_to_dict(r) for r in result.scalars().all()]
