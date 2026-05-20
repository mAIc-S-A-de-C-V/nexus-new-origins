"""
PrefixSpan sequence mining over per-case ordered activity sequences. Captures
**ordered** patterns that association_rules' bag-of-activities approach loses
(A → B → C predicts X). Ranks discovered patterns by outcome differential
between cases with vs without the pattern.
"""
import logging
from collections import Counter

import numpy as np

from families import register
from clients.ontology import list_object_types
from clients.events import case_spans

log = logging.getLogger(__name__)

try:
    from prefixspan import PrefixSpan
except Exception:  # pragma: no cover
    PrefixSpan = None


def _is_subsequence(pattern: list, seq: list) -> bool:
    """Check ordered subsequence: pattern appears in seq with respect to order
    (gaps allowed)."""
    it = iter(seq)
    return all(any(p == s for s in it) for p in pattern)


async def _mine_one_ot(tenant_id: str, ot_id: str, ot_name: str) -> list[dict]:
    if PrefixSpan is None:
        return []
    spans = await case_spans(tenant_id, ot_id, days=365)
    if not spans or len(spans) < 30:
        return []

    sequences = [s.get("activities") or [] for s in spans]
    outcomes = {s["case_id"]: float(s.get("hours") or 0.0) for s in spans}

    try:
        ps = PrefixSpan(sequences)
        ps.minlen = 2
        ps.maxlen = 4
        top_n = 25
        min_support = max(5, int(0.05 * len(sequences)))
        patterns = ps.frequent(min_support)
        patterns.sort(key=lambda p: -p[0])
        patterns = patterns[:top_n]
    except Exception as exc:
        log.warning("PrefixSpan failed for %s: %s", ot_id, exc)
        return []

    findings: list[dict] = []
    cycle_pop = np.array([h for h in outcomes.values()])
    pop_mean = float(cycle_pop.mean())
    pop_std = float(cycle_pop.std()) or 1.0

    for support_count, pattern in patterns:
        if len(pattern) < 2:
            continue
        with_pat: list[float] = []
        without_pat: list[float] = []
        for s in spans:
            seq = s.get("activities") or []
            cy = outcomes[s["case_id"]]
            if _is_subsequence(pattern, seq):
                with_pat.append(cy)
            else:
                without_pat.append(cy)
        if len(with_pat) < 5 or len(without_pat) < 5:
            continue
        a = np.array(with_pat); b = np.array(without_pat)
        rb = (a.mean() - b.mean()) / pop_std
        if abs(rb) < 0.15:
            continue
        findings.append({
            "object_type_id": ot_id,
            "outcome_object_type_id": None,
            "feature": {"name": " → ".join(pattern), "kind": "activity_sequence",
                          "pattern": pattern, "support_count": int(support_count)},
            "outcome": {"name": "cycle_hours", "kind": "numeric"},
            "n": int(len(sequences)),
            "effect_size": float(abs(rb)),
            "effect_metric": "rank_lift",
            "p_value": None,
            "direction": "higher" if a.mean() > b.mean() else "lower",
            "stability_score": None,
            "title": (
                f"{ot_name}: sequence {' → '.join(pattern)} predicts "
                f"{'longer' if a.mean() > b.mean() else 'shorter'} cycles"
            ),
            "description": (
                f"Cases containing this sequence have avg cycle {a.mean():.1f}h vs "
                f"{b.mean():.1f}h (population mean {pop_mean:.1f}h, support={support_count})."
            ),
            "evidence": {
                "with_pattern_avg": float(a.mean()),
                "without_pattern_avg": float(b.mean()),
                "support_count": int(support_count),
                "with_pattern_n": int(len(a)),
                "without_pattern_n": int(len(b)),
            },
        })
    return findings


@register("sequence_mining", cost_weight=2.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    findings: list[dict] = []
    object_types = await list_object_types(tenant_id)
    for ot in object_types:
        try:
            findings.extend(await _mine_one_ot(tenant_id, ot["id"], ot["display_name"]))
        except Exception as exc:
            log.warning("sequence_mining failed for %s: %s", ot.get("id"), exc)
    return findings
