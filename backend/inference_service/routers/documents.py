"""
Document extraction — Claude vision API for OCR + structured field extraction.

POST /infer/extract-from-document
  Body: { "document_id": "<uuid>", "schema": [{name, description?, type?}] }
  1. Fetches the file from ontology-service (/documents/{id}/file)
  2. Sends to Claude as an image (PDF / PNG / JPEG / WEBP all supported by
     Sonnet 4.6 vision)
  3. Asks Claude to extract the requested fields as JSON
  4. PATCHes the Document with `extracted_fields` + `extraction_status`
  5. Returns { ocr_text, extracted } to the caller

Falls back to a stub extraction (echoes the schema with empty values) if
ANTHROPIC_API_KEY isn't set, so the UI flow remains demoable in dev
without burning tokens.
"""
from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

import anthropic

router = APIRouter()
log = logging.getLogger("inference.documents")

ONTOLOGY_API = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
MODEL        = os.environ.get("VISION_MODEL", "claude-sonnet-4-6")
ANTHROPIC_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


class FieldSpec(BaseModel):
    name: str
    description: Optional[str] = None
    type: Optional[str] = "string"  # string | number | date | boolean


class ExtractRequest(BaseModel):
    document_id: str
    schema: list[FieldSpec]
    document_kind: Optional[str] = None  # e.g. "Invoice", "Receipt", "Bill"


def _build_extraction_prompt(req: ExtractRequest) -> str:
    schema_lines = []
    for f in req.schema:
        t = f.type or "string"
        d = f" — {f.description}" if f.description else ""
        schema_lines.append(f'  "{f.name}": {t}{d}')
    kind = req.document_kind or "document"
    return (
        f"You are extracting structured data from a {kind} image.\n\n"
        f"Required output: a JSON object with exactly these keys (and only these keys):\n"
        + "\n".join(schema_lines)
        + "\n\n"
        "Rules:\n"
        " - Numbers must be plain numeric (no currency symbols, no thousands separators).\n"
        " - Dates must be ISO 8601 (YYYY-MM-DD).\n"
        " - If a value is not present in the document, return an empty string for it.\n"
        " - Also return the full plain-text OCR transcript under the key `_ocr_text`.\n"
        "\n"
        "Return ONLY the JSON, no prose, no fenced code blocks."
    )


async def _fetch_document_bytes(document_id: str, tenant_id: str) -> tuple[bytes, str]:
    """Fetch the file bytes + content-type from the ontology service."""
    headers = {"x-tenant-id": tenant_id}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{ONTOLOGY_API}/documents/{document_id}/file", headers=headers)
        if r.status_code != 200:
            raise HTTPException(404, f"Could not fetch document file: HTTP {r.status_code}")
        return r.content, r.headers.get("content-type", "application/octet-stream")


async def _patch_document(document_id: str, tenant_id: str, patch: dict) -> None:
    headers = {"x-tenant-id": tenant_id, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            await client.patch(
                f"{ONTOLOGY_API}/documents/{document_id}/extracted-fields",
                json=patch, headers=headers,
            )
        except Exception as e:
            log.warning("document_patch_failed id=%s err=%s", document_id, e)


def _stub_extraction(req: ExtractRequest) -> dict:
    """When ANTHROPIC_KEY is unset, return a stub so the UI flow is demoable."""
    return {f.name: "" for f in req.schema}


def _vision_block_for(mime: str, raw: bytes) -> dict:
    """
    Build the Claude vision content block. Anthropic supports PDF + image
    media types as base64-encoded source.
    """
    if mime.startswith("application/pdf"):
        return {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": base64.standard_b64encode(raw).decode("ascii"),
            },
        }
    # Default to image — Claude accepts png, jpeg, webp, gif.
    media = mime if mime.startswith("image/") else "image/png"
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": media,
            "data": base64.standard_b64encode(raw).decode("ascii"),
        },
    }


@router.post("/extract-from-document")
async def extract_from_document(
    req: ExtractRequest,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"

    # Mark in-progress so the UI's poll loop can render a spinner.
    await _patch_document(req.document_id, tenant_id, {"extraction_status": "extracting"})

    try:
        raw, mime = await _fetch_document_bytes(req.document_id, tenant_id)
    except HTTPException:
        await _patch_document(req.document_id, tenant_id, {"extraction_status": "failed"})
        raise

    if not ANTHROPIC_KEY:
        # Dev fallback — return empty values so the UI flow remains testable.
        extracted = _stub_extraction(req)
        ocr_text = "(stub — ANTHROPIC_API_KEY not set)"
        await _patch_document(req.document_id, tenant_id, {
            "extracted_fields": json.dumps(extracted),
            "ocr_text": ocr_text,
            "extraction_status": "completed",
        })
        return {"ocr_text": ocr_text, "extracted": extracted, "model": "stub"}

    prompt = _build_extraction_prompt(req)
    vision_block = _vision_block_for(mime, raw)

    try:
        client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
        msg = client.messages.create(
            model=MODEL,
            max_tokens=2048,
            messages=[
                {
                    "role": "user",
                    "content": [vision_block, {"type": "text", "text": prompt}],
                }
            ],
        )
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    except Exception as e:
        log.exception("vision_call_failed id=%s err=%s", req.document_id, e)
        await _patch_document(req.document_id, tenant_id, {"extraction_status": "failed"})
        raise HTTPException(500, f"Vision call failed: {e}")

    # Claude is instructed to return raw JSON. Be forgiving about a stray
    # fenced block or prefix text.
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Drop the first line and the trailing fence.
        lines = cleaned.splitlines()
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()

    try:
        parsed: dict[str, Any] = json.loads(cleaned)
    except json.JSONDecodeError as e:
        log.warning("vision_json_parse_failed id=%s err=%s text_head=%s",
                    req.document_id, e, cleaned[:200])
        await _patch_document(req.document_id, tenant_id, {"extraction_status": "failed"})
        raise HTTPException(500, f"Could not parse vision output as JSON: {e}")

    ocr_text = str(parsed.pop("_ocr_text", "") or "")
    extracted = {f.name: parsed.get(f.name, "") for f in req.schema}

    await _patch_document(req.document_id, tenant_id, {
        "extracted_fields": json.dumps(extracted),
        "ocr_text": ocr_text,
        "extraction_status": "completed",
    })

    return {"ocr_text": ocr_text, "extracted": extracted, "model": MODEL}
