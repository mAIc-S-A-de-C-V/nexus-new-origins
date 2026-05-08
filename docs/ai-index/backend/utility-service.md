# utility-service (port 8014)

**Purpose:** Pre-built reusable utilities callable by agents and logic functions. HTTP, OCR, PDF, Excel, scrape, RSS, geocode, QR, Slack, webhook.
**Stack:** Python FastAPI. Per-utility deps: pdfplumber, pytesseract, openpyxl, beautifulsoup4, feedparser, pyzbar, httpx.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/utility_service/`

## Files

```
utility_service/
├── main.py                FastAPI: GET /utilities, GET /utilities/{id}, POST /utilities/{id}/run
├── registry.py            UTILITY_REGISTRY dict (id, name, category, description, icon, color, input_schema, output_schema)
├── auth_middleware.py     Local copy
├── executors/
│   ├── http_request.py    GET/POST/PUT/DELETE with headers, body, timeout
│   ├── webhook_post.py    JSON to Slack/Zapier/Make
│   ├── pdf_extract.py     pdfplumber text by page range
│   ├── ocr_extract.py     pytesseract image → text
│   ├── excel_parse.py     openpyxl/CSV → rows
│   ├── web_scrape.py      httpx + BeautifulSoup → text/links
│   ├── rss_fetch.py       feedparser RSS/Atom → items
│   ├── geocode.py         OSM Nominatim address → lat/lng (free)
│   ├── qr_read.py         pyzbar QR/barcode decode
│   └── slack_notify.py    Slack incoming webhook
├── requirements.txt
└── Dockerfile
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/utilities` | All utilities (auth). |
| GET | `/utilities/{utility_id}` | Metadata (input/output schema, icon, color, category). |
| POST | `/utilities/{utility_id}/run` | `{inputs: {...}}` → `{utility_id, result}`. Errors caught and returned as `{error: "msg"}`. |

## Registry shape

```python
{
  "id": "pdf_extract",
  "name": "PDF Extract",
  "category": "Document",
  "description": "Extract text from PDF by page range",
  "icon": "FileText",
  "color": "#7C3AED",
  "input_schema": [
    {"name": "pdf_url", "type": "string", "required": True},
    {"name": "pages", "type": "string", "required": False, "description": "e.g. '1-5'"},
  ],
  "output_schema": [...],
}
```

## When to edit

| Intent | File |
|--------|------|
| Add a new utility | `registry.py` (entry) + `executors/<name>.py` with `async def run(inputs) -> dict` + import in `main.py` dispatch table. |
| Add OAuth/Digest to http_request | `executors/http_request.py`. |
| Add table extraction to PDF | `executors/pdf_extract.py` (pdfplumber `extract_tables()`). |
| Cache results | `main.py` wrap executor in `shared/query_cache.get_or_compute()`. |
| Streaming output | yield from executor instead of return; change `main.py` to StreamingResponse. |
| Rate limiting | slowapi Limiter in `main.py`. |
