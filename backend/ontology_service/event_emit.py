"""
Fire-and-forget emission of process-mining events + audit log entries.

Called by the records router after every successful create / update / delete.
Failures are logged but never raised — the caller's write must succeed even
if the downstream services are unavailable.

Two destinations per call:
  · event-log-service /events  → process mining (case_id = record id, activity = `<Type>.<verb>`)
  · audit-service     /audit   → who/what/when, before/after states

Both endpoints run with SKIP_AUTH=true in dev compose, so we don't forward
the caller's JWT. In production, set ONTOLOGY_SERVICE_TOKEN env to a
service-account token and the helper will include it as Authorization.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import httpx

EVENT_LOG_API = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")
AUDIT_API     = os.environ.get("AUDIT_SERVICE_URL",     "http://audit-service:8006")
SERVICE_TOKEN = os.environ.get("ONTOLOGY_SERVICE_TOKEN", "")

log = logging.getLogger("ontology.event_emit")


def _maybe_auth_header() -> dict[str, str]:
    return {"Authorization": f"Bearer {SERVICE_TOKEN}"} if SERVICE_TOKEN else {}


async def _post(client: httpx.AsyncClient, url: str, *, json: dict, headers: dict) -> None:
    """Single POST. Logs failures, never raises."""
    try:
        r = await client.post(url, json=json, headers=headers, timeout=5.0)
        if r.status_code >= 400:
            log.warning("event_emit_http_error url=%s status=%s body=%s",
                        url, r.status_code, r.text[:200])
    except Exception as e:
        log.warning("event_emit_failed url=%s err=%s", url, e)


def _role_for(actor_role: str) -> str:
    """Map AuthUser.role (lowercase) → AuditEvent.actor_role enum (UPPER)."""
    mapping = {
        "superadmin":     "ADMIN",
        "admin":          "ADMIN",
        "data_engineer":  "DATA_ENGINEER",
        "analyst":        "ANALYST",
        "viewer":         "VIEWER",
        "auditor":        "AUDITOR",
        "service":        "SERVICE_ACCOUNT",
        "system":         "SERVICE_ACCOUNT",
    }
    return mapping.get(actor_role.lower(), "SERVICE_ACCOUNT")


def emit_record_event(
    *,
    tenant_id: str,
    object_type_id: str,
    object_type_name: str,
    record_id: str,
    activity: str,
    actor_id: str = "system",
    actor_role: str = "system",
    before_state: Optional[dict] = None,
    after_state: Optional[dict] = None,
    pipeline_id: str = "",
) -> None:
    """
    Schedule a fire-and-forget emit. Returns immediately — the actual HTTP
    calls run on the asyncio loop in the background.

    Schedules two POSTs in parallel:
      · event-log /events   — process-mining event
      · audit-service /audit — audit trail entry
    """
    now_iso = datetime.now(timezone.utc).isoformat()

    event_payload = {
        "id":              str(uuid4()),
        "tenant_id":       tenant_id,
        "case_id":         record_id,
        "activity":        activity,
        "timestamp":       now_iso,
        "object_type_id":  object_type_id,
        "object_id":       record_id,
        "pipeline_id":     pipeline_id or "ontology-write",
        "connector_id":    "",
        "attributes": {
            "object_type_name": object_type_name,
            "actor_id":         actor_id,
        },
    }

    audit_payload = {
        "id":            str(uuid4()),
        "tenant_id":     tenant_id,
        "actor_id":      actor_id,
        "actor_role":    _role_for(actor_role),
        "action":        activity,
        "resource_type": object_type_name,
        "resource_id":   record_id,
        "before_state":  before_state,
        "after_state":   after_state,
        "occurred_at":   now_iso,
        "success":       True,
    }

    common_headers = {"x-tenant-id": tenant_id, **_maybe_auth_header()}
    audit_headers  = {**common_headers, "x-internal": "1", "x-service-name": "ontology-service"}

    async def _run() -> None:
        try:
            async with httpx.AsyncClient() as client:
                await asyncio.gather(
                    _post(client, f"{EVENT_LOG_API}/events", json=event_payload, headers=common_headers),
                    _post(client, f"{AUDIT_API}/audit",      json=audit_payload, headers=audit_headers),
                )
        except Exception as e:
            log.warning("event_emit_top_level_failed err=%s", e)

    # Schedule on the running loop so this returns immediately.
    try:
        asyncio.create_task(_run())
    except RuntimeError:
        # No running loop (shouldn't happen in a FastAPI handler) — drop.
        log.warning("event_emit_no_loop activity=%s record=%s", activity, record_id)


def emit_record_event_batch(
    *,
    tenant_id: str,
    object_type_id: str,
    object_type_name: str,
    record_ids: list[str],
    activity: str,
    actor_id: str = "system",
    actor_role: str = "system",
    pipeline_id: str = "",
) -> None:
    """
    Convenience wrapper for bulk ingests — emits one event per record but
    skips before/after states (would explode the payload). For pipelines
    pumping 100k+ records, an upstream caller should swap to a single
    summary event.
    """
    for rid in record_ids:
        emit_record_event(
            tenant_id=tenant_id,
            object_type_id=object_type_id,
            object_type_name=object_type_name,
            record_id=rid,
            activity=activity,
            actor_id=actor_id,
            actor_role=actor_role,
            pipeline_id=pipeline_id,
        )
