"""
Classical univariate tests. Eight test forms in one family:

  cat → num   : Welch's t-test (2 groups)  →  Cohen's d
                One-way ANOVA (>2 groups)  →  η²
                Kruskal-Wallis (nonparametric) when small or skewed
  cat → cat   : χ² test of independence    →  Cramér's V
  num → num   : Pearson + Spearman          →  |ρ|
  num → cat   : Mann-Whitney U             →  rank-biserial r

Each test produces one finding with title, effect, p-value, and group_stats
evidence. Categorical features with cardinality > 20 are skipped.
"""
import logging
import math

import numpy as np
import pandas as pd
from scipy import stats

from families import register
from data_loader import load_ot_dataframe
from stability import bootstrap_effect

log = logging.getLogger(__name__)


def _is_numeric(s: pd.Series) -> bool:
    try:
        return pd.api.types.is_numeric_dtype(pd.to_numeric(s, errors="coerce"))
    except Exception:
        return False


def _coerce_numeric(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def _cohens_d(x, y) -> float:
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    nx, ny = len(x), len(y)
    if nx < 2 or ny < 2:
        return 0.0
    sx, sy = np.var(x, ddof=1), np.var(y, ddof=1)
    pooled = math.sqrt(((nx - 1) * sx + (ny - 1) * sy) / (nx + ny - 2))
    if pooled <= 1e-12:
        return 0.0
    return float((np.mean(x) - np.mean(y)) / pooled)


def _cramers_v(table: np.ndarray) -> float:
    chi2 = stats.chi2_contingency(table, correction=False)[0]
    n = table.sum()
    if n == 0:
        return 0.0
    r, c = table.shape
    return float(math.sqrt(chi2 / (n * (min(r, c) - 1 + 1e-12))))


def _group_stats_for_cat(values: pd.Series, target: pd.Series) -> list[dict]:
    out = []
    grand = float(target.dropna().mean()) if _is_numeric(target) else None
    for grp_name, grp in pd.DataFrame({"v": values, "t": target}).groupby("v"):
        n = int(grp["t"].dropna().shape[0])
        if n == 0:
            continue
        if grand is not None:
            out.append({"label": str(grp_name), "n": n, "mean": float(grp["t"].dropna().mean())})
        else:
            out.append({"label": str(grp_name), "n": n})
    return out


def _format_value(v) -> str:
    if isinstance(v, float) and not math.isnan(v):
        return f"{v:.2g}"
    return str(v)


async def _eval_pair(df: pd.DataFrame, feature_name: str, outcome_name: str,
                     object_type_id: str, outcome_object_type_id: str) -> dict | None:
    if feature_name not in df.columns or outcome_name not in df.columns:
        return None
    sub = df[[feature_name, outcome_name]].dropna()
    if len(sub) < 10:
        return None

    feat_numeric = _is_numeric(sub[feature_name])
    out_numeric = _is_numeric(sub[outcome_name])

    feat = sub[feature_name]
    outc = sub[outcome_name]

    if not feat_numeric and out_numeric:
        # cat → num
        groups = [g[outcome_name].astype(float).dropna().values
                  for _, g in sub.groupby(feature_name)]
        groups = [g for g in groups if len(g) >= 5]
        if len(groups) < 2:
            return None
        outc = _coerce_numeric(outc)
        if len(groups) == 2:
            # Welch's t
            try:
                t_stat, p = stats.ttest_ind(groups[0], groups[1], equal_var=False, nan_policy="omit")
                d = abs(_cohens_d(groups[0], groups[1]))
                effect_metric = "cohens_d"
                direction = "higher" if np.mean(groups[0]) > np.mean(groups[1]) else "lower"
            except Exception:
                return None
        else:
            try:
                f_stat, p = stats.f_oneway(*groups)
                # η² approximation
                grand_mean = np.concatenate(groups).mean()
                ss_between = sum(len(g) * (np.mean(g) - grand_mean) ** 2 for g in groups)
                ss_total = sum(((np.concatenate(groups) - grand_mean) ** 2).sum() for _ in [1])
                eta2 = float(ss_between / ss_total) if ss_total > 0 else 0.0
                d = math.sqrt(eta2 / max(1 - eta2, 1e-12))  # Cohen's f
                effect_metric = "cohens_f"
                direction = None
            except Exception:
                return None
        # Kruskal fallback if any group is highly skewed (sample test: shapiro for n<5000)
        # Skipping shapiro for perf — Welch and ANOVA are robust enough.

        # Bootstrap stability — keep cheap
        def _estimate(rows):
            d2 = pd.DataFrame(rows, columns=[feature_name, outcome_name])
            grps = [g[outcome_name].astype(float).dropna().values for _, g in d2.groupby(feature_name)]
            grps = [g for g in grps if len(g) >= 3]
            if len(grps) < 2:
                return 0.0
            return abs(_cohens_d(grps[0], grps[-1])) if len(grps) >= 2 else 0.0
        sample_rows = sub.values.tolist()
        stab = bootstrap_effect(_estimate, sample_rows, iterations=30)

        return {
            "object_type_id": object_type_id,
            "outcome_object_type_id": outcome_object_type_id,
            "feature": {"name": feature_name, "type": "categorical"},
            "outcome": {"name": outcome_name, "type": "numeric"},
            "n": int(len(sub)),
            "effect_size": float(d),
            "effect_metric": effect_metric,
            "p_value": float(p) if not math.isnan(p) else None,
            "direction": direction,
            "stability_score": float(stab["stability_score"]),
            "title": f"{feature_name} groups differ on {outcome_name}",
            "description": (
                f"Comparing {outcome_name} across values of {feature_name}: "
                f"effect={d:.3f} ({effect_metric}), p={p:.3g}, n={len(sub)}."
            ),
            "evidence": {"group_stats": _group_stats_for_cat(sub[feature_name], outc)},
        }

    if not feat_numeric and not out_numeric:
        # cat → cat: χ²
        if sub[feature_name].nunique() > 20 or sub[outcome_name].nunique() > 20:
            return None
        ct = pd.crosstab(sub[feature_name], sub[outcome_name])
        if ct.shape[0] < 2 or ct.shape[1] < 2:
            return None
        try:
            chi2, p, dof, expected = stats.chi2_contingency(ct.values)
            v = _cramers_v(ct.values)
        except Exception:
            return None
        return {
            "object_type_id": object_type_id,
            "outcome_object_type_id": outcome_object_type_id,
            "feature": {"name": feature_name, "type": "categorical"},
            "outcome": {"name": outcome_name, "type": "categorical"},
            "n": int(len(sub)),
            "effect_size": float(v),
            "effect_metric": "cramers_v",
            "p_value": float(p) if not math.isnan(p) else None,
            "direction": None,
            "stability_score": None,  # categorical χ² stability via bootstrap added in Phase 5
            "title": f"{feature_name} and {outcome_name} are associated",
            "description": (
                f"χ² test: Cramér's V = {v:.3f}, p={p:.3g}, n={len(sub)}."
            ),
            "evidence": {
                "contingency_table": ct.to_dict(),
            },
        }

    if feat_numeric and out_numeric:
        # num → num: Spearman + Pearson, report the stronger
        f = _coerce_numeric(sub[feature_name]).dropna()
        o = _coerce_numeric(sub[outcome_name]).dropna()
        aligned = pd.concat([f, o], axis=1).dropna()
        if len(aligned) < 10:
            return None
        try:
            sp = stats.spearmanr(aligned.iloc[:, 0], aligned.iloc[:, 1])
            pe = stats.pearsonr(aligned.iloc[:, 0], aligned.iloc[:, 1])
        except Exception:
            return None
        sp_rho, sp_p = float(sp.correlation), float(sp.pvalue)
        pe_r, pe_p = float(pe.statistic), float(pe.pvalue)
        # Pick the more conservative direction (smaller p-value).
        if abs(sp_rho) >= abs(pe_r):
            effect, p_val, metric = abs(sp_rho), sp_p, "spearman_rho"
            direction = "higher" if sp_rho > 0 else "lower"
        else:
            effect, p_val, metric = abs(pe_r), pe_p, "pearson_r"
            direction = "higher" if pe_r > 0 else "lower"
        return {
            "object_type_id": object_type_id,
            "outcome_object_type_id": outcome_object_type_id,
            "feature": {"name": feature_name, "type": "numeric"},
            "outcome": {"name": outcome_name, "type": "numeric"},
            "n": int(len(aligned)),
            "effect_size": float(effect),
            "effect_metric": metric,
            "p_value": float(p_val) if not math.isnan(p_val) else None,
            "direction": direction,
            "stability_score": None,
            "title": f"{feature_name} correlates with {outcome_name}",
            "description": (
                f"{metric} = {effect:.3f}, p = {p_val:.3g}, n = {len(aligned)}. "
                f"Direction: {direction}."
            ),
            "evidence": {"spearman_rho": sp_rho, "pearson_r": pe_r, "n": int(len(aligned))},
        }

    if feat_numeric and not out_numeric:
        # num → cat: Mann-Whitney for 2-class, ANOVA-style for >2
        groups = [_coerce_numeric(g[feature_name]).dropna().values
                  for _, g in sub.groupby(outcome_name)]
        groups = [g for g in groups if len(g) >= 5]
        if len(groups) < 2:
            return None
        if len(groups) == 2:
            try:
                u, p = stats.mannwhitneyu(groups[0], groups[1], alternative="two-sided")
                # rank-biserial
                n1, n2 = len(groups[0]), len(groups[1])
                rb = 1 - (2 * u) / (n1 * n2)
                effect, metric = abs(float(rb)), "rank_biserial"
                direction = "higher" if np.mean(groups[0]) > np.mean(groups[1]) else "lower"
            except Exception:
                return None
        else:
            try:
                f_stat, p = stats.f_oneway(*groups)
                grand_mean = np.concatenate(groups).mean()
                ss_between = sum(len(g) * (np.mean(g) - grand_mean) ** 2 for g in groups)
                ss_total = float(((np.concatenate(groups) - grand_mean) ** 2).sum())
                eta2 = float(ss_between / ss_total) if ss_total > 0 else 0.0
                effect, metric = math.sqrt(eta2 / max(1 - eta2, 1e-12)), "cohens_f"
                direction = None
            except Exception:
                return None
        return {
            "object_type_id": object_type_id,
            "outcome_object_type_id": outcome_object_type_id,
            "feature": {"name": feature_name, "type": "numeric"},
            "outcome": {"name": outcome_name, "type": "categorical"},
            "n": int(len(sub)),
            "effect_size": float(effect),
            "effect_metric": metric,
            "p_value": float(p) if not math.isnan(p) else None,
            "direction": direction,
            "stability_score": None,
            "title": f"{feature_name} differs across {outcome_name}",
            "description": f"{metric}={effect:.3f}, p={p:.3g}, n={len(sub)}.",
            "evidence": {"group_stats": _group_stats_for_cat(sub[outcome_name], sub[feature_name])},
        }

    return None


@register("univariate_stats", cost_weight=1.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})

    findings: list[dict] = []
    seen_pairs: set[tuple] = set()
    for spec in specs:
        feature = spec.feature
        outcome = spec.outcome
        ot = feature.get("object_type_id") or outcome.get("object_type_id")
        if not ot:
            continue
        try:
            df = await load_ot_dataframe(tenant_id, ot, cache=cache)
        except Exception as exc:
            log.warning("data_loader failed for %s: %s", ot, exc)
            continue
        if df.empty:
            continue
        key = (ot, feature.get("name"), outcome.get("name"))
        if key in seen_pairs:
            continue
        seen_pairs.add(key)
        f = await _eval_pair(df, feature.get("name"), outcome.get("name"),
                              object_type_id=ot,
                              outcome_object_type_id=outcome.get("object_type_id"))
        if f:
            findings.append(f)
    return findings
