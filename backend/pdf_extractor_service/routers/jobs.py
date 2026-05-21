"""PDF extractor job endpoints.

Self-contained. No coupling to connectors or pipelines. Optional ontology
push at the end is the only outbound call to the rest of the platform.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal, PdfJobRow, PdfProductRow, get_session
from extractor import DEFAULT_MODEL, ExtractedProduct, PdfExtractor
from storage import client as minio_client, get_bytes, pdf_storage_key, put_bytes, remove_prefix, MINIO_BUCKET

router = APIRouter()
log = logging.getLogger("pdf_extractor.jobs")

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ONTOLOGY_SERVICE_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")


# ── Response models ────────────────────────────────────────────────────────

class JobView(BaseModel):
    id: str
    tenant_id: str
    filename: str
    status: str
    model: str
    dpi: int
    page_range: Optional[str] = None
    total_pages: Optional[int] = None
    pages_done: int
    products_found: int
    error: Optional[str] = None
    progress_log: list
    pushed_to_object_type_id: Optional[str] = None
    pushed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProductView(BaseModel):
    id: str
    page: int
    category: Optional[str] = None
    name: Optional[str] = None
    sku_internal: Optional[str] = None
    sku_ref: Optional[str] = None
    specifications: dict = {}
    accessories: list = []
    variants: list = []
    image_url: Optional[str] = None


class PushToOntologyRequest(BaseModel):
    object_type_id: str
    field_map: dict = {}  # extracted_field -> ontology property name; empty = use same names


# ── Helpers ───────────────────────────────────────────────────────────────

def _job_to_view(row: PdfJobRow) -> JobView:
    return JobView(
        id=row.id,
        tenant_id=row.tenant_id,
        filename=row.filename,
        status=row.status,
        model=row.model,
        dpi=row.dpi,
        page_range=row.page_range,
        total_pages=row.total_pages,
        pages_done=row.pages_done,
        products_found=row.products_found,
        error=row.error,
        progress_log=row.progress_log or [],
        pushed_to_object_type_id=row.pushed_to_object_type_id,
        pushed_at=row.pushed_at,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _product_to_view(row: PdfProductRow) -> ProductView:
    return ProductView(
        id=row.id,
        page=row.page,
        category=row.category,
        name=row.name,
        sku_internal=row.sku_internal,
        sku_ref=row.sku_ref,
        specifications=row.specifications or {},
        accessories=row.accessories or [],
        variants=row.variants or [],
        image_url=row.image_url,
    )


def _parse_page_range(s: Optional[str]) -> Optional[tuple]:
    if not s:
        return None
    try:
        a, b = s.split("-")
        return (int(a), int(b))
    except Exception as e:
        raise HTTPException(400, f"Invalid page_range '{s}', expected 'start-end' (e.g. '13-20'): {e}")


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("", response_model=JobView, status_code=201)
async def create_job(
    file: UploadFile = File(...),
    model: str = Form(DEFAULT_MODEL),
    dpi: int = Form(150),
    page_range: Optional[str] = Form(None),
    schema_prompt: Optional[str] = Form(None),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Upload a PDF and start an extraction job. Returns immediately —
    extraction runs in the background. Poll GET /pdf-jobs/{id} for status."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(500, "ANTHROPIC_API_KEY is not configured on the server")
    tenant_id = x_tenant_id or "tenant-001"
    job_id = str(uuid.uuid4())

    body = await file.read()
    if not body:
        raise HTTPException(400, "Empty upload")
    # Stash PDF in MinIO so the background task can pick it up after we return.
    storage_key = pdf_storage_key(tenant_id, job_id)
    try:
        put_bytes(storage_key, body, file.content_type or "application/pdf")
    except Exception as e:
        raise HTTPException(500, f"PDF upload to storage failed: {e}")

    page_range_tuple = _parse_page_range(page_range)

    row = PdfJobRow(
        id=job_id,
        tenant_id=tenant_id,
        filename=file.filename or "upload.pdf",
        storage_key=storage_key,
        status="pending",
        model=model,
        dpi=dpi,
        page_range=page_range,
        schema_prompt=schema_prompt,
        progress_log=[],
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)

    # Kick off background extraction
    asyncio.create_task(_run_job(job_id, tenant_id, storage_key, model, dpi,
                                 page_range_tuple, schema_prompt))

    return _job_to_view(row)


@router.get("", response_model=list[JobView])
async def list_jobs(
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = (
        select(PdfJobRow)
        .where(PdfJobRow.tenant_id == tenant_id)
        .order_by(PdfJobRow.created_at.desc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [_job_to_view(r) for r in result.scalars().all()]


@router.get("/{job_id}", response_model=JobView)
async def get_job(
    job_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PdfJobRow).where(
            PdfJobRow.id == job_id, PdfJobRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Job not found")
    return _job_to_view(row)


@router.get("/{job_id}/products", response_model=list[ProductView])
async def list_job_products(
    job_id: str,
    limit: int = Query(500, le=2000),
    offset: int = Query(0),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    stmt = (
        select(PdfProductRow)
        .where(
            PdfProductRow.job_id == job_id,
            PdfProductRow.tenant_id == tenant_id,
        )
        .order_by(PdfProductRow.page.asc(), PdfProductRow.created_at.asc())
        .offset(offset)
        .limit(limit)
    )
    result = await db.execute(stmt)
    return [_product_to_view(r) for r in result.scalars().all()]


@router.get("/{job_id}/csv")
async def download_job_csv(
    job_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Stream a CSV identical in shape to the reference sample_output.csv."""
    import csv as _csv
    import io as _io
    import json as _json

    tenant_id = x_tenant_id or "tenant-001"
    stmt = (
        select(PdfProductRow)
        .where(
            PdfProductRow.job_id == job_id,
            PdfProductRow.tenant_id == tenant_id,
        )
        .order_by(PdfProductRow.page.asc(), PdfProductRow.created_at.asc())
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()

    buf = _io.StringIO()
    cols = ["page", "category", "name", "sku_internal", "sku_ref",
            "specifications", "accessories", "variants", "image_url"]
    w = _csv.DictWriter(buf, fieldnames=cols)
    w.writeheader()
    for r in rows:
        w.writerow({
            "page": r.page,
            "category": r.category or "",
            "name": r.name or "",
            "sku_internal": r.sku_internal or "",
            "sku_ref": r.sku_ref or "",
            "specifications": _json.dumps(r.specifications or {}, ensure_ascii=False),
            "accessories": " | ".join(r.accessories or []),
            "variants": _json.dumps(r.variants or [], ensure_ascii=False),
            "image_url": r.image_url or "",
        })

    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="pdf-job-{job_id}.csv"'},
    )


@router.get("/{job_id}/source.pdf")
async def download_source_pdf(
    job_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Stream the original PDF back from MinIO. Used by the frontend
    preview pane."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PdfJobRow).where(
            PdfJobRow.id == job_id, PdfJobRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Job not found")

    try:
        resp = minio_client().get_object(MINIO_BUCKET, row.storage_key)
    except Exception as e:
        raise HTTPException(500, f"PDF fetch failed: {e}")

    def _stream():
        try:
            for chunk in resp.stream(64 * 1024):
                yield chunk
        finally:
            resp.close()
            resp.release_conn()

    return StreamingResponse(_stream(), media_type="application/pdf")


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PdfJobRow).where(
            PdfJobRow.id == job_id, PdfJobRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Job not found")

    # Best-effort: drop MinIO objects, then product rows, then the job.
    remove_prefix(f"pdf-extractor/{tenant_id}/{job_id}/")
    await db.execute(
        delete(PdfProductRow).where(
            PdfProductRow.job_id == job_id, PdfProductRow.tenant_id == tenant_id,
        )
    )
    await db.delete(row)
    await db.commit()


@router.post("/{job_id}/push-to-ontology", response_model=JobView)
async def push_to_ontology(
    job_id: str,
    body: PushToOntologyRequest,
    x_tenant_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """One-shot push of all extracted products into an ontology object type.
    The caller owns picking (or creating) the ObjectType — we just write rows
    via the ontology service's aggregate/records endpoint.

    field_map is { extracted_field_name: ontology_property_name }. Any
    extracted field NOT in field_map (when field_map is non-empty) is
    excluded from the upload, which lets the UI suppress noisy fields."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(PdfJobRow).where(
            PdfJobRow.id == job_id, PdfJobRow.tenant_id == tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    if job.status != "completed":
        raise HTTPException(400, f"Job is {job.status}, must be 'completed' to push")

    prod_result = await db.execute(
        select(PdfProductRow).where(
            PdfProductRow.job_id == job_id,
            PdfProductRow.tenant_id == tenant_id,
        )
    )
    products = prod_result.scalars().all()
    if not products:
        raise HTTPException(400, "Job has no extracted products to push")

    # Map each product row into the ontology record shape. If field_map is
    # empty we send a default set of columns mirroring the CSV.
    DEFAULT_FIELDS = ["page", "category", "name", "sku_internal", "sku_ref",
                      "specifications", "accessories", "variants", "image_url"]

    def _shape(p: PdfProductRow) -> dict:
        full = {
            "page": p.page,
            "category": p.category or "",
            "name": p.name or "",
            "sku_internal": p.sku_internal or "",
            "sku_ref": p.sku_ref or "",
            "specifications": p.specifications or {},
            "accessories": p.accessories or [],
            "variants": p.variants or [],
            "image_url": p.image_url or "",
        }
        if not body.field_map:
            return {k: full.get(k) for k in DEFAULT_FIELDS}
        return {dst: full.get(src) for src, dst in body.field_map.items() if src in full}

    records = []
    for p in products:
        # Use sku_ref or sku_internal as source_id when present so re-pushes
        # idempotently upsert the same product. Fall back to product UUID.
        source_id = p.sku_ref or p.sku_internal or p.id
        records.append({
            "source_id": source_id,
            "data": _shape(p),
        })

    url = f"{ONTOLOGY_SERVICE_URL}/ontology/aggregate/records/{body.object_type_id}"
    headers = {"X-Tenant-ID": tenant_id}
    if authorization:
        headers["Authorization"] = authorization

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(url, json={"records": records}, headers=headers)
            resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            502, f"Ontology push failed: {e.response.status_code} {e.response.text[:300]}"
        )
    except Exception as e:
        raise HTTPException(502, f"Ontology push failed: {e}")

    job.pushed_to_object_type_id = body.object_type_id
    job.pushed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(job)
    return _job_to_view(job)


# ── Background worker ─────────────────────────────────────────────────────

async def _run_job(
    job_id: str,
    tenant_id: str,
    storage_key: str,
    model: str,
    dpi: int,
    page_range: Optional[tuple],
    schema_prompt: Optional[str],
) -> None:
    """Pull the PDF from MinIO, run the extractor, persist rows + progress."""
    progress_buffer: list[dict] = []

    async def _flush_status(*, status: Optional[str] = None,
                            pages_done: Optional[int] = None,
                            products_found: Optional[int] = None,
                            total_pages: Optional[int] = None,
                            error: Optional[str] = None) -> None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(PdfJobRow).where(PdfJobRow.id == job_id))
            row = result.scalar_one_or_none()
            if not row:
                return
            if status is not None:
                row.status = status
            if pages_done is not None:
                row.pages_done = pages_done
            if products_found is not None:
                row.products_found = products_found
            if total_pages is not None:
                row.total_pages = total_pages
            if error is not None:
                row.error = error
            # progress_log is a JSON column; replace it with the buffer so far.
            row.progress_log = list(progress_buffer)
            await db.commit()

    def _on_progress(event: dict) -> None:
        # Runs on a worker thread (inside fitz/anthropic call) — keep cheap.
        progress_buffer.append(event)

    try:
        await _flush_status(status="running")

        pdf_bytes = await asyncio.to_thread(get_bytes, storage_key)

        def _do_extract() -> list[ExtractedProduct]:
            ext = PdfExtractor(
                tenant_id=tenant_id,
                job_id=job_id,
                pdf_bytes=pdf_bytes,
                api_key=ANTHROPIC_API_KEY,
                model=model,
                dpi=dpi,
                page_range=page_range,
                schema_prompt=schema_prompt,
                progress_cb=_on_progress,
            )
            try:
                return ext.extract()
            finally:
                ext.close()

        # Drive extraction on a worker thread, and concurrently flush progress
        # to the DB every ~1.5s so the UI sees live page counts instead of
        # nothing-then-everything at the end.
        extract_task = asyncio.create_task(asyncio.to_thread(_do_extract))

        async def _progress_pump() -> None:
            while not extract_task.done():
                await asyncio.sleep(1.5)
                total = next(
                    (e["total_pages"] for e in progress_buffer if e.get("event") == "started"),
                    None,
                )
                page_events = [e for e in progress_buffer if e.get("event") == "page"]
                products_so_far = sum(int(e.get("products") or 0) for e in page_events)
                await _flush_status(
                    pages_done=len(page_events),
                    products_found=products_so_far,
                    total_pages=total,
                )

        pump_task = asyncio.create_task(_progress_pump())
        try:
            products = await extract_task
        finally:
            pump_task.cancel()
            try:
                await pump_task
            except (asyncio.CancelledError, Exception):
                pass

        # Persist all products
        async with AsyncSessionLocal() as db:
            for p in products:
                db.add(PdfProductRow(
                    id=p.id,
                    job_id=job_id,
                    tenant_id=tenant_id,
                    page=p.page,
                    category=p.category or "",
                    name=p.name or "",
                    sku_internal=p.sku_internal or "",
                    sku_ref=p.sku_ref or "",
                    specifications=p.specifications or {},
                    accessories=p.accessories or [],
                    variants=p.variants or [],
                    bbox_norm=list(p.bbox_norm) if p.bbox_norm else None,
                    image_storage_key=p.image_storage_key,
                    image_url=p.image_url,
                ))
            await db.commit()

        # Compute pages_done / total_pages from progress buffer
        total = next((e["total_pages"] for e in progress_buffer
                      if e.get("event") == "started"), None)
        page_events = [e for e in progress_buffer if e.get("event") == "page"]
        await _flush_status(
            status="completed",
            pages_done=len(page_events),
            products_found=len(products),
            total_pages=total,
        )
        log.info("pdf_job_completed job=%s products=%d", job_id, len(products))

    except Exception as e:
        log.exception("pdf_job_failed job=%s", job_id)
        progress_buffer.append({"event": "failed", "error": str(e)})
        await _flush_status(status="failed", error=str(e))
