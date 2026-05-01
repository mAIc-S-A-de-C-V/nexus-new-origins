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

# Hard cap on per-ingest event spam. Ingests beyond this size collapse into
# one summary event instead of one-per-record. Without this, a single
# /records/ingest of 1000+ records used to spawn ~2000 background httpx
# clients and saturate the asyncio loop, causing the service to stop
# responding to new requests.
MAX_PER_RECORD_EVENTS = int(os.environ.get("EVENT_EMIT_MAX_PER_RECORD", "50"))

# Concurrency cap on the in-flight emits — back-pressure when something is
# trying to fire many events at once.
EMIT_CONCURRENCY = int(os.environ.get("EVENT_EMIT_CONCURRENCY", "8"))

log = logging.getLogger("ontology.event_emit")

# Shared httpx client + semaphore. Created lazily on first emit so we
# attach to whichever event loop FastAPI is using.
_client: Optional[httpx.AsyncClient] = None
_semaphore: Optional[asyncio.Semaphore] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=5.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _client


def _get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(EMIT_CONCURRENCY)
    return _semaphore


def _maybe_auth_header() -> dict[str, str]:
    return {"Authorization": f"Bearer {SERVICE_TOKEN}"} if SERVICE_TOKEN else {}


async def _post(client: httpx.AsyncClient, url: str, *, json: dict, headers: dict) -> None:
    """Single POST. Logs failures, never raises."""
    try:
        r = await client.post(url, json=json, headers=headers)
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
        sem = _get_semaphore()
        async with sem:
            try:
                client = _get_client()
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
    Bulk emit. Two modes:

    · Up to MAX_PER_RECORD_EVENTS records: one event per record so each
      record has a per-record case_id and a corresponding audit row.
    · Above that: a single SUMMARY event recorded against the pipeline_id
      (or the object type id) as the case key. Rendering 100k events from
      one ingest used to saturate the asyncio loop and stop the service
      responding — this collapses the spam to a single event with a
      `record_count` attribute and the first/last record ids.
    """
    if not record_ids:
        return
    if len(record_ids) <= MAX_PER_RECORD_EVENTS:
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
        return

    # High-volume path — single summary event. Use pipeline_id (or object
    # type id) as the case key so the events still group sensibly in
    # process-mining views.
    summary_case = pipeline_id or object_type_id
    summary_record_id = f"batch:{summary_case}:{record_ids[0]}"
    summary_after = {
        "record_count": len(record_ids),
        "first_record_id": record_ids[0],
        "last_record_id": record_ids[-1],
        "pipeline_id": pipeline_id,
    }
    emit_record_event(
        tenant_id=tenant_id,
        object_type_id=object_type_id,
        object_type_name=object_type_name,
        record_id=summary_record_id,
        activity=f"{activity}.batch",
        actor_id=actor_id,
        actor_role=actor_role,
        pipeline_id=pipeline_id,
        after_state=summary_after,
    )
