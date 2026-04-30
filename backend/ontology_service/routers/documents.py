"""
Documents API — file uploads with MinIO/S3 storage.

POST   /documents/upload                — multipart upload, returns Document record
GET    /documents/{id}                   — Document record (metadata only)
GET    /documents/{id}/file              — proxy the file bytes back from MinIO
PATCH  /documents/{id}/extracted-fields  — set extracted_fields + extraction_status
                                           (called by inference-service after vision pass)
GET    /documents/by-record/{otId}/{rid} — list Documents linked to a given record

Documents are persisted as ObjectRecordRow rows under a special object type
named "Document" (auto-created on first upload if missing). The actual file
bytes live in MinIO under bucket `nexus-documents`, key
`{tenant_id}/{document_id}/{original_filename}`.
"""
from __future__ import annotations

import io
import logging
import os
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from minio import Minio
from minio.error import S3Error
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from database import ObjectRecordRow, ObjectTypeRow, get_session
from event_emit import emit_record_event

log = logging.getLogger("ontology.documents")

router = APIRouter()

MINIO_ENDPOINT      = os.environ.get("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY    = os.environ.get("MINIO_ACCESS_KEY", "minio_admin")
MINIO_SECRET_KEY    = os.environ.get("MINIO_SECRET_KEY", "minio_pass")
MINIO_BUCKET        = os.environ.get("MINIO_BUCKET", "nexus-documents")
MINIO_PUBLIC_BASE   = os.environ.get("MINIO_PUBLIC_BASE", "http://localhost:9100")
INFERENCE_SERVICE_URL = os.environ.get("INFERENCE_SERVICE_URL", "http://inference-service:8003")


# ── MinIO client (singleton) ────────────────────────────────────────────────

_minio_client: Optional[Minio] = None


def _client() -> Minio:
    global _minio_client
    if _minio_client is None:
        _minio_client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=False,  # in-cluster traffic, plain HTTP
        )
        # Make sure the bucket exists; idempotent.
        try:
            if not _minio_client.bucket_exists(MINIO_BUCKET):
                _minio_client.make_bucket(MINIO_BUCKET)
        except S3Error as e:
            log.warning("minio_bucket_setup_failed err=%s", e)
    return _minio_client


# ── Document object type bootstrap ──────────────────────────────────────────

DOCUMENT_TYPE_NAME = "Document"

DOCUMENT_PROPERTIES = [
    {"name": "id",                 "display_name": "ID",                "semantic_type": "IDENTIFIER", "data_type": "string", "pii_level": "NONE", "required": True,  "sample_values": []},
    {"name": "original_filename",  "display_name": "Filename",          "semantic_type": "TEXT",       "data_type": "string", "pii_level": "NONE", "required": True,  "sample_values": []},
    {"name": "mime_type",          "display_name": "MIME type",         "semantic_type": "CATEGORY",   "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "size_bytes",         "display_name": "Size (bytes)",      "semantic_type": "QUANTITY",   "data_type": "integer","pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "file_url",           "display_name": "File URL",          "semantic_type": "URL",        "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "storage_key",        "display_name": "Storage key",       "semantic_type": "TEXT",       "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "ocr_text",           "display_name": "OCR text",          "semantic_type": "TEXT",       "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "extracted_fields",   "display_name": "Extracted fields",  "semantic_type": "TEXT",       "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "extraction_status",  "display_name": "Extraction status", "semantic_type": "STATUS",     "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "linked_record_id",   "display_name": "Linked record id",  "semantic_type": "IDENTIFIER", "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "linked_record_type", "display_name": "Linked record type","semantic_type": "TEXT",       "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "uploaded_by",        "display_name": "Uploaded by",       "semantic_type": "IDENTIFIER", "data_type": "string", "pii_level": "NONE", "required": False, "sample_values": []},
    {"name": "uploaded_at",        "display_name": "Uploaded at",       "semantic_type": "DATETIME",   "data_type": "datetime","pii_level": "NONE","required": False, "sample_values": []},
]


async def _get_or_create_document_type(db: AsyncSession, tenant_id: str) -> str:
    """Find or create the Document object type for this tenant. Returns the OT id."""
    result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.tenant_id == tenant_id,
            ObjectTypeRow.name == DOCUMENT_TYPE_NAME,
        )
    )
    row = result.scalar_one_or_none()
    if row:
        return row.id
    ot_id = str(uuid4())
    now_iso = datetime.now(timezone.utc).isoformat()
    new_row = ObjectTypeRow(
        id=ot_id,
        tenant_id=tenant_id,
        name=DOCUMENT_TYPE_NAME,
        display_name="Document",
        version=1,
        data={
            "id": ot_id,
            "tenant_id": tenant_id,
            "name": DOCUMENT_TYPE_NAME,
            "display_name": "Document",
            "description": "Uploaded files (receipts, invoices, IDs, etc.) with optional OCR-extracted fields.",
            "properties": DOCUMENT_PROPERTIES,
            "source_connector_ids": [],
            "version": 1,
            "schema_health": "healthy",
            "created_at": now_iso,
            "updated_at": now_iso,
        },
    )
    db.add(new_row)
    await db.commit()
    log.info("document_type_created tenant=%s ot_id=%s", tenant_id, ot_id)
    return ot_id


# ── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    linked_record_id: Optional[str]   = Form(None),
    linked_record_type: Optional[str] = Form(None),
    x_tenant_id: Optional[str]        = Header(None),
    db: AsyncSession                  = Depends(get_session),
):
    """
    Multipart upload. Stores the file in MinIO and creates a Document record.
    Optionally links the document to an existing record (e.g. a Bill or Invoice).
    """
    tenant_id = x_tenant_id or "tenant-001"
    ot_id = await _get_or_create_document_type(db, tenant_id)

    document_id = str(uuid4())
    filename = file.filename or f"upload-{document_id}"
    safe_name = filename.replace("/", "_")  # avoid path traversal
    storage_key = f"{tenant_id}/{document_id}/{safe_name}"

    # Read the body once — UploadFile is a SpooledTemporaryFile.
    body = await file.read()
    size = len(body)

    try:
        client = _client()
        client.put_object(
            MINIO_BUCKET,
            storage_key,
            io.BytesIO(body),
            length=size,
            content_type=file.content_type or "application/octet-stream",
        )
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")

    file_url = f"{MINIO_PUBLIC_BASE}/{MINIO_BUCKET}/{storage_key}"
    now_iso = datetime.now(timezone.utc).isoformat()

    record = {
        "id":                 document_id,
        "original_filename":  filename,
        "mime_type":          file.content_type or "",
        "size_bytes":         size,
        "file_url":           file_url,
        "storage_key":        storage_key,
        "ocr_text":           "",
        "extracted_fields":   "",
        "extraction_status":  "pending",
        "linked_record_id":   linked_record_id or "",
        "linked_record_type": linked_record_type or "",
        "uploaded_at":        now_iso,
        "_pipeline_id":       "documents-upload",
        "_pipeline_run_at":   now_iso,
    }

    db.add(ObjectRecordRow(
        id=str(uuid4()),
        object_type_id=ot_id,
        tenant_id=tenant_id,
        source_id=document_id,
        data=record,
    ))
    await db.commit()

    emit_record_event(
        tenant_id=tenant_id,
        object_type_id=ot_id,
        object_type_name=DOCUMENT_TYPE_NAME,
        record_id=document_id,
        activity=f"{DOCUMENT_TYPE_NAME}.uploaded",
        actor_id="user",
        actor_role="service",
        after_state=record,
    )

    return {"document": record, "object_type_id": ot_id}


@router.get("/{document_id}")
async def get_document(
    document_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession           = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == document_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"document": row.data, "source_id": row.source_id}


@router.get("/{document_id}/file")
async def get_document_file(
    document_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession           = Depends(get_session),
):
    """Proxy the file bytes from MinIO. Used by the inference vision call
    and by the frontend for previewing uploads."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == document_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")
    storage_key = (row.data or {}).get("storage_key")
    mime_type   = (row.data or {}).get("mime_type") or "application/octet-stream"
    if not storage_key:
        raise HTTPException(status_code=404, detail="Document has no storage key")

    try:
        client = _client()
        resp = client.get_object(MINIO_BUCKET, storage_key)
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Fetch failed: {e}")

    def _stream():
        try:
            for chunk in resp.stream(64 * 1024):
                yield chunk
        finally:
            resp.close()
            resp.release_conn()

    return StreamingResponse(_stream(), media_type=mime_type)


@router.patch("/{document_id}/extracted-fields")
async def patch_extracted_fields(
    document_id: str,
    payload: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession           = Depends(get_session),
):
    """
    Called by the inference-service (or the frontend) once OCR/extraction
    is done. Sets `extracted_fields` (JSON-stringified), `ocr_text`, and
    `extraction_status`.
    """
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.source_id == document_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Document not found")

    before = dict(row.data)
    merged = dict(row.data)
    if "extracted_fields" in payload:
        merged["extracted_fields"] = payload["extracted_fields"]
    if "ocr_text" in payload:
        merged["ocr_text"] = payload["ocr_text"]
    if "extraction_status" in payload:
        merged["extraction_status"] = payload["extraction_status"]
    row.data = merged
    flag_modified(row, "data")
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()

    # Get the OT name for the audit event
    ot_lookup = await db.execute(select(ObjectTypeRow.name).where(ObjectTypeRow.id == row.object_type_id))
    ot_name = ot_lookup.scalar() or DOCUMENT_TYPE_NAME
    emit_record_event(
        tenant_id=tenant_id,
        object_type_id=row.object_type_id,
        object_type_name=ot_name,
        record_id=document_id,
        activity=f"{DOCUMENT_TYPE_NAME}.extracted",
        actor_id="inference-service",
        actor_role="service",
        before_state=before,
        after_state=merged,
    )

    return {"document": merged, "source_id": document_id}


@router.get("/by-record/{linked_type}/{linked_id}")
async def list_documents_for_record(
    linked_type: str,
    linked_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession           = Depends(get_session),
):
    """List all Documents linked to a given record."""
    tenant_id = x_tenant_id or "tenant-001"
    # Find the Document object type for this tenant.
    ot_result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.tenant_id == tenant_id,
            ObjectTypeRow.name == DOCUMENT_TYPE_NAME,
        )
    )
    ot_row = ot_result.scalar_one_or_none()
    if not ot_row:
        return {"documents": []}
    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.tenant_id == tenant_id,
            ObjectRecordRow.object_type_id == ot_row.id,
        )
    )
    rows = result.scalars().all()
    matching = [
        r.data for r in rows
        if (r.data or {}).get("linked_record_id") == linked_id
        and (r.data or {}).get("linked_record_type") == linked_type
    ]
    return {"documents": matching}
