"""
Rollup endpoints — pre-aggregate raw `events` into a destination ontology OT
so dashboards can query a tiny pre-computed table instead of millions of raw
rows.

v1 ships two endpoints:
  - POST /process/rollups/run       — run for an explicit [from, to) range
  - POST /process/rollups/run-recent — run for the last N hours (cron-friendly)

The user creates an empty target OT in the UI ahead of time; the first
ingest auto-populates its schema. Subsequent runs upsert by composite
`_rollup_key` so re-running an hour replaces, doesn't duplicate.
"""
from typing import Optional
from datetime import datetime
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_ts_session
from database_pg import get_pg_session
from rollup import (
    compute_hourly_rollup,
    rollup_recent,
    compute_records_rollup,
    records_rollup_recent,
)

router = APIRouter()


class RollupRunRequest(BaseModel):
    source_object_type_id: str
    target_object_type_id: str
    from_hour: datetime  # inclusive (will be snapped to the start of the hour)
    to_hour: datetime    # exclusive
    dimensions: list[str] = Field(default_factory=list)
    # 'records' aggregates the actual data table (object_records — right for
    # sensor/telemetry data). 'events' aggregates the event audit log (right
    # for process mining where you care about case lifecycle activities).
    source_mode: str = "records"
    # For source_mode='records': which `data->>` field carries the timestamp
    time_field: str = "time"
    # For source_mode='events' only:
    activity_attribute: str = ""
    case_id_attribute: str = ""
    timestamp_attribute: str = ""
    excluded_activities: list[str] = Field(default_factory=list)
    attribute_filters: dict[str, str] = Field(default_factory=dict)
    # Either a comma-separated string ("count, avg:value, max:reading") or a
    # list of {method, field?, name?} dicts.
    metrics: object | None = None


class RollupRecentRequest(BaseModel):
    source_object_type_id: str
    target_object_type_id: str
    hours_back: int = 2  # default: re-run last 2 hours every cron tick
    dimensions: list[str] = Field(default_factory=list)
    source_mode: str = "records"
    time_field: str = "time"
    activity_attribute: str = ""
    case_id_attribute: str = ""
    timestamp_attribute: str = ""
    excluded_activities: list[str] = Field(default_factory=list)
    attribute_filters: dict[str, str] = Field(default_factory=dict)
    metrics: object | None = None


@router.post("/run")
async def run_rollup(
    body: RollupRunRequest,
    x_tenant_id: Optional[str] = Header(None),
    ts_db: AsyncSession = Depends(get_ts_session),
    pg_db: AsyncSession = Depends(get_pg_session),
):
    """Run an hourly rollup for the explicit [from_hour, to_hour) window.

    `source_mode='records'` (default) aggregates the records table directly —
    right for sensor/telemetry data where dimensions and metric values live in
    each record's `data` JSONB column.

    `source_mode='events'` aggregates the events audit log — right for
    process-mining where you care about case lifecycle (case_count etc.)."""
    tenant_id = x_tenant_id or "tenant-001"
    try:
        if (body.source_mode or "records").lower() == "events":
            return await compute_hourly_rollup(
                db=ts_db,
                source_object_type_id=body.source_object_type_id,
                target_object_type_id=body.target_object_type_id,
                tenant_id=tenant_id,
                from_hour=body.from_hour,
                to_hour=body.to_hour,
                dimensions=body.dimensions or ["activity"],
                activity_attribute=body.activity_attribute,
                case_id_attribute=body.case_id_attribute,
                timestamp_attribute=body.timestamp_attribute,
                excluded_activities=body.excluded_activities,
                attribute_filters=body.attribute_filters,
                metrics=body.metrics,
            )
        return await compute_records_rollup(
            pg_db=pg_db,
            source_object_type_id=body.source_object_type_id,
            target_object_type_id=body.target_object_type_id,
            tenant_id=tenant_id,
            from_hour=body.from_hour,
            to_hour=body.to_hour,
            dimensions=body.dimensions,
            metrics=body.metrics,
            time_field=body.time_field or "time",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.post("/run-recent")
async def run_rollup_recent(
    body: RollupRecentRequest,
    x_tenant_id: Optional[str] = Header(None),
    ts_db: AsyncSession = Depends(get_ts_session),
    pg_db: AsyncSession = Depends(get_pg_session),
):
    """Run for the last N completed hours. Designed for cron — call every
    10–15 min with hours_back=2 and you get near-real-time rollups with a
    1-hour overlap that absorbs late-arriving events without re-doing
    history. Idempotent."""
    tenant_id = x_tenant_id or "tenant-001"
    try:
        if (body.source_mode or "records").lower() == "events":
            return await rollup_recent(
                db=ts_db,
                source_object_type_id=body.source_object_type_id,
                target_object_type_id=body.target_object_type_id,
                tenant_id=tenant_id,
                hours_back=body.hours_back,
                dimensions=body.dimensions or ["activity"],
                activity_attribute=body.activity_attribute,
                case_id_attribute=body.case_id_attribute,
                timestamp_attribute=body.timestamp_attribute,
                excluded_activities=body.excluded_activities,
                attribute_filters=body.attribute_filters,
                metrics=body.metrics,
            )
        return await records_rollup_recent(
            pg_db=pg_db,
            source_object_type_id=body.source_object_type_id,
            target_object_type_id=body.target_object_type_id,
            tenant_id=tenant_id,
            hours_back=body.hours_back,
            dimensions=body.dimensions,
            metrics=body.metrics,
            time_field=body.time_field or "time",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
