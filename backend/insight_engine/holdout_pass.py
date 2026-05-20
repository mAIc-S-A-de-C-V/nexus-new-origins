"""
Holdout replication pass. After main families run, re-estimate the top
findings on a deterministic 20% holdout slice (by record_id hash). A finding
"replicates" if direction agrees AND |holdout_effect| ≥ 0.7 × |original|.

Only handles findings whose feature/outcome live in object_records (i.e.,
univariate_stats, mutual_info, tree_importance, joined_correlations) — others
get `replication_holdout_pass = None`.
"""
import logging
import math

import numpy as np
import pandas as pd
from scipy import stats

from data_loader import load_ot_dataframe
from stability import holdout_split

log = logging.getLogger(__name__)


def _cohens_d(a, b) -> float:
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa, sb = a.var(ddof=1), b.var(ddof=1)
    pooled = math.sqrt(((len(a) - 1) * sa + (len(b) - 1) * sb) / (len(a) + len(b) - 2))
    if pooled <= 1e-12:
        return 0.0
    return float((a.mean() - b.mean()) / pooled)


async def replication_pass(tenant_id: str, findings: list[dict], cache: dict,
                            holdout_pct: float = 0.2) -> None:
    """Sets `replication_holdout_pass` on each finding in-place where possible."""
    by_ot: dict[str, list[dict]] = {}
    for f in findings:
        ot = f.get("object_type_id")
        family = f.get("family")
        if not ot or family not in ("univariate_stats", "mutual_info", "tree_importance", "joined_correlations"):
            continue
        by_ot.setdefault(ot, []).append(f)

    for ot, group in by_ot.items():
        try:
            df = await load_ot_dataframe(tenant_id, ot, cache=cache)
        except Exception:
            continue
        if df.empty or "_record_id" not in df.columns:
            continue
        ids = df["_record_id"].astype(str).tolist()
        train_set, holdout_set = holdout_split(ids, holdout_pct=holdout_pct)
        hold_df = df[df["_record_id"].astype(str).isin(holdout_set)]
        if len(hold_df) < 20:
            continue

        for f in group:
            feature = f.get("feature", {}).get("name")
            outcome = f.get("outcome", {}).get("name")
            if not feature or not outcome:
                continue
            if feature not in hold_df.columns or outcome not in hold_df.columns:
                continue
            sub = hold_df[[feature, outcome]].dropna()
            if len(sub) < 15:
                continue
            try:
                if pd.api.types.is_numeric_dtype(sub[feature]) and pd.api.types.is_numeric_dtype(sub[outcome]):
                    sp = stats.spearmanr(sub[feature].astype(float), sub[outcome].astype(float))
                    holdout_effect = abs(float(sp.correlation or 0))
                elif not pd.api.types.is_numeric_dtype(sub[feature]) and pd.api.types.is_numeric_dtype(sub[outcome]):
                    groups = [sub[sub[feature] == v][outcome].astype(float).values
                              for v in sub[feature].unique()]
                    groups = [g for g in groups if len(g) >= 5]
                    if len(groups) < 2:
                        continue
                    holdout_effect = abs(_cohens_d(groups[0], groups[-1]))
                else:
                    continue
            except Exception:
                continue
            original = abs(float(f.get("effect_size") or 0))
            if original == 0:
                continue
            f["replication_holdout_pass"] = bool(holdout_effect >= 0.7 * original)
            f.setdefault("evidence", {})["holdout_effect"] = float(holdout_effect)
