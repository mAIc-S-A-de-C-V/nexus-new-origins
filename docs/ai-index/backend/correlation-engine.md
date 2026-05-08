# correlation-engine (port 8008)

**Purpose:** Stateless similarity scorer. Compares an incoming `InferenceResult` to existing `ObjectType`s and recommends `enrich`/`link`/`new_type`. Used by ontology mapping flow.
**Stack:** Python FastAPI. No DB.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/correlation_engine/`

## Files

```
correlation_engine/
├── main.py             FastAPI: 2 POST endpoints + _suggest_join_and_pipeline helper
├── scorer.py           CorrelationScorer class + composite scoring algorithm
├── requirements.txt
└── Dockerfile
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/score` | Score one schema vs one ObjectType. Body `{schema_a: InferenceResult, object_type: ObjectType}`. |
| POST | `/score-all` | Score against all ObjectTypes; returns ranked matches + `top_action`. |

## Algorithm (`scorer.py`)

Weights:
- `FIELD_NAME_WEIGHT = 0.40`
- `SEMANTIC_TYPE_WEIGHT = 0.30`
- `SAMPLE_VALUE_WEIGHT = 0.15`
- `PRIMARY_KEY_WEIGHT = 0.15`

Sub-scores:
1. **Field name overlap** — fuzzy match (`difflib.SequenceMatcher`, 0.70 threshold). % of fields matched.
2. **Semantic type overlap** — for matched pairs, % with same SemanticType.
3. **Sample value overlap** — Jaccard similarity on categorical samples.
4. **Primary key resolvability** — bool: can we join via IDENTIFIER or EMAIL?

Composite = weighted sum.

Action thresholds in `main.py`:
- score ≥ 0.55 → `enrich`
- 0.15 ≤ score < 0.55 → `link`
- score < 0.15 → `new_type`

`_suggest_join_and_pipeline()` heuristics: EMAIL → EMAIL, IDENTIFIER → IDENTIFIER, person name extraction from TEXT.

## When to edit

| Intent | File |
|--------|------|
| Tune action thresholds | `main.py` constants 0.55, 0.15. |
| Tune scoring weights | `scorer.py:CorrelationScorer` constants. |
| Change fuzzy match threshold | `scorer.py:_compute_field_name_overlap` (0.70). |
| Add new similarity dimension | new `_compute_*()` method on `CorrelationScorer` + include in composite. |
| Add new join heuristic | `main.py:_suggest_join_and_pipeline()`. |
