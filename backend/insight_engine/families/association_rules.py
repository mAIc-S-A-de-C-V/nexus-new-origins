"""
Apriori / association-rules over per-case activity item-sets. Surfaces
"bag-of-activities" patterns predictive of outcomes:

  "Cases containing {RescheduleVisit, RequestDocs} have 3.1× rework_pct lift"

Joins rule antecedent/consequent to derived outcomes (cycle_hours, rework_flag)
for one extra column of meaning on top of vanilla support/confidence/lift.
"""
import logging
from collections import defaultdict

import numpy as np
import pandas as pd

from families import register
from clients.ontology import list_object_types
from clients.events import case_spans

log = logging.getLogger(__name__)

try:
    from mlxtend.preprocessing import TransactionEncoder
    from mlxtend.frequent_patterns import apriori, association_rules
except Exception:  # pragma: no cover
    TransactionEncoder = None
    apriori = None
    association_rules = None


async def _mine_one_ot(tenant_id: str, ot_id: str, ot_name: str) -> list[dict]:
    if apriori is None:
        return []
    spans = await case_spans(tenant_id, ot_id, days=365)
    if not spans:
        return []
    transactions = [list(set(s.get("activities") or [])) for s in spans]
    # Build outcome lookup: case_id -> (cycle_hours, rework_flag)
    outcomes = {}
    for s in spans:
        acts = s.get("activities") or []
        outcomes[s["case_id"]] = {
            "cycle_hours": float(s.get("hours") or 0.0),
            "rework_flag": int(len(acts) != len(set(acts))),
        }

    if not transactions or all(not t for t in transactions):
        return []
    te = TransactionEncoder()
    te_ary = te.fit(transactions).transform(transactions)
    tdf = pd.DataFrame(te_ary, columns=te.columns_)

    min_support = 0.05 if len(transactions) >= 200 else max(0.10, 5 / len(transactions))
    try:
        freq = apriori(tdf, min_support=min_support, use_colnames=True, max_len=3)
    except Exception as exc:
        log.warning("apriori failed for %s: %s", ot_id, exc)
        return []
    if freq.empty:
        return []
    try:
        rules = association_rules(freq, metric="lift", min_threshold=1.3)
    except Exception:
        return []
    if rules.empty:
        return []

    findings: list[dict] = []
    rules = rules.sort_values("lift", ascending=False).head(20)
    for _, r in rules.iterrows():
        ant = sorted(r["antecedents"])
        con = sorted(r["consequents"])
        # Outcome differential: cases containing antecedent vs not
        with_ant = []
        without_ant = []
        ant_set = set(ant)
        for s in spans:
            if ant_set.issubset(set(s.get("activities") or [])):
                with_ant.append(outcomes[s["case_id"]])
            else:
                without_ant.append(outcomes[s["case_id"]])
        if len(with_ant) < 5 or len(without_ant) < 5:
            continue
        avg_cy_in = np.mean([o["cycle_hours"] for o in with_ant])
        avg_cy_out = np.mean([o["cycle_hours"] for o in without_ant])
        rework_in = np.mean([o["rework_flag"] for o in with_ant])
        rework_out = np.mean([o["rework_flag"] for o in without_ant])

        findings.append({
            "object_type_id": ot_id,
            "outcome_object_type_id": None,
            "feature": {
                "name": " + ".join(ant),
                "kind": "activity_set",
                "antecedents": ant, "consequents": con,
                "support": float(r["support"]), "confidence": float(r["confidence"]),
                "lift": float(r["lift"]),
            },
            "outcome": {"name": " + ".join(con), "kind": "activity_set"},
            "n": int(len(transactions)),
            "effect_size": float(r["lift"]),
            "effect_metric": "lift",
            "p_value": None,
            "direction": "higher" if r["lift"] > 1 else "lower",
            "stability_score": None,
            "title": (
                f"{ot_name}: {{{', '.join(ant)}}} ⇒ {{{', '.join(con)}}} (lift {r['lift']:.2f})"
            ),
            "description": (
                f"support={r['support']:.2f}, confidence={r['confidence']:.2f}, "
                f"lift={r['lift']:.2f}. Cases containing antecedent: "
                f"avg cycle {avg_cy_in:.1f}h vs {avg_cy_out:.1f}h; "
                f"rework {rework_in*100:.0f}% vs {rework_out*100:.0f}%."
            ),
            "evidence": {
                "support": float(r["support"]),
                "confidence": float(r["confidence"]),
                "lift": float(r["lift"]),
                "with_ant_cycle_hours_avg": float(avg_cy_in),
                "without_ant_cycle_hours_avg": float(avg_cy_out),
                "with_ant_rework_pct": float(rework_in * 100),
                "without_ant_rework_pct": float(rework_out * 100),
            },
        })
    return findings


@register("association_rules", cost_weight=2.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    findings: list[dict] = []
    object_types = await list_object_types(tenant_id)
    for ot in object_types:
        try:
            findings.extend(await _mine_one_ot(tenant_id, ot["id"], ot["display_name"]))
        except Exception as exc:
            log.warning("association_rules failed for %s: %s", ot.get("id"), exc)
    return findings
