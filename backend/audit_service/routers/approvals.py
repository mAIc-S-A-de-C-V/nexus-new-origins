"""
Formal Approvals Workflow — multi-step approval for high-impact operations.

GET  /audit/approvals/workflows                  List workflows
POST /audit/approvals/workflows                  Create
PUT  /audit/approvals/workflows/{id}             Update
DELETE /audit/approvals/workflows/{id}           Delete

GET  /audit/approvals/requests                   List (filter: status, resource_type)
POST /audit/approvals/requests                   Submit new request
GET  /audit/approvals/requests/{id}              Get request + approval status
POST /audit/approvals/requests/{id}/approve      Add approval
POST /audit/approvals/requests/{id}/reject       Reject with reason
GET  /audit/approvals/requests/mine/pending      Requests waiting for MY approval
"""
from datetime import datetime, timezone, timedelta
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from database import get_session, ApprovalWorkflowRow, ApprovalRequestRow

router = APIRouter()


def _wf_to_dict(row: ApprovalWorkflowRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "resource_type": row.resource_type,
        "operations": row.operations or [],
        "required_approvers": row.required_approvers,
        "eligible_roles": row.eligible_roles or [],
        "expiry_hours": row.expiry_hours,
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _req_to_dict(row: ApprovalRequestRow) -> dict:
    approvals = row.approvals or []
    rejections = row.rejections or []
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "workflow_id": row.workflow_id,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "operation": row.operation,
        "payload": row.payload,
        "requested_by": row.requested_by,
        "requested_by_email": row.requested_by_email,
        "status": row.status,
        "approvals": approvals,
        "rejections": rejections,
        "approval_count": len(approvals),
        "expires_at": row.expires_at.isoformat() if row.expires_at else None,
        "executed_at": row.executed_at.isoformat() if row.executed_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── Workflows ────────────────────────────────────────────────────────────────

@router.get("/approvals/workflows")
async def list_workflows(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ApprovalWorkflowRow)
        .where(ApprovalWorkflowRow.tenant_id == tenant_id)
        .order_by(ApprovalWorkflowRow.created_at.desc())
    )
    return [_wf_to_dict(r) for r in result.scalars().all()]


@router.post("/approvals/workflows", status_code=201)
async def create_workflow(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = ApprovalWorkflowRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.get("name", "Unnamed Workflow"),
        resource_type=body.get("resource_type", "object_type"),
        operations=body.get("operations", []),
        required_approvers=int(body.get("required_approvers", 1)),
        eligible_roles=body.get("eligible_roles", ["admin"]),
        expiry_hours=int(body.get("expiry_hours", 72)),
        enabled=body.get("enabled", True),
    )
    db.add(row)
    await db.commit()
    return _wf_to_dict(row)


@router.put("/approvals/workflows/{workflow_id}")
async def update_workflow(
    workflow_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ApprovalWorkflowRow).where(
            ApprovalWorkflowRow.id == workflow_id,
            ApprovalWorkflowRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    for field in ("name", "resource_type", "operations", "required_approvers", "eligible_roles", "expiry_hours", "enabled"):
        if field in body:
            setattr(row, field, body[field])
    await db.commit()
    return _wf_to_dict(row)


@router.delete("/approvals/workflows/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ApprovalWorkflowRow).where(
            ApprovalWorkflowRow.id == workflow_id,
            ApprovalWorkflowRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    await db.delete(row)
    await db.commit()


# ── Requests ─────────────────────────────────────────────────────────────────

@router.get("/approvals/requests/mine/pending")
async def my_pending_approvals(
    x_tenant_id: Optional[str] = Header(None),
    x_user_id: Optional[str] = Header(None),
    x_user_role: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Returns approval requests that:
    1. Are still pending
    2. Have not yet been approved/rejected by this user
    3. User's role is eligible per the workflow
    """
    tenant_id = x_tenant_id or "tenant-001"
    user_id = x_user_id or "_unknown"
    user_role = x_user_role or "admin"

    result = await db.execute(
        select(ApprovalRequestRow).where(
            ApprovalRequestRow.tenant_id == tenant_id,
            ApprovalRequestRow.status == "pending",
        ).order_by(ApprovalRequestRow.created_at.desc()).limit(50)
    )
    rows = result.scalars().all()

    # Filter: user hasn't already voted, and hasn't expired
    now = datetime.now(timezone.utc)
    pending = []
    for row in rows:
        if row.expires_at and row.expires_at.replace(tzinfo=timezone.utc) < now:
            continue
        # Check if user already voted
        approvals = row.approvals or []
        rejections = row.rejections or []
        already_voted = any(v.get("user_id") == user_id for v in approvals + rejections)
        if already_voted:
            continue

        # Check role eligibility via workflow
        if row.workflow_id:
            wf_result = await db.execute(
                select(ApprovalWorkflowRow).where(ApprovalWorkflowRow.id == row.workflow_id)
            )
            wf = wf_result.scalar_one_or_none()
            if wf and wf.eligible_roles and user_role not in wf.eligible_roles:
                continue

        pending.append(_req_to_dict(row))

    return pending


@router.get("/approvals/requests")
async def list_requests(
    status: Optional[str] = None,
    resource_type: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    q = select(ApprovalRequestRow).where(ApprovalRequestRow.tenant_id == tenant_id)
    if status:
        q = q.where(ApprovalRequestRow.status == status)
    if resource_type:
        q = q.where(ApprovalRequestRow.resource_type == resource_type)
    q = q.order_by(ApprovalRequestRow.created_at.desc()).limit(100)
    result = await db.execute(q)
    return [_req_to_dict(r) for r in result.scalars().all()]


@router.post("/approvals/requests", status_code=201)
async def submit_request(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    expiry_hours = 72

    # Look up workflow to get expiry
    workflow_id = body.get("workflow_id")
    if workflow_id:
        wf_result = await db.execute(
            select(ApprovalWorkflowRow).where(ApprovalWorkflowRow.id == workflow_id)
        )
        wf = wf_result.scalar_one_or_none()
        if wf:
            expiry_hours = wf.expiry_hours

    expires_at = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    row = ApprovalRequestRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        workflow_id=workflow_id,
        resource_type=body.get("resource_type", "unknown"),
        resource_id=body.get("resource_id"),
        operation=body.get("operation", "unknown"),
        payload=body.get("payload"),
        requested_by=body.get("requested_by", "_unknown"),
        requested_by_email=body.get("requested_by_email"),
        status="pending",
        approvals=[],
        rejections=[],
        expires_at=expires_at,
    )
    db.add(row)
    await db.commit()
    return _req_to_dict(row)


@router.get("/approvals/requests/{request_id}")
async def get_request(
    request_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ApprovalRequestRow).where(
            ApprovalRequestRow.id == request_id,
            ApprovalRequestRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    return _req_to_dict(row)


@router.post("/approvals/requests/{request_id}/approve")
async def approve_request(
    request_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ApprovalRequestRow).where(
            ApprovalRequestRow.id == request_id,
            ApprovalRequestRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request is already {row.status}")

    approvals = list(row.approvals or [])
    approvals.append({
        "user_id": body.get("user_id", "_unknown"),
        "email": body.get("email"),
        "note": body.get("note", ""),
        "approved_at": datetime.now(timezone.utc).isoformat(),
    })
    row.approvals = approvals

    # Check if we've reached required approvers
    wf = None
    if row.workflow_id:
        wf_result = await db.execute(select(ApprovalWorkflowRow).where(ApprovalWorkflowRow.id == row.workflow_id))
        wf = wf_result.scalar_one_or_none()

    required = wf.required_approvers if wf else 1
    if len(approvals) >= required:
        row.status = "approved"

    await db.commit()
    return _req_to_dict(row)


@router.post("/approvals/requests/{request_id}/reject")
async def reject_request(
    request_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ApprovalRequestRow).where(
            ApprovalRequestRow.id == request_id,
            ApprovalRequestRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Request not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Request is already {row.status}")

    rejections = list(row.rejections or [])
    rejections.append({
        "user_id": body.get("user_id", "_unknown"),
        "email": body.get("email"),
        "reason": body.get("reason", ""),
        "rejected_at": datetime.now(timezone.utc).isoformat(),
    })
    row.rejections = rejections
    row.status = "rejected"
    await db.commit()
    return _req_to_dict(row)
