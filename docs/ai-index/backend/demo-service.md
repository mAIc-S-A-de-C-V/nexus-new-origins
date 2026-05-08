# demo-service (port 8024)

**Purpose:** Multi-dataset REST API for process mining demos. Generates 16 BPI Challenge / synthetic datasets in-memory. **BPIC2019 PO is the main demo (100K cases × ~5.89 events ≈ 589K events).**
**Stack:** Python FastAPI, pandas, faker.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/demo_service/`

## Files

```
demo_service/
├── main.py             FastAPI; mounts /datasets; root + /health
├── generators.py       Deterministic generators (CRITICAL — currently being modified)
├── routers/
│   └── datasets.py     DATASET_CATALOG + list/schema/records/cases/stats endpoints
├── auth_middleware.py  Stub (demo is open)
├── requirements.txt    fastapi, pandas, faker
└── Dockerfile          Python 3.11
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Catalog + industry categories. |
| GET | `/health` | Health. |
| GET | `/{dataset_id}` | Metadata + stats. |
| GET | `/{dataset_id}/schema` | Field names + types + samples. Used by connector schema discovery. |
| GET | `/{dataset_id}/records?limit=200&offset=0&filter_field=...&filter_value=...&filter_op=contains\|equals` | Paginated records. **What REST connectors hit.** |
| GET | `/{dataset_id}/cases?limit=...&offset=...` | Case-level aggregates. |
| GET | `/{dataset_id}/stats` | Total records, min/max, etc. |

CORS is open (`allow_origins=["*"]`) — fine for demo.

## Generators (`generators.py`)

| Function | Dataset ID | Cases | Events | Notes |
|----------|-----------|-------|--------|-------|
| `generate_bpic2012` | bpic2012 | 3K | ~13K | Loan app |
| `generate_bpic2017` | bpic2017 | 3K | ~1.2M | Loan app, larger |
| **`generate_bpic2019`** | bpic2019-purchase-orders | **100K** | **~589K** | **Main demo.** Memory: 1.5g |
| `generate_bpic2011` | bpic2011 | 1K | ~150K | Hospital |
| `generate_bpic2014_incidents` | bpic2014-incidents | 3K | ~466K | IT incidents |
| `generate_bpic2014_changes` | bpic2014-changes | 1.5K | (linked) | IT changes |
| `generate_traffic_fines` | traffic-fines | 150K | ~561K | Government |
| `generate_bpic2015` | bpic2015 | 800/muni | varied | Permits, 5 munis |
| `generate_sepsis` | sepsis | ~1K | ~15K | Healthcare |
| `generate_smart_factory_iot` | smart-factory | varied | varied | Manufacturing |
| `generate_bpic2020_*` | bpic2020-permits/-domestic/-international/-prepaid/-requests | varied | varied | Travel expenses, 5 cross-linked variants |
| (insurance) | insurance-policies, insurance-claims | varied | varied | Cross-linked by policy_id |

### Critical knobs in BPIC2019 (line ~190 in generators.py)

```python
n_cases = 100000          # 100K cases. Increase requires Docker memory bump.
                          # 200K → set mem_limit: 2g in compose, raise Docker Desktop to ≥8GB.
start = "2018-01-01"      # Frozen baseline (alert rules tuned to this).
```

Path/weights:
```python
BPIC2019_PATHS = [
  ["Create PO Item", "Record Goods Receipt", "Record Invoice Receipt", "Clear Invoice", "Record Payment"],  # happy
  ["Create PO Item", "Record Goods Receipt", "Set Payment Block", "Remove Payment Block", ...],             # blocked
  ["Create PO Item", "Delete PO Item"],                                                                       # cancelled
  ...
]
BPIC2019_PATH_WEIGHTS = [30, 15, 15, 15, 15, 10]
```

Categorical fields (vendors, companies, spend_areas, doc_types) defined just above paths.

## Demo replay flow

`scripts/replay-po-events.sh` reads from `/datasets/bpic2019-purchase-orders/records?filter_field=activity&filter_op=contains&filter_value=...` and POSTs to `connector-service /webhooks/receive/{slug}` with HMAC. See `docs/DEMO_BPIC2019_LIVE.md` for the live demo runbook.

## When to edit

| Intent | File |
|--------|------|
| Add a new dataset | `generators.py` (new generator function) + `routers/datasets.py:DATASET_CATALOG`. |
| Change BPIC 2019 volume | `generators.py:generate_bpic2019` `n_cases`. **Memory implications — bump compose `mem_limit`.** |
| Adjust BPIC 2019 variant frequencies | `BPIC2019_PATH_WEIGHTS`. |
| Add a categorical value | edit `VENDORS`, `COMPANIES`, `SPEND_AREAS`, `DOC_TYPES` lists. |
| Change pagination defaults | `routers/datasets.py:records()` (line 256). |
| Add a filter operator | `routers/datasets.py` filter_op handling. |
| Add new tenant auto-seed | `scripts/seed_demo_tenants.py:TENANTS` + `CASE_KEY_FIELD_BY_DATASET`. |
