# data-quality-service (port 8019)

**Purpose:** Property-level profiling on `object_records` JSONB. Null rate, distinctness, top values, weighted quality score.
**Stack:** Python FastAPI, asyncpg (raw SQL).
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/data_quality_service/`

## Files

```
data_quality_service/
├── main.py            FastAPI; lifespan get_pool/close_pool
├── database.py        asyncpg pool
├── routers/
│   └── quality.py     GET /quality/summary, GET /quality/{ot_id}, POST /quality/{ot_id}/run
├── profiler.py        profile_object_type(), profile_all_types(), _quality_score()
├── requirements.txt
└── Dockerfile
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/quality/summary` | All OTs with score + computed_at. |
| GET | `/quality/{ot_id}` | Property breakdown: total, null_count, null_rate, distinct_count, unique_rate, top_values (top 5). |
| POST | `/quality/{ot_id}/run` | Explicit re-profile (202). |

## Quality score

```
completeness = 1 - null_rate
uniqueness   = min(unique_rate, 1.0)
score = avg(0.7 × completeness + 0.3 × uniqueness) × 100   # 0–100
```

Score 100 returned when total_records = 0.

## SQL pattern

Reads `object_records.data` JSONB directly (no ORM):

```sql
-- Null count
SELECT COUNT(*) FROM object_records
WHERE object_type_id=$1 AND tenant_id=$2
  AND (data->'<prop>' IS NULL OR data->>'<prop>' = '' OR data->>'<prop>' = 'null');

-- Top 5 values
SELECT data->>'<prop>' AS val, COUNT(*) AS cnt FROM object_records
WHERE object_type_id=$1 AND tenant_id=$2
  AND data->>'<prop>' IS NOT NULL AND data->>'<prop>' != '' AND data->>'<prop>' != 'null'
GROUP BY val ORDER BY cnt DESC LIMIT 5;
```

Property names come from `object_types.data->'properties'`.

## Env

`DATABASE_URL`, `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Tune score weights | `profiler.py:_quality_score()` (currently 0.7/0.3). |
| Add a metric (pattern adherence, outliers) | `profiler.py:profile_object_type()` SQL + result dict. |
| PII pattern detection | new helper using regex; integrate with `inference-service` PII scan. |
| Add anomaly detection | `routers/quality.py:GET /quality/{ot}/anomalies`. |
| Persist historical profiles | new `dq_profile_history` table + insert in `profile_object_type`. |
| Quality rules + alerts | new `quality_rules` table + integrate with `alert-engine`. |
