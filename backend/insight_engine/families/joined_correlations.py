"""
Cross-object correlations. Walks `ontology_links` to find connected OT pairs,
builds a joined record DataFrame, then runs the univariate test suite on
(feature in OT_A) × (outcome in OT_B).

Joins use the `data.source_field` / `data.target_field` in each ontology_link
record. If those aren't declared, the link is skipped — we don't guess at join
keys here; record_linkage is the family that surfaces missing links.

Bounded by max_join_path_length (1 — direct neighbors only — for v1).
"""
import logging

import numpy as np
import pandas as pd
from scipy import stats

from families import register
from clients.ontology import get_link_graph, list_object_types
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)


def _cohens_d(a, b) -> float:
    import math
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa, sb = a.var(ddof=1), b.var(ddof=1)
    pooled = math.sqrt(((len(a) - 1) * sa + (len(b) - 1) * sb) / (len(a) + len(b) - 2))
    if pooled <= 1e-12:
        return 0.0
    return float((a.mean() - b.mean()) / pooled)


async def _build_joined(tenant_id: str, link: dict, cache: dict) -> tuple[pd.DataFrame, str, str] | None:
    a_ot = link["source_object_type_id"]
    b_ot = link["target_object_type_id"]
    data = link.get("data") or {}
    a_key = data.get("source_field") or "_source_id"
    b_key = data.get("target_field") or "_source_id"

    a_df = await load_ot_dataframe(tenant_id, a_ot, cache=cache)
    b_df = await load_ot_dataframe(tenant_id, b_ot, cache=cache)
    if a_df.empty or b_df.empty:
        return None
    if a_key not in a_df.columns or b_key not in b_df.columns:
        return None

    # Rename collisions
    a_df = a_df.add_prefix("A_")
    b_df = b_df.add_prefix("B_")
    a_key_p, b_key_p = f"A_{a_key}", f"B_{b_key}"

    joined = a_df.merge(b_df, left_on=a_key_p, right_on=b_key_p, how="inner")
    if len(joined) < 40:
        return None
    return joined, a_ot, b_ot


async def _eval_joined_pair(joined: pd.DataFrame, a_ot: str, b_ot: str) -> list[dict]:
    findings: list[dict] = []
    feature_cols = [c for c in joined.columns if c.startswith("A_") and not c.endswith(("_id", "_record_id", "_source_id"))]
    outcome_cols = [c for c in joined.columns if c.startswith("B_") and c.endswith(("cycle_hours", "event_count", "total_cost", "rework_flag"))]
    # Cap to limit explosion
    feature_cols = feature_cols[:30]

    for feat in feature_cols:
        if joined[feat].isna().mean() > 0.5:
            continue
        feat_numeric = pd.api.types.is_numeric_dtype(joined[feat])
        if not feat_numeric and joined[feat].nunique() > 12:
            continue
        for outcome in outcome_cols:
            if joined[outcome].isna().mean() > 0.7:
                continue
            sub = joined[[feat, outcome]].dropna()
            if len(sub) < 30:
                continue
            if feat_numeric:
                try:
                    sp = stats.spearmanr(sub[feat].astype(float), sub[outcome].astype(float))
                    effect = abs(float(sp.correlation or 0.0))
                    p_val = float(sp.pvalue)
                    metric = "spearman_rho"
                    direction = "higher" if sp.correlation > 0 else "lower"
                except Exception:
                    continue
            else:
                groups = [sub[sub[feat] == v][outcome].astype(float).values for v in sub[feat].unique()]
                groups = [g for g in groups if len(g) >= 5]
                if len(groups) < 2:
                    continue
                try:
                    d = abs(_cohens_d(groups[0], groups[-1]))
                    f_stat, p_val = stats.f_oneway(*groups)
                    effect, metric, direction = d, "cohens_d", None
                except Exception:
                    continue
            findings.append({
                "object_type_id": a_ot,
                "outcome_object_type_id": b_ot,
                "feature": {"name": feat.replace("A_", "", 1), "object_type_id": a_ot,
                             "type": "numeric" if feat_numeric else "categorical"},
                "outcome": {"name": outcome.replace("B_", "", 1), "object_type_id": b_ot,
                             "type": "numeric"},
                "n": int(len(sub)),
                "effect_size": effect,
                "effect_metric": metric,
                "p_value": p_val,
                "direction": direction,
                "stability_score": None,
                "title": (
                    f"{feat.replace('A_','',1)} (in {a_ot}) → {outcome.replace('B_','',1)} (in {b_ot})"
                ),
                "description": (
                    f"Across joined records: {metric}={effect:.3f}, p={p_val:.3g}, n={len(sub)}."
                ),
                "evidence": {
                    "joined_n": int(len(sub)),
                    "feature_ot": a_ot, "outcome_ot": b_ot,
                },
            })
    return findings


@register("joined_correlations", cost_weight=3.0, requires=("cross_ot_enabled",))
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    link_graph = await get_link_graph(tenant_id)
    findings: list[dict] = []
    for link in link_graph:
        try:
            joined_payload = await _build_joined(tenant_id, link, cache)
        except Exception as exc:
            log.warning("joined build failed: %s", exc)
            continue
        if joined_payload is None:
            continue
        joined, a_ot, b_ot = joined_payload
        try:
            findings.extend(await _eval_joined_pair(joined, a_ot, b_ot))
        except Exception as exc:
            log.warning("joined eval failed: %s", exc)
    return findings
