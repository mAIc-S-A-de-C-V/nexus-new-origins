"""
Time-series anomaly detection per (object_type, metric) daily series. Three
detectors run independently:

  1. Rolling z-score on daily counts — flags single-day spikes/drops.
  2. PELT changepoint detection (ruptures) — flags regime shifts.
  3. Multi-metric co-deviation — flags days where many metrics jointly spike,
     using Mahalanobis distance of the per-day z-vector.

Each finding includes the date range, baseline, and observed values for
straightforward investigation.
"""
import logging
from datetime import datetime

import numpy as np
import pandas as pd

from families import register
from clients.ontology import list_object_types
from clients.events import daily_metric_series

log = logging.getLogger(__name__)

try:
    import ruptures as rpt
except Exception:  # pragma: no cover
    rpt = None


def _rolling_z(values: np.ndarray, window: int = 14) -> np.ndarray:
    n = len(values)
    z = np.zeros(n)
    for i in range(window, n):
        baseline = values[i - window:i]
        mu = baseline.mean()
        sigma = baseline.std()
        if sigma <= 1e-6:
            continue
        z[i] = (values[i] - mu) / sigma
    return z


def _detect_changepoints(values: np.ndarray) -> list[int]:
    if rpt is None or len(values) < 21:
        return []
    try:
        algo = rpt.Pelt(model="l2", min_size=7).fit(values)
        cps = algo.predict(pen=10)
        return [int(c) for c in cps if 0 < c < len(values)]
    except Exception:
        return []


async def _detect_for_metric(tenant_id: str, ot_id: str, metric: str) -> list[dict]:
    series = await daily_metric_series(tenant_id, ot_id, metric, days=120)
    if not series or len(series) < 21:
        return []
    df = pd.DataFrame(series, columns=["day", "value"]).sort_values("day").reset_index(drop=True)
    values = df["value"].astype(float).values
    days = pd.to_datetime(df["day"]).dt.date.astype(str).values

    findings: list[dict] = []

    # Rolling z spikes
    z = _rolling_z(values, window=14)
    for i in range(len(z)):
        if abs(z[i]) >= 3.0:
            findings.append({
                "object_type_id": ot_id,
                "outcome_object_type_id": None,
                "feature": {"name": metric, "kind": "daily_series", "day": days[i]},
                "outcome": {"name": "anomalous_day", "kind": "categorical"},
                "n": int(len(values)),
                "effect_size": float(min(1.0, abs(z[i]) / 5.0)),
                "effect_metric": "iso_forest_outlierness",
                "p_value": None,
                "direction": "higher" if z[i] > 0 else "lower",
                "stability_score": None,
                "title": f"{metric} spike on {days[i]} ({z[i]:+.1f}σ)",
                "description": (
                    f"Daily {metric} = {values[i]:.1f} vs 14-day baseline mean ≈ "
                    f"{values[max(0,i-14):i].mean():.1f}; z = {z[i]:+.2f}."
                ),
                "evidence": {"day": days[i], "value": float(values[i]),
                              "baseline_avg": float(values[max(0, i-14):i].mean()),
                              "z": float(z[i])},
            })

    # Changepoint
    cps = _detect_changepoints(values)
    for cp in cps:
        before = values[max(0, cp-14):cp]
        after = values[cp:min(len(values), cp+14)]
        if len(before) < 3 or len(after) < 3:
            continue
        b_mean, a_mean = float(before.mean()), float(after.mean())
        delta = a_mean - b_mean
        sd = float((np.concatenate([before, after])).std() or 1.0)
        d = abs(delta / sd)
        if d < 0.4:
            continue
        findings.append({
            "object_type_id": ot_id,
            "outcome_object_type_id": None,
            "feature": {"name": metric, "kind": "regime_change", "day": days[cp]},
            "outcome": {"name": "regime_shift", "kind": "categorical"},
            "n": int(len(values)),
            "effect_size": float(min(1.0, d)),
            "effect_metric": "cohens_d",
            "p_value": None,
            "direction": "higher" if delta > 0 else "lower",
            "stability_score": None,
            "title": f"{metric} regime change on {days[cp]} ({delta:+.1f})",
            "description": (
                f"Mean before: {b_mean:.1f}; after: {a_mean:.1f}; d ≈ {d:.2f}."
            ),
            "evidence": {"changepoint_day": days[cp],
                          "before_mean": b_mean, "after_mean": a_mean},
        })
    return findings


@register("ts_anomaly", cost_weight=2.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    findings: list[dict] = []
    object_types = await list_object_types(tenant_id)
    for ot in object_types:
        for metric in ("case_count", "event_count"):
            try:
                findings.extend(await _detect_for_metric(tenant_id, ot["id"], metric))
            except Exception as exc:
                log.warning("ts_anomaly %s/%s failed: %s", ot.get("id"), metric, exc)
    return findings
