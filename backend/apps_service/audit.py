"""
Audit helper. Writes one row to external_app_audit per event.

Kept in-service (rather than calling audit_service over HTTP) because:
  - RPC throughput is high, an extra hop per call would dominate latency
  - apps-specific schema (install_id, scope_used) doesn't fit audit_service's table
The audit_service still receives a daily rollup for the master audit trail.
"""
from __future__ import annotations
import logging
import uuid
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from database import ExternalAppAuditRow

log = logging.getLogger("apps_service.audit")


async def write_audit(
    db: AsyncSession,
    *,
    tenant_id: str,
    install_id: str | None,
    app_id: str | None,
    user_id: str | None,
    event_type: str,
    status: str,
    method: str | None = None,
    scope_used: str | None = None,
    payload_size: int | None = None,
    response_size: int | None = None,
    latency_ms: int | None = None,
    error_message: str | None = None,
    extras: dict[str, Any] | None = None,
) -> None:
    row = ExternalAppAuditRow(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        install_id=install_id,
        app_id=app_id,
        user_id=user_id,
        event_type=event_type,
        method=method,
        scope_used=scope_used,
        payload_size=payload_size,
        response_size=response_size,
        latency_ms=latency_ms,
        status=status,
        error_message=error_message,
        extras=extras,
    )
    db.add(row)
    try:
        await db.commit()
    except Exception as e:
        log.error(f"audit write failed: {e}")
        await db.rollback()
