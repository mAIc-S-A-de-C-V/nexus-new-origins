"""
Incremental EWMA / Holt-Winters baseline state for streaming_anomaly rules.
Backed by alert_rule_streaming_state — one row per rule. Returns the current
mean/var and z-score for a new observation, persisting state for next tick.
"""
import json
import math

from sqlalchemy import text
from database import PgSession


async def _load_state(rule_id: str) -> dict:
    async with PgSession() as pg:
        row = await pg.execute(text(
            "SELECT ewma_mean, ewma_var, observation_count, model_state "
            "FROM alert_rule_streaming_state WHERE rule_id = :r"
        ), {"r": rule_id})
        r = row.fetchone()
        if not r:
            return {"mean": None, "var": None, "n": 0, "model": None}
        m = r._mapping
        return {
            "mean": m["ewma_mean"],
            "var": m["ewma_var"],
            "n": int(m["observation_count"] or 0),
            "model": m["model_state"],
        }


async def _save_state(rule_id: str, mean: float, var: float, n: int, model: dict | None) -> None:
    async with PgSession() as pg:
        await pg.execute(text(
            "INSERT INTO alert_rule_streaming_state "
            "(rule_id, ewma_mean, ewma_var, observation_count, model_state, last_update_at) "
            "VALUES (:r, :m, :v, :n, CAST(:s AS jsonb), NOW()) "
            "ON CONFLICT (rule_id) DO UPDATE SET "
            "  ewma_mean = EXCLUDED.ewma_mean, "
            "  ewma_var = EXCLUDED.ewma_var, "
            "  observation_count = EXCLUDED.observation_count, "
            "  model_state = EXCLUDED.model_state, "
            "  last_update_at = NOW()"
        ), {"r": rule_id, "m": mean, "v": var, "n": n,
             "s": json.dumps(model) if model else None})
        await pg.commit()


async def update_and_score(rule_id: str, value: float,
                            method: str = "ewma", alpha: float = 0.3,
                            warmup_n: int = 10) -> dict:
    """Incremental EWMA: mean ← α·value + (1-α)·mean; var follows similarly.
    Returns {mean, var, n, z, warmup}. During warmup (n < warmup_n) z is
    reported but `warmup=True` so the evaluator suppresses firing.

    `method='holt_winters'` falls back to plain EWMA if statsmodels isn't
    available — this avoids a heavy dependency for v1; full HW lands later.
    """
    state = await _load_state(rule_id)
    n = state["n"]
    prev_mean = state["mean"] if state["mean"] is not None else value
    prev_var = state["var"] if state["var"] is not None else 1.0

    new_mean = alpha * value + (1 - alpha) * prev_mean
    new_var = alpha * (value - prev_mean) ** 2 + (1 - alpha) * prev_var
    std = math.sqrt(max(new_var, 1e-9))
    z = (value - new_mean) / std

    n += 1
    await _save_state(rule_id, new_mean, new_var, n, model=None)

    return {
        "mean": new_mean,
        "var": new_var,
        "z": z,
        "n": n,
        "warmup": n < warmup_n,
    }
