"""
Test budget planner. Walks the feature and outcome catalogs, generates
candidate (family, feature, outcome) test specs, and allocates them under a
hard `max_tests` cap with per-family priors. Warm-start: families that
produced more high-rank insights last run get more budget this run.

The planner is intentionally cheap — it doesn't run any analysis itself. It
returns a list of TestSpec records the orchestrator hands to each family.
"""
import logging
from dataclasses import dataclass, asdict
from typing import Any

from feature_catalog import FeatureMeta
from outcome_catalog import OutcomeMeta
from families import all_families, enabled_families

log = logging.getLogger(__name__)


@dataclass
class TestSpec:
    family: str
    feature: dict           # FeatureMeta as dict (or family-specific blob)
    outcome: dict           # OutcomeMeta as dict
    cost_weight: float = 1.0

    def to_dict(self) -> dict:
        return asdict(self)


# Per-family rule sets that determine which (feature, outcome) pairs they can
# evaluate. Each entry returns True if the pair is appropriate.
def _pair_for_univariate(f: FeatureMeta, o: OutcomeMeta) -> bool:
    if f.denylisted:
        return False
    if f.dtype == "datetime" or f.dtype == "empty":
        return False
    if f.object_type_id != o.object_type_id:
        return False
    # Some categorical features need cardinality cap
    if f.dtype in ("string", "bool") and f.cardinality > 50:
        return False
    return True


def _pair_for_mutual_info(f: FeatureMeta, o: OutcomeMeta) -> bool:
    return _pair_for_univariate(f, o)


def _pair_for_tree_importance(f: FeatureMeta, o: OutcomeMeta) -> bool:
    # tree_importance fits one model per (object_type, outcome) and ranks ALL
    # eligible features together. So the planner emits one TestSpec per
    # (ot, outcome) instead of (feature, outcome). The orchestrator collapses.
    if f.object_type_id != o.object_type_id:
        return False
    if f.denylisted:
        return False
    return True


PAIR_RULES = {
    "univariate_stats": _pair_for_univariate,
    "mutual_info":      _pair_for_mutual_info,
    "tree_importance":  _pair_for_tree_importance,
}


def _family_default_prior(name: str) -> float:
    # Cold-start priors: roughly equal but slightly favor cheaper, broader
    # families over the expensive tree fit.
    table = {
        "univariate_stats":      1.0,
        "mutual_info":           0.8,
        "tree_importance":       0.6,
        "record_linkage":        0.5,
        "clustering":            0.4,
        "anomaly_records":       0.4,
        "association_rules":     0.6,
        "sequence_mining":       0.5,
        "survival":              0.4,
        "ts_anomaly":            0.4,
        "propensity":            0.3,
        "causal":                0.3,
        "joined_correlations":   0.4,
        "text_clusters":         0.3,
    }
    return table.get(name, 0.5)


def plan_tests(features: list[FeatureMeta], outcomes: list[OutcomeMeta],
               cfg: dict) -> list[TestSpec]:
    """Returns ordered list of TestSpec under cfg['max_tests']. Higher-prior
    families take a larger share."""
    max_tests = int(cfg.get("max_tests") or 5000)
    priors_override = (cfg or {}).get("family_priors") or {}
    families = enabled_families(cfg)

    if not families:
        return []

    # Compute per-family priors (override → default).
    priors = {name: float(priors_override.get(name, _family_default_prior(name)))
              for name in families.keys()}
    prior_sum = sum(priors.values()) or 1.0
    family_budget = {
        name: max(1, int(max_tests * priors[name] / prior_sum))
        for name in families.keys()
    }

    plan: list[TestSpec] = []

    for fam_name, entry in families.items():
        rule = PAIR_RULES.get(fam_name)
        budget = family_budget[fam_name]

        if fam_name == "tree_importance":
            # one test per (object_type, outcome)
            seen = set()
            for o in outcomes:
                key = (o.object_type_id, o.name)
                if key in seen:
                    continue
                # require at least one eligible feature in the same OT
                has_feat = any(f.object_type_id == o.object_type_id and not f.denylisted for f in features)
                if not has_feat:
                    continue
                seen.add(key)
                plan.append(TestSpec(
                    family=fam_name,
                    feature={"object_type_id": o.object_type_id,
                              "kind": "all_features_in_ot"},
                    outcome=o.__dict__,
                    cost_weight=entry.cost_weight,
                ))
                if len(seen) >= budget:
                    break
            continue

        if rule is None:
            # Family with no explicit pair rule (e.g. clustering, ts_anomaly)
            # operates per object_type; emit one TestSpec per OT.
            seen = set()
            for o in outcomes:
                if o.object_type_id in seen:
                    continue
                seen.add(o.object_type_id)
                plan.append(TestSpec(
                    family=fam_name,
                    feature={"object_type_id": o.object_type_id, "kind": "per_ot"},
                    outcome=o.__dict__,
                    cost_weight=entry.cost_weight,
                ))
                if len(seen) >= budget:
                    break
            continue

        count = 0
        for o in outcomes:
            for f in features:
                if count >= budget:
                    break
                if rule(f, o):
                    plan.append(TestSpec(
                        family=fam_name,
                        feature=f.__dict__,
                        outcome=o.__dict__,
                        cost_weight=entry.cost_weight,
                    ))
                    count += 1
            if count >= budget:
                break

    # Sort by cost_weight ascending so cheap tests run first — better
    # progress under time-limited runs.
    plan.sort(key=lambda t: t.cost_weight)
    return plan
