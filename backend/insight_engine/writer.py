"""
Persists insights, applies multiple-testing correction (Benjamini–Hochberg),
enforces effect-size and sample-size floors, and links findings to prior runs
for novelty scoring (Phase 11).
"""
import json
import logging
from sqlalchemy import text

from database import PgSession

log = logging.getLogger(__name__)


def benjamini_hochberg(p_values: list[float], alpha: float = 0.05) -> list[float]:
    """Return BH-adjusted q-values aligned 1:1 with input p_values."""
    n = len(p_values)
    if n == 0:
        return []
    indexed = sorted(enumerate(p_values), key=lambda x: x[1])
    adjusted = [1.0] * n
    prev = 1.0
    for rank in range(n - 1, -1, -1):
        idx, p = indexed[rank]
        q = p * n / (rank + 1)
        if q < prev:
            prev = q
        adjusted[idx] = min(prev, 1.0)
    return adjusted


# Per-metric effect-size floors. Different metrics live on different scales
# (Cohen's d is unbounded above; Cramér's V ∈ [0,1]; mutual_info_normalized
# rarely exceeds 0.4 in practice). The user-configured min_effect_size is
# treated as a multiplier on the per-metric default — set to 1.0 by default,
# so power users can globally tighten or loosen without per-metric editing.
_METRIC_DEFAULT_FLOOR = {
    "cohens_d":                  0.25,
    "cohens_f":                  0.20,
    "rank_biserial":             0.15,
    "spearman_rho":              0.15,
    "pearson_r":                 0.15,
    "cramers_v":                 0.12,
    "mutual_info_normalized":    0.08,
    "permutation_importance":    0.05,
    "lift":                      1.30,  # NOTE: lift is a ratio; gate is "above"
    "rank_lift":                 0.15,
    "logrank_chi2":              0.10,
    "ks_distance":               0.15,
    "iso_forest_outlierness":    0.30,
    "jaccard_overlap":           0.20,
    "cohens_d_psm":              0.20,
    "ate":                       0.10,
}


def _passes_effect_floor(f: dict, user_multiplier: float) -> bool:
    metric = f.get("effect_metric") or ""
    effect = abs(float(f.get("effect_size") or 0.0))
    floor = _METRIC_DEFAULT_FLOOR.get(metric, 0.10) * max(user_multiplier, 1e-6)
    # `lift` is special: it's a ratio, not an effect-size in the same sense.
    if metric == "lift":
        return float(f.get("effect_size") or 0.0) >= floor
    return effect >= floor


def apply_gates(findings: list[dict], cfg: dict) -> tuple[list[dict], dict]:
    """Apply effect/sample/q-value/stability gates. Returns (survivors, drops_summary)."""
    # min_effect_size is now a multiplier on per-metric defaults (default 1.0).
    user_mult = float(cfg.get("min_effect_size") or 1.0)
    min_n = int(cfg.get("min_sample_size") or 0)
    min_stab = float(cfg.get("min_stability_score") or 0.0)

    # BH adjust those with p_value present
    with_p = [(i, f) for i, f in enumerate(findings) if f.get("p_value") is not None]
    if with_p:
        ps = [f["p_value"] for _, f in with_p]
        qs = benjamini_hochberg(ps)
        for (i, f), q in zip(with_p, qs):
            findings[i]["p_adjusted"] = q

    drops: dict = {"effect": 0, "sample": 0, "stability": 0, "padj": 0}
    out = []
    for f in findings:
        if not _passes_effect_floor(f, user_mult):
            drops["effect"] += 1
            continue
        if int(f.get("n") or 0) < min_n:
            drops["sample"] += 1
            continue
        stab = f.get("stability_score")
        if stab is not None and float(stab) < min_stab:
            drops["stability"] += 1
            continue
        if f.get("p_adjusted") is not None and f["p_adjusted"] > 0.1:
            drops["padj"] += 1
            continue
        out.append(f)
    return out, drops


async def write_insights(tenant_id: str, run_id: str, findings: list[dict],
                          keep_top_n: int = 100) -> int:
    """Persist top-N findings to discovered_insights and trim aging-out rows."""
    if not findings:
        return 0
    findings = findings[:keep_top_n]
    async with PgSession() as pg:
        for f in findings:
            await pg.execute(text(
                "INSERT INTO discovered_insights "
                "(tenant_id, run_id, family, object_type_id, outcome_object_type_id, "
                " feature, outcome, n, effect_size, effect_metric, p_value, p_adjusted, "
                " direction, stability_score, replication_holdout_pass, causal_estimate, "
                " rank_score, novelty_score, prior_insight_id, title, description, "
                " recommendation, evidence, status) "
                "VALUES (:t, :r, :fam, :ot, :oot, "
                "        CAST(:feat AS jsonb), CAST(:out AS jsonb), :n, :eff, :em, :p, :pa, "
                "        :dir, :sb, :rh, CAST(:ce AS jsonb), "
                "        :rs, :nv, :prior, :title, :desc, :rec, CAST(:ev AS jsonb), 'new')"
            ), {
                "t": tenant_id, "r": run_id, "fam": f.get("family"),
                "ot": f.get("object_type_id"), "oot": f.get("outcome_object_type_id"),
                "feat": json.dumps(f.get("feature") or {}),
                "out": json.dumps(f.get("outcome") or {}),
                "n": int(f.get("n") or 0),
                "eff": float(f.get("effect_size") or 0.0),
                "em": f.get("effect_metric") or "unknown",
                "p": f.get("p_value"), "pa": f.get("p_adjusted"),
                "dir": f.get("direction"),
                "sb": f.get("stability_score"),
                "rh": f.get("replication_holdout_pass"),
                "ce": json.dumps(f.get("causal_estimate")) if f.get("causal_estimate") else None,
                "rs": float(f.get("rank_score") or 0.0),
                "nv": f.get("novelty_score"),
                "prior": f.get("prior_insight_id"),
                "title": f.get("title") or "Untitled insight",
                "desc": f.get("description") or "",
                "rec": f.get("recommendation"),
                "ev": json.dumps(f.get("evidence") or {}),
            })
        await pg.commit()
    log.info("wrote %d insights for run %s", len(findings), run_id)
    return len(findings)


async def soft_delete_old_insights(tenant_id: str, days: int = 14) -> int:
    """Soft-delete (status='aged') seen insights older than N days. Pinned
    and promoted insights are kept indefinitely."""
    async with PgSession() as pg:
        result = await pg.execute(text(
            "UPDATE discovered_insights SET status = 'aged' "
            "WHERE tenant_id = :t "
            "  AND status IN ('seen', 'new') "
            "  AND discovered_at < NOW() - (:d || ' days')::INTERVAL"
        ), {"t": tenant_id, "d": days})
        await pg.commit()
        return result.rowcount or 0
