"""
EvalRunner — orchestrates test suite execution.

For each test case:
  1. Calls the target (agent-service or logic-service) with the case inputs
  2. Runs all configured evaluators on the output
  3. Computes weighted aggregate score → pass/fail
  4. Stores full results in eval_runs table
"""
import os
import json
import asyncio
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from database import EvalSuiteRow, EvalTestCaseRow, EvalRunRow, EvalExperimentRow

AGENT_SERVICE_URL = os.environ.get("AGENT_SERVICE_URL", "http://agent-service:8013")
LOGIC_SERVICE_URL = os.environ.get("LOGIC_SERVICE_URL", "http://logic-service:8012")

EVALUATOR_REGISTRY = {
    "exact_match":         "evaluators.exact_match",
    "json_schema_match":   "evaluators.json_schema_match",
    "rouge_score":         "evaluators.rouge_score",
    "contains_key_details": "evaluators.contains_key_details",
    "custom_expression":   "evaluators.custom_expression",
}


def _load_evaluator(eval_type: str):
    import importlib
    module_path = EVALUATOR_REGISTRY.get(eval_type)
    if not module_path:
        raise ValueError(f"Unknown evaluator type: {eval_type}")
    return importlib.import_module(module_path)


async def _execute_target(
    target_type: str,
    target_id: str,
    inputs: dict,
    config_overrides: dict,
    tenant_id: str,
) -> Any:
    """Call the appropriate service and return the raw output."""
    headers = {"x-tenant-id": tenant_id, "Content-Type": "application/json"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        if target_type == "agent":
            # POST /agents/{id}/test  — run agent with a message input
            message = inputs.get("message") or inputs.get("prompt") or json.dumps(inputs)
            payload = {"message": message}
            if "model" in config_overrides:
                payload["model_override"] = config_overrides["model"]
            resp = await client.post(
                f"{AGENT_SERVICE_URL}/agents/{target_id}/test",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            # agent-service returns { final_text, iterations, trace }
            return data.get("final_text") or data.get("response") or data.get("output") or data

        elif target_type in ("logic_function", "logic_flow"):
            # POST /logic/functions/{id}/run
            payload = {"inputs": inputs}
            if "model" in config_overrides:
                payload["model_override"] = config_overrides["model"]
            resp = await client.post(
                f"{LOGIC_SERVICE_URL}/logic/functions/{target_id}/run",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("output") or data

        else:
            raise ValueError(f"Unknown target_type: {target_type}")


async def run_suite(
    suite_id: str,
    config_overrides: dict,
    tenant_id: str,
    run_id: str,
    db: AsyncSession,
) -> None:
    """
    Execute all test cases for a suite. Updates the EvalRunRow in-place.
    Runs in the background — caller already created the run row with status='running'.
    """
    try:
        # Load suite
        suite_result = await db.execute(
            select(EvalSuiteRow).where(
                EvalSuiteRow.id == suite_id,
                EvalSuiteRow.tenant_id == tenant_id,
            )
        )
        suite = suite_result.scalar_one_or_none()
        if not suite:
            await _fail_run(db, run_id, "Suite not found")
            return

        # Load test cases
        cases_result = await db.execute(
            select(EvalTestCaseRow).where(
                EvalTestCaseRow.suite_id == suite_id,
                EvalTestCaseRow.tenant_id == tenant_id,
            )
        )
        cases = cases_result.scalars().all()

        if not cases:
            await _fail_run(db, run_id, "No test cases found")
            return

        evaluator_configs: list[dict] = suite.evaluator_configs or []
        pass_threshold: float = suite.pass_threshold or 0.7

        results = []
        for case in cases:
            case_result = await _run_single_case(
                suite=suite,
                case=case,
                evaluator_configs=evaluator_configs,
                config_overrides=config_overrides,
                pass_threshold=pass_threshold,
                tenant_id=tenant_id,
            )
            results.append(case_result)

        # Compute summary
        passed_count = sum(1 for r in results if r["passed"])
        total = len(results)
        avg_score = sum(r["score"] for r in results) / total if total else 0.0

        summary = {
            "pass_rate": round(passed_count / total, 4) if total else 0.0,
            "avg_score": round(avg_score, 4),
            "passed": passed_count,
            "failed": total - passed_count,
            "total": total,
        }

        # Update run row
        run_result = await db.execute(select(EvalRunRow).where(EvalRunRow.id == run_id))
        run = run_result.scalar_one_or_none()
        if run:
            run.status = "complete"
            run.results = results
            run.summary = summary
            run.completed_at = datetime.now(timezone.utc)
            await db.commit()

    except Exception as e:
        await _fail_run(db, run_id, str(e))


async def _run_single_case(
    suite: EvalSuiteRow,
    case: EvalTestCaseRow,
    evaluator_configs: list[dict],
    config_overrides: dict,
    pass_threshold: float,
    tenant_id: str,
) -> dict:
    """Execute one test case and return the result dict."""
    output = None
    execution_error = None

    try:
        output = await _execute_target(
            target_type=suite.target_type,
            target_id=suite.target_id,
            inputs=case.inputs or {},
            config_overrides=config_overrides,
            tenant_id=tenant_id,
        )
    except Exception as e:
        execution_error = str(e)
        output = None

    # If target execution failed, short-circuit — no output to evaluate
    if execution_error:
        return {
            "case_id": case.id,
            "case_name": case.name,
            "passed": False,
            "score": 0.0,
            "output": None,
            "execution_error": execution_error,
            "evaluator_details": [],
        }

    evaluator_details = []
    weighted_scores = []

    for eval_cfg in evaluator_configs:
        eval_type = eval_cfg.get("type", "exact_match")
        weight = float(eval_cfg.get("weight", 1.0))
        cfg = eval_cfg.get("config", {})

        try:
            module = _load_evaluator(eval_type)
            eval_result = await module.evaluate(output, case.expected_outputs or {}, cfg)
            weighted_scores.append(eval_result.score * weight)
            evaluator_details.append({
                "type": eval_type,
                "score": eval_result.score,
                "passed": eval_result.passed,
                "weight": weight,
                "details": eval_result.details,
            })
        except Exception as e:
            evaluator_details.append({
                "type": eval_type,
                "score": 0.0,
                "passed": False,
                "weight": weight,
                "details": {"error": str(e)},
            })
            weighted_scores.append(0.0)

    total_weight = sum(float(c.get("weight", 1.0)) for c in evaluator_configs)
    overall_score = (
        sum(s for s in weighted_scores) / total_weight
        if total_weight > 0 and weighted_scores
        else 0.0
    )

    # Truncate output for storage (keep first 2000 chars if string)
    output_stored = output
    if isinstance(output_stored, str) and len(output_stored) > 2000:
        output_stored = output_stored[:2000] + "…[truncated]"

    return {
        "case_id": case.id,
        "case_name": case.name,
        "passed": overall_score >= pass_threshold,
        "score": round(overall_score, 4),
        "output": output_stored,
        "execution_error": execution_error,
        "evaluator_details": evaluator_details,
    }


async def _fail_run(db: AsyncSession, run_id: str, error: str) -> None:
    run_result = await db.execute(select(EvalRunRow).where(EvalRunRow.id == run_id))
    run = run_result.scalar_one_or_none()
    if run:
        run.status = "failed"
        run.error = error
        run.completed_at = datetime.now(timezone.utc)
        await db.commit()


async def run_experiment(
    experiment_id: str,
    tenant_id: str,
    db: AsyncSession,
) -> None:
    """Execute all parameter combinations for an experiment."""
    from itertools import product
    from uuid import uuid4

    exp_result = await db.execute(
        select(EvalExperimentRow).where(
            EvalExperimentRow.id == experiment_id,
            EvalExperimentRow.tenant_id == tenant_id,
        )
    )
    exp = exp_result.scalar_one_or_none()
    if not exp:
        return

    try:
        param_grid: dict = exp.param_grid or {}
        keys = list(param_grid.keys())
        values = [param_grid[k] if isinstance(param_grid[k], list) else [param_grid[k]] for k in keys]
        combinations = list(product(*values))

        run_ids = []
        best_run_id = None
        best_pass_rate = -1.0

        for combo in combinations:
            overrides = dict(zip(keys, combo))
            new_run_id = str(uuid4())

            # Create run row
            new_run = EvalRunRow(
                id=new_run_id,
                suite_id=exp.suite_id,
                tenant_id=tenant_id,
                status="running",
                config_overrides=overrides,
                results=[],
            )
            db.add(new_run)
            await db.commit()

            # Execute suite
            async with db.__class__(db.bind) if hasattr(db, 'bind') else db:
                await run_suite(exp.suite_id, overrides, tenant_id, new_run_id, db)

            # Check if this is the best run so far
            run_result = await db.execute(select(EvalRunRow).where(EvalRunRow.id == new_run_id))
            run = run_result.scalar_one_or_none()
            if run and run.summary:
                rate = run.summary.get("pass_rate", 0.0)
                if rate > best_pass_rate:
                    best_pass_rate = rate
                    best_run_id = new_run_id

            run_ids.append(new_run_id)

        exp.run_ids = run_ids
        exp.best_run_id = best_run_id
        exp.status = "complete"
        exp.completed_at = datetime.now(timezone.utc)
        await db.commit()

    except Exception as e:
        exp.status = "failed"
        await db.commit()
