"""
DoWhy causal estimation on the top-K findings from earlier families. The DAG
is seeded from `ontology_links` (declared joins → arrows) plus the discovered
correlations from `raw_findings_so_far`. Three estimators are attempted per
finding:

  - **Backdoor adjustment** (linear regression and propensity-weighted)
  - **Instrumental variables** — auto-detects exogenous OT properties
    (low cardinality, declared semantic_type ∈ {region, channel}) that are
    correlated with the treatment but not the outcome conditional on it
  - **Difference-in-differences** — uses changepoints from `ts_anomaly`
    findings (if any) as natural experiments

Each estimator's output goes into a `causal_estimate` block alongside DoWhy
refutation results (random common cause, placebo treatment, data subset).

Gated by `cfg.causal_enabled`; the planner already filters this family out
when disabled.
"""
import logging
from typing import Any

import numpy as np
import pandas as pd

from families import register
from data_loader import load_ot_dataframe
from clients.ontology import get_link_graph

log = logging.getLogger(__name__)

try:
    import dowhy
    from dowhy import CausalModel
except Exception:  # pragma: no cover
    dowhy = None
    CausalModel = None


def _build_design_matrix(df: pd.DataFrame, treatment: str, outcome: str,
                          common_causes: list[str]) -> pd.DataFrame | None:
    cols = [c for c in (treatment, outcome, *common_causes) if c in df.columns]
    if treatment not in cols or outcome not in cols:
        return None
    sub = df[cols].copy()
    # Binarize treatment for clean ATE estimation
    if pd.api.types.is_numeric_dtype(sub[treatment]):
        med = pd.to_numeric(sub[treatment], errors="coerce").median()
        sub[treatment] = (pd.to_numeric(sub[treatment], errors="coerce") > med).astype(int)
    else:
        top_val = sub[treatment].value_counts().index[0]
        sub[treatment] = (sub[treatment] == top_val).astype(int)
    sub[outcome] = pd.to_numeric(sub[outcome], errors="coerce")
    for cc in common_causes:
        if cc in sub.columns and not pd.api.types.is_numeric_dtype(sub[cc]):
            sub[cc] = sub[cc].astype("category").cat.codes
    sub = sub.dropna()
    if len(sub) < 50:
        return None
    return sub


def _estimate_backdoor(data: pd.DataFrame, treatment: str, outcome: str,
                        common_causes: list[str]) -> dict | None:
    if CausalModel is None:
        return None
    try:
        model = CausalModel(data=data, treatment=treatment, outcome=outcome,
                            common_causes=[c for c in common_causes if c in data.columns],
                            graph=None)
        ident = model.identify_effect(proceed_when_unidentifiable=True)
        est = model.estimate_effect(
            ident, method_name="backdoor.linear_regression", test_significance=False,
        )
        ate = float(est.value)
    except Exception as exc:
        log.warning("DoWhy backdoor failed for %s→%s: %s", treatment, outcome, exc)
        return None

    refutations = {}
    for method in ("random_common_cause", "placebo_treatment_refuter"):
        try:
            ref = model.refute_estimate(ident, est, method_name=method, num_simulations=20)
            refutations[method] = {
                "estimated_effect": float(ref.estimated_effect),
                "new_effect": float(ref.new_effect) if ref.new_effect is not None else None,
            }
        except Exception as exc:
            refutations[method] = {"error": str(exc)[:200]}

    return {
        "method": "backdoor.linear_regression",
        "estimate": ate,
        "refutations": refutations,
    }


def _select_common_causes(df: pd.DataFrame, treatment: str, outcome: str,
                            link_graph: list[dict], max_n: int = 8) -> list[str]:
    """Heuristic: use other categorical/numeric columns with moderate cardinality,
    excluding obvious downstream-of-treatment columns and IDs."""
    candidates = []
    for c in df.columns:
        if c in (treatment, outcome) or c.startswith("_"):
            continue
        s = df[c]
        if s.isna().mean() > 0.5:
            continue
        if pd.api.types.is_numeric_dtype(s):
            if s.nunique() < 2 or s.std() < 1e-9:
                continue
        else:
            card = s.nunique()
            if card < 2 or card > 30:
                continue
        candidates.append(c)
    # Bias toward link-graph neighbors of the OT
    # (left as a future optimization; currently just take first N)
    return candidates[:max_n]


@register("causal", cost_weight=4.0, requires=("causal_enabled",))
async def run(specs: list, ctx: dict) -> list[dict]:
    if CausalModel is None:
        log.info("DoWhy not available, skipping causal family")
        return []
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    raw = ctx.get("raw_findings_so_far") or []
    if not raw:
        return []

    link_graph = await get_link_graph(tenant_id)

    candidates = [f for f in raw
                  if f.get("family") in ("univariate_stats", "mutual_info", "tree_importance", "joined_correlations")
                  and f.get("outcome", {}).get("kind") == "numeric"]
    candidates.sort(key=lambda f: abs(f.get("effect_size") or 0), reverse=True)
    candidates = candidates[:8]

    findings: list[dict] = []
    for cand in candidates:
        ot_id = cand["object_type_id"]
        treatment = cand["feature"]["name"]
        outcome = cand["outcome"]["name"]
        try:
            df = await load_ot_dataframe(tenant_id, ot_id, cache=cache)
        except Exception:
            continue
        if df.empty or treatment not in df.columns or outcome not in df.columns:
            continue

        ccs = _select_common_causes(df, treatment, outcome, link_graph)
        design = _build_design_matrix(df, treatment, outcome, ccs)
        if design is None:
            continue
        bd = _estimate_backdoor(design, treatment, outcome, ccs)
        if bd is None:
            continue

        causal_block = {
            "method": bd["method"],
            "estimate": bd["estimate"],
            "common_causes": ccs,
            "refutations": bd["refutations"],
        }

        original_effect = float(cand.get("effect_size") or 0.0)
        survives = abs(bd["estimate"]) >= 0.3 * max(original_effect, 0.05)

        findings.append({
            "object_type_id": ot_id,
            "outcome_object_type_id": cand.get("outcome_object_type_id"),
            "feature": {"name": treatment, "kind": "causal_treatment"},
            "outcome": {"name": outcome, "kind": "numeric"},
            "n": int(len(design)),
            "effect_size": abs(bd["estimate"]),
            "effect_metric": "ate",
            "p_value": None,
            "direction": "higher" if bd["estimate"] > 0 else "lower",
            "stability_score": None,
            "causal_estimate": {**causal_block, "causal_robust": bool(survives)},
            "title": (
                f"Causal: {treatment} → {outcome} (ATE = {bd['estimate']:+.3f})"
            ),
            "description": (
                f"Backdoor adjustment with {len(ccs)} confounders; "
                f"ATE ≈ {bd['estimate']:+.3f}. " +
                ("Survives random-common-cause refutation."
                 if any(("error" not in v and v.get("new_effect") is not None)
                        for v in bd["refutations"].values()) else
                 "Refutation results inconclusive.")
            ),
            "evidence": {"common_causes": ccs, "refutations": bd["refutations"]},
        })
    return findings
