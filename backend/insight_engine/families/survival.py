"""
Kaplan-Meier survival + log-rank tests per categorical feature on time-to-event
outcomes. Right-censoring on still-open cases.

For each (object_type, categorical feature) we estimate survival curves for
the time-to-completion of the case, then run a multivariate log-rank between
groups. Effect size = log-rank χ² rescaled into [0,1].
"""
import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)

try:
    from lifelines.statistics import multivariate_logrank_test
    from lifelines import KaplanMeierFitter
except Exception:  # pragma: no cover
    multivariate_logrank_test = None
    KaplanMeierFitter = None


async def _eval_feature(df: pd.DataFrame, feature_col: str, ot_id: str) -> dict | None:
    if multivariate_logrank_test is None:
        return None
    if "cycle_hours" not in df.columns:
        return None
    sub = df[[feature_col, "cycle_hours", "case_complete"]].dropna(subset=[feature_col, "cycle_hours"])
    if len(sub) < 40:
        return None
    if sub[feature_col].nunique() < 2 or sub[feature_col].nunique() > 12:
        return None
    durations = sub["cycle_hours"].astype(float).values
    event = sub.get("case_complete")
    event_observed = (event.fillna(0).astype(int).values if event is not None
                      else np.ones(len(sub), dtype=int))
    groups = sub[feature_col].astype(str).values

    try:
        res = multivariate_logrank_test(durations, groups, event_observed)
    except Exception as exc:
        log.warning("logrank failed for %s/%s: %s", ot_id, feature_col, exc)
        return None
    chi2 = float(res.test_statistic)
    p = float(res.p_value)
    n_groups = sub[feature_col].nunique()
    # Rescale χ² into a [0,1]-ish effect. χ² > 10 → strong; > 25 → very strong.
    effect = float(min(1.0, chi2 / 25.0))

    # Compute per-group medians to populate evidence
    group_stats = []
    for g, gdf in sub.groupby(feature_col):
        n = len(gdf)
        if n < 5:
            continue
        try:
            kmf = KaplanMeierFitter().fit(gdf["cycle_hours"].astype(float),
                                          (gdf.get("case_complete") if "case_complete" in gdf else pd.Series([1] * n)).fillna(0).astype(int))
            median = float(kmf.median_survival_time_) if kmf.median_survival_time_ is not None else None
        except Exception:
            median = None
        group_stats.append({"label": str(g), "n": int(n),
                             "median_hours": median,
                             "completion_rate": float((gdf.get("case_complete") if "case_complete" in gdf else pd.Series([1]*n)).fillna(0).astype(int).mean())})

    return {
        "object_type_id": ot_id,
        "outcome_object_type_id": None,
        "feature": {"name": feature_col, "type": "categorical"},
        "outcome": {"name": "time_to_completion", "kind": "time_to_event"},
        "n": int(len(sub)),
        "effect_size": effect,
        "effect_metric": "logrank_chi2",
        "p_value": p,
        "direction": None,
        "stability_score": None,
        "title": f"{feature_col} groups have different time-to-completion",
        "description": (
            f"Multivariate log-rank χ² = {chi2:.1f} across {n_groups} groups, p = {p:.3g}, n = {len(sub)}."
        ),
        "evidence": {"group_stats": group_stats, "chi2": chi2, "logrank_p": p},
    }


@register("survival", cost_weight=2.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    findings: list[dict] = []
    seen = set()
    for spec in specs:
        ot_id = (spec.feature or {}).get("object_type_id") or (spec.outcome or {}).get("object_type_id")
        feature = (spec.feature or {}).get("name")
        if not ot_id or not feature:
            continue
        key = (ot_id, feature)
        if key in seen:
            continue
        seen.add(key)
        try:
            df = await load_ot_dataframe(tenant_id, ot_id, cache=cache)
        except Exception as exc:
            log.warning("survival loader failed for %s: %s", ot_id, exc)
            continue
        if df.empty:
            continue
        f = await _eval_feature(df, feature, ot_id)
        if f:
            findings.append(f)
    return findings
