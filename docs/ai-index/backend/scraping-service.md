# scraping-service (port 8027)

**Purpose:** Web search (DuckDuckGo) + URL scraping. Wraps Scrapling so agent tools (`web_search`, `scrape_url`) can pull web content without each consumer needing lxml + browser deps. **Internal only** — not exposed externally; bound to docker network.
**Stack:** Python FastAPI, scrapling, beautifulsoup4, lxml, httpx.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/scraping_service/`

## Files

```
scraping_service/
├── main.py             FastAPI; POST /search, POST /scrape, GET /health
├── scrapers.py         search_duckduckgo(), scrape_url() with Scrapling AsyncFetcher / StealthyFetcher
├── requirements.txt    fastapi, scrapling[fetchers], lxml, beautifulsoup4, httpx
└── Dockerfile
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health. |
| POST | `/search` | Body `{query, max_results}`. DDG HTML scrape (no API key). |
| POST | `/scrape` | Body `{url, selector?, extract_text=true, extract_links=true, use_stealth=false, timeout=20, text_max_chars=8000}`. |

## Implementation notes

- `search_duckduckgo()` parses DDG HTML endpoint, unwraps DDG redirect URLs.
- `scrape_url()` defaults to `AsyncFetcher`. With `use_stealth=true`, switches to `StealthyFetcher` (Camoufox-backed; adds latency).
- CSS selector returns matched text array.
- Link extraction caps at 100 anchors.
- Text extraction caps at `text_max_chars` (default 8000).

## Used by

- agent-service tools `web_search` and `scrape_url` — `SCRAPING_SERVICE_URL=http://scraping-service:8027`.

## Env

(none required; standalone)

## When to edit

| Intent | File |
|--------|------|
| Add Bing/Brave search | new `search_<provider>()` in `scrapers.py` + new endpoint. |
| Adapt to DDG HTML changes | `scrapers.py:search_duckduckgo` selectors (`.result`, `.result__a`, `.result__snippet`). |
| Add scrape options | extend `ScrapeReq` model in `main.py` + pass through. |
| Auto-stealth detection | `scrapers.py:scrape_url` heuristic on response (e.g. CAPTCHA → retry stealth). |
| Caching | wrap `scrape_url` in `shared/query_cache.get_or_compute`. |
