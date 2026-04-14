"""
Utility Service — port 8014
===========================
Library of pre-built, composable utilities for the Nexus platform.
Any service (Logic Studio, Agent Studio, Apps) can call these utilities.
"""
import os
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Any
from auth_middleware import require_auth

from registry import UTILITY_REGISTRY
from executors import (
    http_request,
    webhook_post,
    ocr_extract,
    pdf_extract,
    excel_parse,
    web_scrape,
    rss_fetch,
    geocode,
    qr_read,
    slack_notify,
)

app = FastAPI(title="Nexus Utility Service", version="1.0.0")

# CORS
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173")
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

EXECUTORS = {
    "http_request":  http_request,
    "webhook_post":  webhook_post,
    "ocr_extract":   ocr_extract,
    "pdf_extract":   pdf_extract,
    "excel_parse":   excel_parse,
    "web_scrape":    web_scrape,
    "rss_fetch":     rss_fetch,
    "geocode":       geocode,
    "qr_read":       qr_read,
    "slack_notify":  slack_notify,
}


class RunRequest(BaseModel):
    inputs: dict[str, Any] = {}


@app.get("/utilities")
async def list_utilities(_user=Depends(require_auth)):
    """Return all available utilities with their metadata."""
    return list(UTILITY_REGISTRY.values())


@app.get("/utilities/{utility_id}")
async def get_utility(utility_id: str):
    """Return metadata for a single utility."""
    util = UTILITY_REGISTRY.get(utility_id)
    if not util:
        raise HTTPException(status_code=404, detail=f"Utility '{utility_id}' not found")
    return util


@app.post("/utilities/{utility_id}/run")
async def run_utility(utility_id: str, body: RunRequest, _user=Depends(require_auth)):
    """Execute a utility with the provided inputs."""
    util = UTILITY_REGISTRY.get(utility_id)
    if not util:
        raise HTTPException(status_code=404, detail=f"Utility '{utility_id}' not found")

    executor = EXECUTORS.get(utility_id)
    if not executor:
        raise HTTPException(status_code=501, detail=f"Executor for '{utility_id}' not implemented")

    try:
        result = await executor.run(body.inputs)
        return {"utility_id": utility_id, "result": result}
    except Exception as e:
        return {"utility_id": utility_id, "result": {"error": str(e)}}


@app.get("/health")
async def health():
    return {"status": "ok", "service": "utility-service"}


from fastapi import Request as _Req


@app.middleware("http")
async def _security_headers(request: _Req, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response
