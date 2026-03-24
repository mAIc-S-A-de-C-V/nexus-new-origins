from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Query, HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from shared.models import AuditEvent
from database import AuditEventRow, get_session

router = APIRouter()


def _row_to_event(row: AuditEventRow) -> AuditEvent:
    from shared.enums import Role
    return AuditEvent(
        id=row.id,
        tenant_id=row.tenant_id,
        actor_id=row.actor_id,
        actor_role=Role(row.actor_role),
        action=row.action,
        resource_type=row.resource_type,
        resource_id=row.resource_id,
        before_state=row.before_state,
        after_state=row.after_state,
        ip_address=row.ip_address,
        user_agent=row.user_agent,
        occurred_at=row.occurred_at,
        success=row.success,
        error_message=row.error_message,
    )


@router.get("", response_model=list[AuditEvent])
async def query_audit(
    actor_id: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    resource_id: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    from_time: Optional[datetime] = Query(None),
    to_time: Optional[datetime] = Query(None),
    limit: int = Query(100, le=1000),
    offset: int = Query(0),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    filters = [AuditEventRow.tenant_id == tenant_id]

    if actor_id:
        filters.append(AuditEventRow.actor_id == actor_id)
    if resource_type:
        filters.append(AuditEventRow.resource_type == resource_type)
    if resource_id:
        filters.append(AuditEventRow.resource_id == resource_id)
    if action:
        filters.append(AuditEventRow.action == action)
    if from_time:
        filters.append(AuditEventRow.occurred_at >= from_time)
    if to_time:
        filters.append(AuditEventRow.occurred_at <= to_time)

    stmt = (
        select(AuditEventRow)
        .where(and_(*filters))
        .order_by(AuditEventRow.occurred_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [_row_to_event(r) for r in result.scalars().all()]


@router.post("", response_model=AuditEvent, status_code=201)
async def write_audit_event(
    event: AuditEvent,
    x_tenant_id: Optional[str] = Header(None),
    x_internal: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    if not x_internal:
        raise HTTPException(
            status_code=403,
            detail="Audit write endpoint is for internal service use only"
        )
    tenant_id = x_tenant_id or "tenant-001"
    event.tenant_id = tenant_id

    row = AuditEventRow(
        id=event.id,
        tenant_id=tenant_id,
        actor_id=event.actor_id,
        actor_role=event.actor_role.value if hasattr(event.actor_role, "value") else event.actor_role,
        action=event.action,
        resource_type=event.resource_type,
        resource_id=event.resource_id,
        before_state=event.before_state,
        after_state=event.after_state,
        ip_address=event.ip_address,
        user_agent=event.user_agent,
        occurred_at=event.occurred_at,
        success=event.success,
        error_message=event.error_message,
    )
    db.add(row)
    await db.commit()
    return event


@router.get("/summary")
async def get_audit_summary(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(AuditEventRow).where(AuditEventRow.tenant_id == tenant_id)
    result = await db.execute(stmt)
    events = result.scalars().all()

    by_resource: dict = {}
    by_actor: dict = {}
    for e in events:
        by_resource[e.resource_type] = by_resource.get(e.resource_type, 0) + 1
        by_actor[e.actor_id] = by_actor.get(e.actor_id, 0) + 1

    return {
        "total_events": len(events),
        "by_resource_type": by_resource,
        "by_actor": by_actor,
        "failure_count": sum(1 for e in events if not e.success),
    }
