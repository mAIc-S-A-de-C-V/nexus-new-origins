"""
Propensity-score matching as a robustness check on top correlations from other
families. The workflow:

  1. Pick the top N findings from the previous-stage `ctx['raw_findings_so_far']`
     buffer (the orchestrator populates this).
  2. For each finding, identify the treatment (the feature) and the outcome.
  3. Fit a logistic propensity over the remaining covariates.
  4. Match treated and control units on propensity, re-estimate the effect on
     the matched sample.
  5. Flag the original finding if the re-estimate is direction-consistent and
     ≥ 0.5× the original magnitude. The matched estimate goes into
     `causal_estimate.psm_robust=True`.

Emits one finding per checked top-correlation (does not duplicate them — it
augments them via a side-channel write to ctx['psm_overrides']).
"""
import logging

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)


def _build_design(df: pd.DataFrame, treatment_col: str, outcome_col: str,
                  exclude: list[str]) -> tuple[pd.DataFrame, pd.Series, pd.Series] | None:
    cols = [c for c in df.columns
            if c not in (treatment_col, outcome_col, *exclude)
            and not c.startswith("_")]
    X = df[cols].copy()
    # Treatment: binarize via median split if numeric, else groupwise majority/non-majority
    t_col = df[treatment_col]
    if pd.api.types.is_numeric_dtype(t_col):
        median = pd.to_numeric(t_col, errors="coerce").median()
        T = (pd.to_numeric(t_col, errors="coerce") > median).astype(int)
    else:
        top = t_col.value_counts(dropna=True).index
        if len(top) < 2:
            return None
        T = (t_col == top[0]).astype(int)
    Y = pd.to_numeric(df[outcome_col], errors="coerce")
    keep = T.notna() & Y.notna()
    if keep.sum() < 60:
        return None
    X = X.loc[keep]
    T = T.loc[keep]
    Y = Y.loc[keep]
    # Encode covariates
    for col in X.columns:
        if not pd.api.types.is_numeric_dtype(X[col]):
            X[col] = X[col].astype("category").cat.codes
    X = X.fillna(X.median(numeric_only=True))
    return X, T, Y


def _psm_estimate(X: pd.DataFrame, T: pd.Series, Y: pd.Series) -> dict | None:
    """Returns {ate, n_matched, direction_consistent}. Pair-matched nearest-
    neighbor PSM with 1:1 matching without replacement."""
    if X.shape[1] == 0:
        return None
    try:
        Xs = StandardScaler().fit_transform(X.values)
        clf = LogisticRegression(max_iter=200, n_jobs=1).fit(Xs, T.values)
        propensity = clf.predict_proba(Xs)[:, 1]
    except Exception as exc:
        log.warning("propensity model failed: %s", exc)
        return None

    treated_idx = np.where(T.values == 1)[0]
    control_idx = np.where(T.values == 0)[0]
    if len(treated_idx) < 10 or len(control_idx) < 10:
        return None
    treated_p = propensity[treated_idx]
    control_p = propensity[control_idx]

    matched_treated = []
    matched_control = []
    available = list(control_idx)
    available_p = list(control_p)
    for t_i, p in zip(treated_idx, treated_p):
        if not available:
            break
        diffs = [abs(p - cp) for cp in available_p]
        k = int(np.argmin(diffs))
        # caliper: skip if too far
        if diffs[k] > 0.1:
            continue
        matched_treated.append(t_i)
        matched_control.append(available[k])
        del available[k]
        del available_p[k]

    if len(matched_treated) < 20:
        return None
    yt = Y.iloc[matched_treated].astype(float).values
    yc = Y.iloc[matched_control].astype(float).values
    ate = float(yt.mean() - yc.mean())
    sd = float(((np.concatenate([yt, yc])).std()) or 1.0)
    cohens_d = ate / sd
    return {"ate": ate, "cohens_d": float(cohens_d), "n_matched": len(matched_treated)}


@register("propensity", cost_weight=3.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    raw = ctx.get("raw_findings_so_far") or []
    if not raw:
        return []

    # Pick top 20 numeric outcomes with categorical/numeric feature for PSM
    candidates = [f for f in raw
                  if f.get("family") in ("univariate_stats", "mutual_info", "tree_importance")
                  and (f.get("effect_metric") or "").startswith(("cohens", "spearman", "pearson", "mutual"))
                  and f.get("feature", {}).get("name") and f.get("outcome", {}).get("name")]
    candidates.sort(key=lambda f: abs(f.get("effect_size") or 0), reverse=True)
    candidates = candidates[:20]

    findings: list[dict] = []
    overrides = ctx.setdefault("psm_overrides", {})

    for cand in candidates:
        feature_name = cand["feature"]["name"]
        outcome_name = cand["outcome"]["name"]
        ot_id = cand["object_type_id"]
        try:
            df = await load_ot_dataframe(tenant_id, ot_id, cache=cache)
        except Exception:
            continue
        if df.empty:
            continue
        if feature_name not in df.columns or outcome_name not in df.columns:
            continue
        prep = _build_design(df, feature_name, outcome_name, exclude=[])
        if prep is None:
            continue
        X, T, Y = prep
        est = _psm_estimate(X, T, Y)
        if est is None:
            continue
        original_effect = float(cand.get("effect_size") or 0.0)
        survives = (abs(est["cohens_d"]) >= 0.5 * max(original_effect, 0.05)
                     and (est["ate"] >= 0) == (original_effect >= 0))
        causal_block = {
            "method": "propensity_score_matching",
            "estimate": est["ate"],
            "cohens_d": est["cohens_d"],
            "n_matched": est["n_matched"],
            "psm_robust": survives,
        }
        overrides[cand.get("id") or f"{ot_id}:{feature_name}:{outcome_name}"] = causal_block

        # Emit a side finding so it shows up in feed even if no override is read
        findings.append({
            "object_type_id": ot_id,
            "outcome_object_type_id": cand.get("outcome_object_type_id"),
            "feature": {"name": feature_name, "kind": "psm_check"},
            "outcome": {"name": outcome_name, "kind": "numeric"},
            "n": est["n_matched"],
            "effect_size": abs(est["cohens_d"]),
            "effect_metric": "cohens_d_psm",
            "p_value": None,
            "direction": "higher" if est["ate"] > 0 else "lower",
            "stability_score": None,
            "title": (
                f"PSM check: {feature_name} effect on {outcome_name} "
                + ("survives matching" if survives else "shrinks under matching")
            ),
            "description": (
                f"Re-estimated ATE on matched sample (n={est['n_matched']}): "
                f"{est['ate']:.3f}; original effect was {original_effect:.3f}. "
                + ("Direction preserved and magnitude ≥ 50% retained — robust-causal-adjacent."
                   if survives else "Magnitude shrank > 50% — confounding likely.")
            ),
            "causal_estimate": causal_block,
            "evidence": {"original_effect": original_effect, "psm_estimate": est},
        })
    return findings
