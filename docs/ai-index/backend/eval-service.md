# eval-service (port 8016)

**Purpose:** Evaluation framework for agents + logic functions. Test cases, evaluators, runs, experiment grids (param search).
**Stack:** Python FastAPI, SQLAlchemy async, anthropic, httpx.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/eval_service/`

## Files

```
eval_service/
├── main.py                FastAPI; 4 routers (suites, cases, runs, experiments)
├── database.py            ORM: EvalSuite, EvalTestCase, EvalRun, EvalExperiment
├── runner.py              run_suite(), _execute_target() (calls agent/logic), _run_single_case() (weighted aggregate)
├── evaluators/
│   ├── base.py            BaseEvaluator interface (evaluate(output, expected) -> {score, details})
│   ├── exact_match.py     String equality
│   ├── json_schema_match.py JSON schema validation
│   ├── rouge_score.py     ROUGE-L, ROUGE-1, ROUGE-2 text similarity
│   ├── contains_key_details.py Substring/key phrase detection
│   └── custom_expression.py Arbitrary Python expression
├── requirements.txt
└── Dockerfile
```

## Tables

| Table | Purpose |
|-------|---------|
| `eval_suites` | tenant_id, name, target_type (agent/logic_function/logic_flow), target_id, target_name, evaluator_configs (with weights), pass_threshold |
| `eval_test_cases` | suite_id, name, inputs JSON, expected_outputs (key_details/schema/exact), tags |
| `eval_runs` | suite_id, status (running/complete/failed), config_overrides, results (per-case), summary (pass_rate, avg_score), error |
| `eval_experiments` | suite_id, name, param_grid (model[]/temperature[]/...), run_ids[], best_run_id, status |

## Endpoints

### `/suites`

GET/POST `/suites`, GET/PUT/DELETE `/suites/{id}`, GET/POST `/suites/{id}/cases`, POST `/suites/{id}/run`, GET `/suites/{id}/runs`.

### `/cases` (under wildcard prefix)

GET/PUT/DELETE `/cases/{id}`.

### `/runs`

GET `/runs/{id}` — poll status + per-case results.

### `/experiments`

GET/POST `/experiments` — parameter-grid search across model/prompt/temperature combos.

## Evaluator registry

```python
EVALUATOR_REGISTRY = {
  "exact_match": ExactMatchEvaluator,
  "json_schema_match": JsonSchemaEvaluator,
  "rouge_score": RougeEvaluator,
  "contains_key_details": ContainsKeyDetailsEvaluator,
  "custom_expression": CustomExpressionEvaluator,
}
```

Per-case score = weighted average of evaluator scores (weights from `evaluator_configs`).

## Cross-service

- POST `agent-service /agents/{id}/test` for agent target.
- POST `logic-service /logic/functions/{id}/run` for logic target.

## Env

`DATABASE_URL`, `ANTHROPIC_API_KEY`, `ADMIN_SERVICE_URL`, `AGENT_SERVICE_URL`, `LOGIC_SERVICE_URL`, `ALLOWED_ORIGINS`, `SKIP_AUTH`.

## When to edit

| Intent | File |
|--------|------|
| Add new evaluator | new `evaluators/<name>.py` extending `BaseEvaluator` + register in `runner.py:EVALUATOR_REGISTRY`. |
| Change scoring aggregation | `runner.py:_run_single_case()` weighted formula. |
| Support new target type | `runner.py:_execute_target()` dispatcher + `routers/suites.py:VALID_TARGET_TYPES`. |
| Extend experiment grid | `routers/experiments.py` param schema + runner. |
