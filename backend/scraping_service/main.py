"""
Scraping microservice — wraps Scrapling behind a tiny HTTP API so any
internal service (agent_service primarily) can do search + scrape without
pulling Scrapling and its native deps into every container.

Endpoints:
  GET  /health
  POST /search   { query, max_results }                          → DDG search results
  POST /scrape   { url, selector?, use_stealth?, ... }           → page content

Internal-only — bound on the docker network, no auth. If we ever expose
this externally, gate with x-internal as we do for the connector-service
internal endpoints.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from scrapers import scrape_url, search_duckduckgo

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("scraping-service")

app = FastAPI(title="Nexus Scraping Service", version="0.1.0")


class SearchReq(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    max_results: int = Field(10, ge=1, le=30)


class ScrapeReq(BaseModel):
    url: str = Field(..., min_length=8, max_length=2000)
    selector: str | None = Field(None, description="Optional CSS selector to extract specific elements")
    extract_text: bool = True
    extract_links: bool = False
    use_stealth: bool = False
    timeout: int = Field(20, ge=5, le=60)
    text_max_chars: int = Field(8000, ge=500, le=32000)


@app.get("/health")
async def health():
    return {"ok": True, "service": "scraping"}


@app.post("/search")
async def search(req: SearchReq):
    try:
        return await search_duckduckgo(req.query, req.max_results)
    except Exception as exc:
        logger.exception("search failed")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/scrape")
async def scrape(req: ScrapeReq):
    try:
        return await scrape_url(
            req.url,
            selector=req.selector,
            extract_text=req.extract_text,
            extract_links=req.extract_links,
            use_stealth=req.use_stealth,
            timeout=req.timeout,
            text_max_chars=req.text_max_chars,
        )
    except Exception as exc:
        logger.exception("scrape failed")
        raise HTTPException(status_code=500, detail=str(exc))
