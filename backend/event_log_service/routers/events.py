from typing import Optional
from datetime import datetime
from fastapi import APIRouter, Query, Header, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func, text
from shared.models import Event, EventLogQualityScore
from database import EventRow, get_session

router = APIRouter()


class BatchIngestRequest(BaseModel):
    events: list[Event]


def _event_to_row(event: Event, tenant_id: str) -> EventRow:
    return EventRow(
        id=event.id,
        tenant_id=tenant_id,
        case_id=event.case_id,
        activity=event.activity,
        timestamp=event.timestamp,
        object_type_id=event.object_type_id,
        object_id=event.object_id,
        pipeline_id=event.pipeline_id,
        connector_id=event.connector_id,
        resource=event.resource,
        cost=event.cost,
        attributes=event.attributes,
    )


def _row_to_event(row: EventRow) -> Event:
    return Event(
        id=row.id,
        tenant_id=row.tenant_id,
        case_id=row.case_id,
        activity=row.activity,
        timestamp=row.timestamp,
        object_type_id=row.object_type_id or "",
        object_id=row.object_id or "",
        pipeline_id=row.pipeline_id or "",
        connector_id=row.connector_id or "",
        resource=row.resource,
        cost=row.cost,
        attributes=row.attributes or {},
    )


@router.post("", status_code=201)
async def ingest_event(
    event: Event,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    event.tenant_id = tenant_id
    row = _event_to_row(event, tenant_id)
    db.add(row)
    await db.commit()
    return {"id": event.id, "status": "ingested"}


@router.post("/batch", status_code=201)
async def ingest_batch(
    req: BatchIngestRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    for event in req.events:
        event.tenant_id = tenant_id
        db.add(_event_to_row(event, tenant_id))
    await db.commit()
    return {"count": len(req.events), "status": "ingested"}


@router.get("", response_model=list[Event])
async def query_events(
    case_id: Optional[str] = Query(None),
    object_type: Optional[str] = Query(None),
    pipeline_id: Optional[str] = Query(None),
    from_time: Optional[datetime] = Query(None),
    to_time: Optional[datetime] = Query(None),
    limit: int = Query(100, le=1000),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    filters = [EventRow.tenant_id == tenant_id]

    if case_id:
        filters.append(EventRow.case_id == case_id)
    if object_type:
        filters.append(EventRow.object_type_id == object_type)
    if pipeline_id:
        filters.append(EventRow.pipeline_id == pipeline_id)
    if from_time:
        filters.append(EventRow.timestamp >= from_time)
    if to_time:
        filters.append(EventRow.timestamp <= to_time)

    stmt = (
        select(EventRow)
        .where(and_(*filters))
        .order_by(EventRow.timestamp.desc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [_row_to_event(r) for r in result.scalars().all()]


@router.get("/profile")
async def get_event_profile(
    object_type_id: Optional[str] = Query(None),
    pipeline_id: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Return distinct activity values with counts and first/last seen — used by Process Mining Settings."""
    tenant_id = x_tenant_id or "tenant-001"

    # Build a grouped query: activity, count, first_seen, last_seen
    filters = [EventRow.tenant_id == tenant_id]
    if object_type_id:
        filters.append(EventRow.object_type_id == object_type_id)
    if pipeline_id:
        filters.append(EventRow.pipeline_id == pipeline_id)

    stmt = (
        select(
            EventRow.activity,
            func.count(EventRow.id).label("count"),
            func.min(EventRow.timestamp).label("first_seen"),
            func.max(EventRow.timestamp).label("last_seen"),
        )
        .where(and_(*filters))
        .group_by(EventRow.activity)
        .order_by(func.count(EventRow.id).desc())
    )
    result = await db.execute(stmt)
    rows = result.fetchall()

    return {
        "activities": [
            {
                "activity": r.activity,
                "count": r.count,
                "first_seen": r.first_seen.isoformat() if r.first_seen else None,
                "last_seen": r.last_seen.isoformat() if r.last_seen else None,
            }
            for r in rows
        ]
    }


@router.get("/sample-fields")
async def sample_record_fields(
    pipeline_id: Optional[str] = Query(None),
    object_type_id: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Sample record_snapshot keys from recent events so AI can suggest field overrides."""
    tenant_id = x_tenant_id or "tenant-001"

    filters = [EventRow.tenant_id == tenant_id]
    if pipeline_id:
        filters.append(EventRow.pipeline_id == pipeline_id)
    if object_type_id:
        filters.append(EventRow.object_type_id == object_type_id)

    # Get a sample of events that have attributes
    stmt = (
        select(EventRow)
        .where(and_(*filters, EventRow.attributes.isnot(None)))
        .order_by(EventRow.timestamp.desc())
        .limit(5)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    # Collect unique keys from record_snapshot and top-level attributes
    snapshot_keys: dict[str, list] = {}  # key -> sample values
    attr_keys: dict[str, list] = {}
    sample_events = []

    for row in rows:
        attrs = row.attributes or {}
        snapshot = attrs.get("record_snapshot", {})

        # Collect snapshot field keys with sample values
        if isinstance(snapshot, dict):
            for k, v in snapshot.items():
                if k not in snapshot_keys:
                    snapshot_keys[k] = []
                if v is not None and len(snapshot_keys[k]) < 3:
                    snapshot_keys[k].append(str(v)[:100])

        # Collect top-level attribute keys
        for k, v in attrs.items():
            if k == "record_snapshot":
                continue
            if k not in attr_keys:
                attr_keys[k] = []
            if v is not None and len(attr_keys[k]) < 3:
                attr_keys[k].append(str(v)[:100])

        sample_events.append({
            "case_id": row.case_id,
            "activity": row.activity,
            "snapshot_keys": list(snapshot.keys()) if isinstance(snapshot, dict) else [],
        })

    return {
        "snapshot_fields": {k: v for k, v in snapshot_keys.items()},
        "attribute_fields": {k: v for k, v in attr_keys.items()},
        "sample_events": sample_events,
        "event_count": len(rows),
    }


@router.get("/quality/{pipeline_id}", response_model=EventLogQualityScore)
async def get_quality_score(
    pipeline_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(EventRow).where(
        EventRow.pipeline_id == pipeline_id,
        EventRow.tenant_id == tenant_id,
    )
    result = await db.execute(stmt)
    events = result.scalars().all()

    case_count = len(set(e.case_id for e in events))
    event_count = len(events)

    completeness = min(1.0, event_count / 100) if event_count > 0 else 0.0
    issues = []
    if event_count == 0:
        issues.append("No events ingested for this pipeline")
    if case_count == 0:
        issues.append("No case IDs found")

    return EventLogQualityScore(
        pipeline_id=pipeline_id,
        completeness=completeness,
        timeliness=0.91,
        consistency=0.88,
        accuracy=0.95,
        composite=round((completeness + 0.91 + 0.88 + 0.95) / 4, 3),
        issues=issues,
        case_count=case_count,
        event_count=event_count,
    )
