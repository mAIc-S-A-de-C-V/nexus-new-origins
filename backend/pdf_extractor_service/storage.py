"""MinIO storage helper for the PDF extractor service.

Stores:
  - Source PDFs at  pdf-extractor/{tenant_id}/{job_id}/source.pdf
  - Matched images at pdf-extractor/{tenant_id}/{job_id}/images/{product_id}.{ext}

Public URLs are returned for the frontend to render image thumbnails. Reuses
the shared `nexus-documents` bucket and the MINIO_PUBLIC_BASE used elsewhere
(see ontology_service/routers/documents.py) so deployments only configure
MinIO once.
"""
from __future__ import annotations

import io
import logging
import os
from typing import Optional

from minio import Minio
from minio.error import S3Error

log = logging.getLogger("pdf_extractor.storage")

MINIO_ENDPOINT   = os.environ.get("MINIO_ENDPOINT", "minio:9000")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minio_admin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minio_pass")
MINIO_BUCKET     = os.environ.get("MINIO_BUCKET", "nexus-documents")
MINIO_PUBLIC_BASE = os.environ.get("MINIO_PUBLIC_BASE", "http://localhost:9100")
MINIO_SECURE     = os.environ.get("MINIO_SECURE", "false").lower() == "true"

_client: Optional[Minio] = None


def client() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE,
        )
        try:
            if not _client.bucket_exists(MINIO_BUCKET):
                _client.make_bucket(MINIO_BUCKET)
        except S3Error as e:
            log.warning("minio_bucket_setup_failed err=%s", e)
    return _client


def pdf_storage_key(tenant_id: str, job_id: str) -> str:
    return f"pdf-extractor/{tenant_id}/{job_id}/source.pdf"


def image_storage_key(tenant_id: str, job_id: str, product_id: str, ext: str) -> str:
    safe_ext = ext.lower().lstrip(".") or "bin"
    return f"pdf-extractor/{tenant_id}/{job_id}/images/{product_id}.{safe_ext}"


def public_url(storage_key: str) -> str:
    return f"{MINIO_PUBLIC_BASE}/{MINIO_BUCKET}/{storage_key}"


def put_bytes(storage_key: str, data: bytes, content_type: str) -> str:
    """Upload bytes and return the public URL."""
    client().put_object(
        MINIO_BUCKET,
        storage_key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type,
    )
    return public_url(storage_key)


def get_bytes(storage_key: str) -> bytes:
    """Fetch the whole object back as bytes. Used by the extractor worker
    to pick the PDF back up off MinIO once the upload request returned."""
    resp = client().get_object(MINIO_BUCKET, storage_key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


def remove_prefix(prefix: str) -> None:
    """Best-effort cleanup of every object under a prefix (used on job delete)."""
    try:
        c = client()
        objs = c.list_objects(MINIO_BUCKET, prefix=prefix, recursive=True)
        for obj in objs:
            try:
                c.remove_object(MINIO_BUCKET, obj.object_name)
            except S3Error as e:
                log.warning("minio_remove_failed key=%s err=%s", obj.object_name, e)
    except S3Error as e:
        log.warning("minio_list_failed prefix=%s err=%s", prefix, e)
