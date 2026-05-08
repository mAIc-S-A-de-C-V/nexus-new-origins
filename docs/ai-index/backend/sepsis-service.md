# sepsis-service (port 8023)

**Purpose:** Real hospital sepsis dataset (XES, ~1,050 cases, ~15K events) from 4TU.nl. Read-only demo data for healthcare/process mining showcases.
**Stack:** Python FastAPI, aiofiles, XML parsing.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/sepsis_service/`

## Files

```
sepsis_service/
├── main.py            FastAPI lifespan loader; CRUD endpoints
├── loader.py          Download XES → parse → in-memory DATA_STORE indices
├── requirements.txt   fastapi, aiofiles
└── Dockerfile         Python 3.11
```

## Data source

- URL: `https://data.4tu.nl/ndownloader/items/33632f3c-5c48-40cf-8d8f-2db57f5a6ce7/versions/1`
- Cache: `/app/data/sepsis.xes` (volume `sepsis-data` in compose).
- Parsed at startup (lifespan), indexed in `DATA_STORE` global dict.

## In-memory indices

```
DATA_STORE = {
  "cases": dict[case_id → case meta],
  "events": list[event dicts],
  "events_by_case": dict[case_id → list[events]],
  "act_counts", "org_counts", "durations", "ages",
  "icu_count", "gender_dist", "outcome_dist",
}
```

**Case schema (16 fields):** case_id, age, gender, diagnosis, infection_suspected, hypotension, hypoxia, oliguria, sirs_2_or_more, start_time, end_time, duration_hours, outcome, has_icu_admission, has_ward_admission, num_events.

**Event schema (14 fields):** event_id, case_id, activity, timestamp, org_group, lifecycle, diagnostic_blood, diagnostic_ecg, sirs_heart_rate, sirs_leucos, sirs_temperature, infection_suspected, hypotension, hypoxia.

## Endpoints

### Meta

| Path | Purpose |
|------|---------|
| GET `/health` | `{status, cases, events, service}`. |
| GET `/info` | Schema + endpoint docs. |
| GET `/benchmark` | Ground-truth Q&A pairs for LLM evals. |

### Cases

| Path | Query params | Purpose |
|------|--------------|---------|
| GET `/cases` | limit, offset, outcome, gender, has_icu, min_age, max_age, min_duration, max_duration, sort_by, sort_dir | Filtered case list. |
| GET `/cases/{case_id}` | — | Single case. |
| GET `/cases/{case_id}/trace` | — | Event sequence. |

### Events

| Path | Query params | Purpose |
|------|--------------|---------|
| GET `/events` | limit, offset, activity, org_group, case_id, from_date, to_date | Filtered events. |
| GET `/events/activities` | — | All 16 activities + counts. |
| GET `/events/resources` | — | Hospital units + counts. |

### Analytics

| Path | Query params | Purpose |
|------|--------------|---------|
| GET `/stats` | — | Aggregate: totals, ICU rate, duration/age stats, distributions. |
| GET `/timeline` | bucket (hour/day/week), activity? | Bucketed counts. |
| GET `/flow` | — | Activity → activity transition matrix. |

### Streaming

| Path | Purpose |
|------|---------|
| WS `/ws/stream` | ~5 events/sec replay (loops when exhausted). |

## When to edit

| Intent | File |
|--------|------|
| Change data source | `loader.py:XES_URL` / `CACHE_PATH`. |
| Add filter param | `main.py` query handler. |
| Add stat | `main.py:/stats` aggregator. |
| Add benchmark Q&A | `loader.py:BENCHMARK_QA` (line 192). |
| Cache headers | add `Cache-Control: public, max-age=3600` to immutable endpoints. |
| Adapt parser if XES schema drifts | `loader.py` XES extraction (lines 71–150). |
