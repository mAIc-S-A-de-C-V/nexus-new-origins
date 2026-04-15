"""
Webhook endpoint CRUD + inbound receiver.
"""
import os
import hmac
import hashlib
import secrets
import logging
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Header, Request, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx

from database import WebhookEndpointRow, get_session

router = APIRouter()
logger = logging.getLogger(__name__)

EVENT_LOG_URL = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")
PIPELINE_SERVICE_URL = os.environ.get("PIPELINE_SERVICE_URL", "http://pipeline-service:8007")


# ── Pydantic models ─────────────────────────────────────────────────────────

class WebhookCreate(BaseModel):
    name: str
    slug: Optional[str] = None
    secret: Optional[str] = None
    target_type: str  # pipeline, action, event_log
    target_id: str
    field_mappings: dict = {}
    enabled: bool = True


def _to_dict(row: WebhookEndpointRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "slug": row.slug,
        "secret": row.secret,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "field_mappings": row.field_mappings or {},
        "enabled": row.enabled,
        "last_received_at": row.last_received_at.isoformat() if row.last_received_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _generate_slug() -> str:
    """Generate a URL-safe random slug."""
    return secrets.token_urlsafe(16)


# ── CRUD endpoints ───────────────────────────────────────────────────────────

@router.get("")
async def list_webhooks(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(WebhookEndpointRow)
        .where(WebhookEndpointRow.tenant_id == tenant_id)
        .order_by(WebhookEndpointRow.created_at.desc())
    )
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_webhook(
    body: WebhookCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    slug = body.slug or _generate_slug()

    # Check slug uniqueness
    existing = await db.execute(
        select(WebhookEndpointRow).where(WebhookEndpointRow.slug == slug)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Slug '{slug}' already in use")

    if body.target_type not in ("pipeline", "action", "event_log"):
        raise HTTPException(status_code=400, detail="target_type must be 'pipeline', 'action', or 'event_log'")

    row = WebhookEndpointRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        slug=slug,
        secret=body.secret,
        target_type=body.target_type,
        target_id=body.target_id,
        field_mappings=body.field_mappings,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(WebhookEndpointRow).where(
            WebhookEndpointRow.id == webhook_id,
            WebhookEndpointRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")
    await db.delete(row)
    await db.commit()


# ── Inbound receiver ─────────────────────────────────────────────────────────

def _verify_hmac(secret: str, body_bytes: bytes, signature: str) -> bool:
    """Verify HMAC-SHA256 signature. Expects signature in 'sha256=<hex>' format."""
    expected = "sha256=" + hmac.new(
        secret.encode(), body_bytes, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/receive/{slug}")
async def receive_webhook(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_session),
):
    """
    Receive an external webhook payload.
    Validates HMAC if a secret is configured.
    Routes to pipeline service or event log service based on target_type.
    """
    result = await db.execute(
        select(WebhookEndpointRow).where(WebhookEndpointRow.slug == slug)
    )
    endpoint = result.scalar_one_or_none()
    if not endpoint:
        raise HTTPException(status_code=404, detail="Webhook endpoint not found")

    if not endpoint.enabled:
        raise HTTPException(status_code=403, detail="Webhook endpoint is disabled")

    body_bytes = await request.body()

    # HMAC validation
    if endpoint.secret:
        sig_header = request.headers.get("x-hub-signature-256") or request.headers.get("x-signature-256", "")
        if not sig_header or not _verify_hmac(endpoint.secret, body_bytes, sig_header):
            raise HTTPException(status_code=401, detail="Invalid HMAC signature")

    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Update last_received_at
    endpoint.last_received_at = datetime.now(timezone.utc)
    await db.commit()

    # Apply field mappings: remap incoming keys to target keys
    mapped_payload = payload
    if endpoint.field_mappings and isinstance(payload, dict):
        mapped_payload = {}
        for src_key, dst_key in endpoint.field_mappings.items():
            if src_key in payload:
                mapped_payload[dst_key] = payload[src_key]
        # Include unmapped keys as-is
        for k, v in payload.items():
            if k not in endpoint.field_mappings:
                mapped_payload[k] = v

    # Route based on target_type
    tenant_id = endpoint.tenant_id

    if endpoint.target_type == "pipeline":
        # Trigger a pipeline run
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{PIPELINE_SERVICE_URL}/pipelines/{endpoint.target_id}/run",
                    json={"trigger": "webhook", "webhook_slug": slug, "payload": mapped_payload},
                    headers={"x-tenant-id": tenant_id},
                )
                logger.info(f"Webhook '{slug}' triggered pipeline {endpoint.target_id}: {resp.status_code}")
                return {
                    "status": "delivered",
                    "target_type": "pipeline",
                    "target_id": endpoint.target_id,
                    "pipeline_response_status": resp.status_code,
                }
        except Exception as exc:
            logger.error(f"Webhook '{slug}' failed to trigger pipeline: {exc}")
            return {"status": "error", "error": str(exc)}

    elif endpoint.target_type == "event_log":
        # Write events to event log service
        events = []
        items = mapped_payload if isinstance(mapped_payload, list) else [mapped_payload]
        for item in items:
            events.append({
                "object_type_id": endpoint.target_id,
                "tenant_id": tenant_id,
                "case_id": item.get("case_id", str(uuid4())),
                "activity": item.get("activity", "WEBHOOK_RECEIVED"),
                "timestamp": item.get("timestamp", datetime.now(timezone.utc).isoformat()),
                "resource": item.get("resource"),
                "attributes": {"webhook_slug": slug, "record_snapshot": item},
            })

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    f"{EVENT_LOG_URL}/events/batch",
                    json=events,
                    headers={"x-tenant-id": tenant_id},
                )
                logger.info(f"Webhook '{slug}' wrote {len(events)} events: {resp.status_code}")
                return {
                    "status": "delivered",
                    "target_type": "event_log",
                    "target_id": endpoint.target_id,
                    "events_written": len(events),
                }
        except Exception as exc:
            logger.error(f"Webhook '{slug}' failed to write events: {exc}")
            return {"status": "error", "error": str(exc)}

    elif endpoint.target_type == "action":
        # Action targets are a placeholder for future extensibility
        return {
            "status": "received",
            "target_type": "action",
            "target_id": endpoint.target_id,
            "payload": mapped_payload,
        }

    return {"status": "received"}
