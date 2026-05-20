"""
IsolationForest per object type. Surfaces specific record IDs that are
outliers across many dimensions (not just one) and attributes the outlier-ness
to the features whose values deviate most from the cluster median.

One finding per outlier (top ~1% per OT, capped at 20 per OT).
"""
import logging

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)


def _encode(df: pd.DataFrame, max_cols: int = 20) -> tuple[np.ndarray, list[str]]:
    cols = []
    parts = []
    for c in df.columns:
        if c.startswith("_"):
            continue
        s = df[c]
        if pd.api.types.is_numeric_dtype(s):
            v = pd.to_numeric(s, errors="coerce")
            if v.isna().all() or v.std() < 1e-9:
                continue
            parts.append(v.fillna(v.median()).values.reshape(-1, 1))
            cols.append(c)
            if len(cols) >= max_cols:
                break
    if not parts:
        return np.zeros((len(df), 0)), cols
    arr = np.hstack(parts)
    # Standardize so contribution attribution is on the same scale
    mu, sd = arr.mean(axis=0), arr.std(axis=0)
    sd[sd < 1e-9] = 1.0
    return (arr - mu) / sd, cols


def _attribute(row: np.ndarray, col_names: list[str], top_k: int = 4) -> list[dict]:
    """Return [{feature, z}] for the top-k most-anomalous z-scores in the row."""
    pairs = sorted(zip(col_names, row), key=lambda p: abs(p[1]), reverse=True)[:top_k]
    return [{"feature": c, "z": float(z)} for c, z in pairs if abs(z) > 1.5]


async def _detect_one_ot(tenant_id: str, ot_id: str, cache: dict) -> list[dict]:
    df = await load_ot_dataframe(tenant_id, ot_id, cache=cache)
    if len(df) < 80:
        return []
    X, cols = _encode(df)
    if X.shape[1] == 0:
        return []
    try:
        iso = IsolationForest(contamination="auto", random_state=0, n_jobs=1).fit(X)
        scores = -iso.score_samples(X)  # higher = more anomalous
    except Exception as exc:
        log.warning("isolation forest failed for %s: %s", ot_id, exc)
        return []

    thresh = float(np.percentile(scores, 99))
    top_idx = np.argsort(-scores)[:20]
    top_idx = [i for i in top_idx if scores[i] >= thresh]

    findings = []
    for i in top_idx:
        rid = df["_record_id"].iloc[i] if "_record_id" in df.columns else str(i)
        attrib = _attribute(X[i], cols)
        normalized = float(min(1.0, max(0.0, (scores[i] - scores.min()) / (scores.max() - scores.min() + 1e-9))))
        findings.append({
            "object_type_id": ot_id,
            "outcome_object_type_id": None,
            "feature": {"name": "record_outlierness", "kind": "iso_forest", "record_id": rid},
            "outcome": {"name": "outlier", "kind": "categorical"},
            "n": int(len(df)),
            "effect_size": normalized,
            "effect_metric": "iso_forest_outlierness",
            "p_value": None,
            "direction": None,
            "stability_score": None,
            "title": f"Outlier record in {ot_id} (score {scores[i]:.2f})",
            "description": (
                "Top attribution: " + ", ".join(f"{a['feature']} (z={a['z']:+.1f})" for a in attrib)
            ) if attrib else "Outlier across multiple features.",
            "evidence": {
                "record_id": rid,
                "attribution": attrib,
                "anomaly_score": float(scores[i]),
                "threshold_99": thresh,
                "sample_record_ids": [rid],
            },
        })
    return findings


@register("anomaly_records", cost_weight=2.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    findings: list[dict] = []
    seen = set()
    for spec in specs:
        ot_id = (spec.outcome or {}).get("object_type_id")
        if not ot_id or ot_id in seen:
            continue
        seen.add(ot_id)
        try:
            findings.extend(await _detect_one_ot(tenant_id, ot_id, cache))
        except Exception as exc:
            log.warning("anomaly_records failed for %s: %s", ot_id, exc)
    return findings
