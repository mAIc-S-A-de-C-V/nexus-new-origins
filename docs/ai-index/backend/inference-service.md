# inference-service (port 8003)

**Purpose:** Claude API proxy + AI inference utilities. Schema inference, similarity scoring, conflict resolution, app/widget generation, PII scanning, document vision OCR.
**Stack:** Python FastAPI, anthropic.AsyncAnthropic, httpx. **No database** (stateless).
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/inference_service/`

## Files

```
inference_service/
├── main.py                FastAPI app, 3 routers under /infer
├── claude_client.py       ClaudeInferenceClient — schema_infer, similarity, conflicts, suggest_object, app/widget gen
├── prompts.py             Prompt templates for every inference task
├── routers/
│   ├── inference.py       /infer/schema, /similarity, /conflicts, /suggest-object, /generate-app, /generate-widget
│   ├── scanner.py         /infer/scan-pii, /scan-all, /scan-results/{id}
│   └── documents.py       /infer/extract-from-document (vision)
├── requirements.txt       anthropic, httpx, fastapi, pydantic
└── Dockerfile
```

## Endpoints (all under `/infer`)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/infer/schema` | AI schema inference: field types, semantic types, PII levels, canonical names. Body: `SchemaInferRequest{connector_id, raw_schema, sample_rows}`. |
| POST | `/infer/similarity` | Score schema A against an existing ObjectType. |
| POST | `/infer/conflicts` | Detect + suggest resolutions for ObjectType field conflicts. |
| POST | `/infer/suggest-object` | Generate ObjectType definition for a new schema. |
| POST | `/infer/generate-app` | NL → dashboard layout from sample data. |
| POST | `/infer/generate-widget` | NL → single widget config (or custom JS code if `force_code=True`). |
| POST | `/infer/scan-pii` | Detect PII in a single object type's records (regex pre-filter + Claude verify). |
| POST | `/infer/scan-all` | Async PII scan across all object types; returns scan id to poll. |
| GET | `/infer/scan-results/{id}` | Poll async PII scan results. |
| POST | `/infer/extract-from-document` | Vision-based OCR + structured field extraction. Uses claude-sonnet-4-6. |

## Models

- **Default model:** `claude-haiku-4-5-20251001` for cheap inference.
- **Complex tasks** (app/widget gen): `claude-sonnet-4-6`.
- **Vision (OCR):** always `claude-sonnet-4-6`.

Provider routing goes through `shared/llm_router.py` — tenant-configured providers in `model_providers` table override env defaults.

## PII detection (`routers/scanner.py`)

Regex `PATTERNS` dict for: EMAIL, PHONE, SSN, CREDIT_CARD, DOB, IP_ADDRESS, PASSPORT, IBAN. Field-name hints in `PII_FIELD_HINTS`. Claude verification step (`_claude_verify_pii`) reduces false positives.

## Cross-service calls

| → | URL | Why |
|---|-----|-----|
| ontology-service | `/object-types/{id}/records` | Fetch records to scan for PII. |
| logic-service | `/logic/functions` | Resolve function names referenced in app generation. |
| pipeline-service, analytics-service, connector-service | (env vars present, optional) | Context for app generation. |
| admin-service | (via `shared/token_tracker`) | Token usage reporting. |

## Env

`ANTHROPIC_API_KEY`, `ADMIN_SERVICE_URL`, `ONTOLOGY_SERVICE_URL`, `PIPELINE_SERVICE_URL`, `LOGIC_SERVICE_URL`, `ANALYTICS_SERVICE_URL`, `CONNECTOR_SERVICE_URL`, `VISION_MODEL` (default `claude-sonnet-4-6`), `ALLOWED_ORIGINS`.

## When to edit

| Intent | File |
|--------|------|
| Tweak a Claude prompt | `prompts.py`. |
| Add a new inference capability | new method on `ClaudeInferenceClient` + new prompt template + new router endpoint. |
| Add new PII regex pattern | `routers/scanner.py:PATTERNS` dict + `PII_FIELD_HINTS`. |
| Change Claude verification | `routers/scanner.py:_claude_verify_pii()`. |
| Extend vision extraction (new doc kind) | `routers/documents.py` + extend `ExtractRequest.document_kind` enum + Claude prompt for new kind. |
| Add custom widget generator | `claude_client.py:generate_*_widget()` + `routers/inference.py`. |
| Token tracking missing | confirm `track_token_usage()` called after every Anthropic call. |
