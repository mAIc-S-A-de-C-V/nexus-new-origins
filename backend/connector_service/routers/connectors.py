import time
import asyncio
import os
from typing import Optional, Any
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx
from models import (
    ConnectorConfig, ConnectorCreateRequest,
    ConnectorUpdateRequest, ConnectionTestResult
)
from database import ConnectorRow, get_session
from schema_fetcher import fetch_schema, test_credentials

router = APIRouter()

EVENT_LOG_URL = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")


async def _emit_event(payload: dict) -> None:
    """Fire-and-forget event emission to event-log-service."""
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(f"{EVENT_LOG_URL}/events", json=payload)
    except Exception:
        pass  # non-critical — never fail a request because of event emission


def _row_to_model(row: ConnectorRow) -> ConnectorConfig:
    return ConnectorConfig(
        id=row.id,
        name=row.name,
        type=row.type,
        category=row.category,
        status=row.status,
        description=row.description,
        base_url=row.base_url,
        auth_type=row.auth_type,
        credentials=row.credentials,
        headers=row.headers,
        pagination_strategy=row.pagination_strategy,
        active_pipeline_count=row.active_pipeline_count,
        last_sync=row.last_sync,
        last_sync_row_count=row.last_sync_row_count,
        schema_hash=row.schema_hash,
        tags=row.tags or [],
        config=row.config,
        created_at=row.created_at,
        updated_at=row.updated_at,
        tenant_id=row.tenant_id,
    )


@router.get("", response_model=list[ConnectorConfig])
async def list_connectors(
    category: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = select(ConnectorRow).where(ConnectorRow.tenant_id == tenant_id)
    if category:
        stmt = stmt.where(ConnectorRow.category == category)
    if status:
        stmt = stmt.where(ConnectorRow.status == status)
    result = await db.execute(stmt)
    return [_row_to_model(r) for r in result.scalars().all()]


@router.post("", response_model=ConnectorConfig, status_code=201)
async def create_connector(
    req: ConnectorCreateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    from uuid import uuid4
    row = ConnectorRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=req.name,
        type=req.type,
        category=req.category,
        status="idle",
        description=req.description,
        base_url=req.base_url,
        auth_type=req.auth_type,
        credentials=req.credentials,
        headers=req.headers,
        pagination_strategy=req.pagination_strategy,
        tags=req.tags,
        config=req.config,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_model(row)


@router.get("/{connector_id}", response_model=ConnectorConfig)
async def get_connector(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")
    return _row_to_model(row)


@router.put("/{connector_id}", response_model=ConnectorConfig)
async def update_connector(
    connector_id: str,
    req: ConnectorUpdateRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")

    update_data = req.model_dump(exclude_none=True)
    for key, value in update_data.items():
        setattr(row, key, value)
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    return _row_to_model(row)


@router.delete("/{connector_id}", status_code=204)
async def delete_connector(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")
    await db.delete(row)
    await db.commit()


@router.post("/{connector_id}/test", response_model=ConnectionTestResult)
async def test_connection(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")

    success, message, latency_ms = await test_credentials(
        connector_type=row.type,
        base_url=row.base_url,
        credentials=row.credentials,
        config=row.config,
        db=db,
    )

    # Update connector status based on test result
    row.status = "active" if success else "error"
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()

    from uuid import uuid4
    asyncio.create_task(_emit_event({
        "id": str(uuid4()),
        "case_id": connector_id,
        "activity": "CONNECTOR_TEST_PASSED" if success else "CONNECTOR_TEST_FAILED",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "object_type_id": "",
        "object_id": connector_id,
        "pipeline_id": "",
        "connector_id": connector_id,
        "tenant_id": tenant_id,
        "attributes": {"latency_ms": latency_ms, "message": message},
    }))

    return ConnectionTestResult(
        success=success,
        latency_ms=latency_ms,
        message=message,
        error=None if success else message,
    )


@router.get("/{connector_id}/schema")
async def get_schema(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")

    raw_schema, sample_rows, error = await fetch_schema(
        connector_type=row.type,
        base_url=row.base_url,
        credentials=row.credentials,
        config=row.config,
        db=db,
        last_sync=row.last_sync,
    )

    if not error:
        from uuid import uuid4
        asyncio.create_task(_emit_event({
            "id": str(uuid4()),
            "case_id": connector_id,
            "activity": "CONNECTOR_SCHEMA_FETCHED",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "object_type_id": "",
            "object_id": connector_id,
            "pipeline_id": "",
            "connector_id": connector_id,
            "tenant_id": tenant_id,
            "attributes": {"row_count": len(sample_rows) if sample_rows else 0},
        }))

    return {
        "connector_id": connector_id,
        "connector_type": row.type,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "schema": raw_schema,
        "sample_rows": sample_rows,
        "error": error,
    }


@router.post("/{connector_id}/fetch-row")
async def fetch_row(
    connector_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Call this connector's configured endpoint with query param overrides.
    Used by the pipeline ENRICH node to perform per-row detail lookups.
    Body: {"params": {"id": "INC-123"}}
    Returns: {"row": {...}, "rows": [...]}
    """
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")

    overrides: dict = body.get("params", {})
    config = dict(row.config or {})
    existing_qp = dict(config.get("queryParams") or {})
    existing_qp.update({k: str(v) for k, v in overrides.items()})
    config["queryParams"] = existing_qp

    _, sample_rows, error = await fetch_schema(
        connector_type=row.type,
        base_url=row.base_url,
        credentials=row.credentials,
        config=config,
        db=db,
    )

    if error:
        raise HTTPException(status_code=502, detail=error)

    return {
        "row": sample_rows[0] if sample_rows else {},
        "rows": sample_rows,
    }


@router.patch("/{connector_id}/last-sync")
async def update_last_sync(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Mark the connector as synced right now (called by pipeline executor after a successful run)."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")
    row.last_sync = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True, "last_sync": row.last_sync.isoformat()}


@router.put("/{connector_id}/inference")
async def save_inference_result(
    connector_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Persist an inference result for a connector (called after Claude inference completes)."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")

    row.inference_result = body
    row.inference_ran_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "saved"}


@router.get("/{connector_id}/inference")
async def get_inference_result(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Retrieve the persisted inference result for a connector."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Connector not found")
    if not row.inference_result:
        raise HTTPException(status_code=404, detail="No inference result found for this connector")
    return {
        "connector_id": connector_id,
        "inference_result": row.inference_result,
        "inference_ran_at": row.inference_ran_at.isoformat() if row.inference_ran_at else None,
    }
