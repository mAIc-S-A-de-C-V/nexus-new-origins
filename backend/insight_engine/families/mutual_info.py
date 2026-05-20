"""
Mutual-information scan — catches non-linear univariate relationships that
univariate_stats can miss (e.g., U-shaped). Reports the MI as the effect and
flags findings where MI is materially larger than |Spearman ρ|², which is the
non-linearity signature.

Computed via sklearn's mutual_info_classif (categorical target) /
mutual_info_regression (numeric target). Normalized to [0,1] by dividing by
the target's entropy (numeric: differential entropy approximation; categorical:
Shannon entropy).
"""
import logging
import math

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.feature_selection import mutual_info_classif, mutual_info_regression
from sklearn.preprocessing import LabelEncoder

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)


def _shannon_entropy(s: pd.Series) -> float:
    p = s.value_counts(normalize=True).values
    p = p[p > 0]
    return float(-(p * np.log(p)).sum())


def _build_X(values: pd.Series) -> tuple[np.ndarray, bool]:
    """Returns (X column, is_discrete). Encodes categorical with LabelEncoder."""
    if pd.api.types.is_numeric_dtype(values):
        return np.asarray(values, dtype=float).reshape(-1, 1), False
    le = LabelEncoder()
    encoded = le.fit_transform(values.astype(str))
    return encoded.reshape(-1, 1), True


async def _eval_pair(df: pd.DataFrame, feature_name: str, outcome_name: str,
                     object_type_id: str, outcome_object_type_id: str | None) -> dict | None:
    if feature_name not in df.columns or outcome_name not in df.columns:
        return None
    sub = df[[feature_name, outcome_name]].dropna()
    if len(sub) < 30:
        return None

    try:
        X, is_discrete_X = _build_X(sub[feature_name])
        y = sub[outcome_name]
    except Exception:
        return None

    if pd.api.types.is_numeric_dtype(y):
        try:
            mi = mutual_info_regression(X, y.astype(float), discrete_features=[is_discrete_X], random_state=0)[0]
        except Exception:
            return None
        ent = float(np.log(max(y.std(), 1e-9)) + 0.5 * (1 + math.log(2 * math.pi)))
        # |spearman| comparison
        try:
            if not is_discrete_X:
                sp = stats.spearmanr(sub[feature_name].astype(float), y.astype(float))
                sp_sq = sp.correlation ** 2 if sp.correlation == sp.correlation else 0.0
            else:
                sp_sq = 0.0
        except Exception:
            sp_sq = 0.0
        non_lin = mi - max(sp_sq, 0) * abs(ent)
        normalized = float(mi / (abs(ent) + 1e-6))
        is_non_lin = bool(non_lin > 0.1 * max(mi, 1e-6) and not is_discrete_X)
        return {
            "object_type_id": object_type_id,
            "outcome_object_type_id": outcome_object_type_id,
            "feature": {"name": feature_name, "type": "categorical" if is_discrete_X else "numeric"},
            "outcome": {"name": outcome_name, "type": "numeric"},
            "n": int(len(sub)),
            "effect_size": float(min(1.0, max(0.0, normalized))),
            "effect_metric": "mutual_info_normalized",
            "p_value": None,
            "direction": None,
            "stability_score": None,
            "title": (f"{feature_name} non-linearly drives {outcome_name}" if is_non_lin else
                       f"{feature_name} drives {outcome_name} (mutual info)"),
            "description": (
                f"MI = {mi:.3f}; normalized ≈ {normalized:.3f}; n = {len(sub)}."
                + (" Flagged as non-linear (Spearman misses it)." if is_non_lin else "")
            ),
            "evidence": {"mutual_info_raw": float(mi), "spearman_sq": float(sp_sq),
                          "non_linear": is_non_lin},
        }
    else:
        try:
            y_enc = LabelEncoder().fit_transform(y.astype(str))
            mi = mutual_info_classif(X, y_enc, discrete_features=[is_discrete_X], random_state=0)[0]
        except Exception:
            return None
        ent = _shannon_entropy(y)
        normalized = float(mi / (ent + 1e-6))
        return {
            "object_type_id": object_type_id,
            "outcome_object_type_id": outcome_object_type_id,
            "feature": {"name": feature_name, "type": "categorical" if is_discrete_X else "numeric"},
            "outcome": {"name": outcome_name, "type": "categorical"},
            "n": int(len(sub)),
            "effect_size": float(min(1.0, max(0.0, normalized))),
            "effect_metric": "mutual_info_normalized",
            "p_value": None,
            "direction": None,
            "stability_score": None,
            "title": f"{feature_name} carries information about {outcome_name}",
            "description": f"MI/H(y) = {normalized:.3f}; n = {len(sub)}.",
            "evidence": {"mutual_info_raw": float(mi), "target_entropy": ent},
        }


@register("mutual_info", cost_weight=1.2)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    findings: list[dict] = []
    seen = set()
    for spec in specs:
        feature = spec.feature
        outcome = spec.outcome
        ot = feature.get("object_type_id") or outcome.get("object_type_id")
        if not ot:
            continue
        try:
            df = await load_ot_dataframe(tenant_id, ot, cache=cache)
        except Exception as exc:
            log.warning("MI loader failed for %s: %s", ot, exc)
            continue
        if df.empty:
            continue
        key = (ot, feature.get("name"), outcome.get("name"))
        if key in seen:
            continue
        seen.add(key)
        f = await _eval_pair(df, feature.get("name"), outcome.get("name"),
                              object_type_id=ot,
                              outcome_object_type_id=outcome.get("object_type_id"))
        if f:
            findings.append(f)
    return findings
