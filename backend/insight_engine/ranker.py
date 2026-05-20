"""
Composite ranking + family-balance reranking.

rank_score = effect_size × log(1 + n) × stability_score
           × (1.2 if replication_holdout_pass else 0.7)
           × (1 + 0.5 × novelty_score)
           × family_prior

Phase 5 enables effect_size + log(n) + stability; Phase 11 enables
replication and novelty.
"""
import math
from typing import Iterable


DEFAULT_FAMILY_PRIOR = 1.0
FAMILY_PRIOR_MAP = {
    # Families that operate on stronger signal get a small boost.
    "tree_importance":   1.1,
    "survival":          1.1,
    "causal":            1.2,
    "joined_correlations": 1.1,
    "record_linkage":    1.0,
}


def composite_score(finding: dict) -> float:
    effect = abs(float(finding.get("effect_size") or 0.0))
    n = int(finding.get("n") or 0)
    stab = float(finding.get("stability_score") or 1.0)
    rep_pass = finding.get("replication_holdout_pass")
    novelty = float(finding.get("novelty_score") or 0.0)
    family_prior = FAMILY_PRIOR_MAP.get(finding.get("family", ""), DEFAULT_FAMILY_PRIOR)

    score = effect * math.log1p(max(n, 0)) * max(stab, 0.0)
    if rep_pass is True:
        score *= 1.2
    elif rep_pass is False:
        score *= 0.7
    score *= 1.0 + 0.5 * novelty
    score *= family_prior
    return score


def rerank_for_family_balance(findings: list[dict],
                              max_per_family_top10: int = 4) -> list[dict]:
    """Reorder so no single family dominates the top 10. If a family has
    > max_per_family_top10 entries in the top 10, swap surplus with the
    next-highest entry from a different family."""
    ordered = sorted(findings, key=lambda f: f.get("rank_score", 0), reverse=True)
    if len(ordered) <= 10:
        return ordered
    top10 = ordered[:10]
    rest = ordered[10:]
    counts: dict[str, int] = {}
    for f in top10:
        counts[f.get("family", "")] = counts.get(f.get("family", ""), 0) + 1
    swaps = []
    for i, f in enumerate(top10):
        fam = f.get("family", "")
        if counts[fam] > max_per_family_top10:
            for j, g in enumerate(rest):
                if counts.get(g.get("family", ""), 0) < max_per_family_top10:
                    swaps.append((i, j))
                    counts[fam] -= 1
                    counts[g.get("family", "")] = counts.get(g.get("family", ""), 0) + 1
                    break
    for i, j in swaps:
        top10[i], rest[j] = rest[j], top10[i]
    return top10 + rest


def apply_ranking(findings: Iterable[dict]) -> list[dict]:
    materialized = list(findings)
    for f in materialized:
        f["rank_score"] = composite_score(f)
    return rerank_for_family_balance(materialized)
