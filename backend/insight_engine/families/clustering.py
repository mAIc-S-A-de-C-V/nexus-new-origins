"""
UMAP + HDBSCAN per object type. For each discovered cluster, compute its mean
outcome and compare to population mean. If the cluster diverges by > Cohen's d
threshold, surface as an insight ("cluster B has 3.2× cycle time").

When a cluster also has a tight feature signature (e.g., a categorical column
is 90% one value within the cluster), that signature goes into the evidence so
the user can recognize the cohort.
"""
import logging
import math

import numpy as np
import pandas as pd

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)


def _encode_for_clustering(df: pd.DataFrame, max_cols: int = 30) -> tuple[np.ndarray, list[str]]:
    """Keep numeric columns + one-hot top categories of low-cardinality strings.
    Drops columns with > 50% missing. Standardizes numeric columns.
    """
    keep: list[str] = []
    parts: list[np.ndarray] = []

    for col in df.columns:
        if col.startswith("_"):
            continue
        s = df[col]
        miss = s.isna().mean()
        if miss > 0.5:
            continue
        if pd.api.types.is_numeric_dtype(s):
            v = pd.to_numeric(s, errors="coerce").fillna(s.median() if s.notna().any() else 0).values
            std = v.std()
            if std < 1e-9:
                continue
            parts.append(((v - v.mean()) / std).reshape(-1, 1))
            keep.append(col)
        else:
            try:
                top = s.value_counts(dropna=True).head(8)
            except Exception:
                continue
            if len(top) < 2:
                continue
            for val in top.index[:6]:
                onehot = (s.astype(str) == str(val)).astype(float).values
                parts.append(onehot.reshape(-1, 1))
                keep.append(f"{col}={val}")
            if len(keep) >= max_cols:
                break
    if not parts:
        return np.zeros((len(df), 0)), keep
    return np.hstack(parts), keep


def _cluster(X: np.ndarray, n_neighbors: int = 15, min_cluster_size: int = 20) -> np.ndarray:
    if X.shape[0] < min_cluster_size * 2 or X.shape[1] == 0:
        return np.full(X.shape[0], -1)
    try:
        import umap
        reducer = umap.UMAP(n_components=min(5, X.shape[1]),
                             n_neighbors=min(n_neighbors, max(2, X.shape[0] - 1)),
                             random_state=0, n_jobs=1)
        embedding = reducer.fit_transform(X)
    except Exception as exc:
        log.warning("UMAP failed (%s) — falling back to raw features", exc)
        embedding = X
    try:
        import hdbscan
        clu = hdbscan.HDBSCAN(min_cluster_size=min_cluster_size, prediction_data=False)
        labels = clu.fit_predict(embedding)
        return labels
    except Exception as exc:
        log.warning("HDBSCAN failed: %s", exc)
        return np.full(X.shape[0], -1)


def _cluster_signature(df: pd.DataFrame, mask: np.ndarray) -> dict:
    """Top categorical purities within the cluster."""
    sig: dict[str, dict] = {}
    sub = df[mask]
    for col in df.columns:
        if col.startswith("_"):
            continue
        s = sub[col]
        if pd.api.types.is_numeric_dtype(s):
            continue
        if s.dropna().empty:
            continue
        top = s.value_counts(normalize=True).head(1)
        if top.iloc[0] > 0.7 and df[col].value_counts(normalize=True).iloc[0] < 0.6:
            sig[col] = {"value": str(top.index[0]), "in_cluster_pct": float(top.iloc[0] * 100)}
    return sig


def _cohens_d(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 2 or len(b) < 2:
        return 0.0
    sa, sb = a.std(ddof=1), b.std(ddof=1)
    pooled = math.sqrt(((len(a) - 1) * sa ** 2 + (len(b) - 1) * sb ** 2) / (len(a) + len(b) - 2))
    if pooled <= 1e-12:
        return 0.0
    return float((a.mean() - b.mean()) / pooled)


async def _cluster_one_ot(tenant_id: str, ot_id: str, cache: dict) -> list[dict]:
    df = await load_ot_dataframe(tenant_id, ot_id, cache=cache)
    if len(df) < 60:
        return []
    X, kept = _encode_for_clustering(df)
    labels = _cluster(X)
    if labels is None:
        return []
    n_clusters = int(np.unique(labels[labels >= 0]).size)
    if n_clusters < 2:
        return []

    findings: list[dict] = []
    outcome_cols = [c for c in ("cycle_hours", "event_count", "rework_flag", "total_cost") if c in df.columns]
    for cluster_id in range(n_clusters):
        in_mask = labels == cluster_id
        out_mask = (labels != cluster_id) & (labels != -1)
        size = int(in_mask.sum())
        if size < 20:
            continue
        for outcome in outcome_cols:
            a = pd.to_numeric(df[outcome][in_mask], errors="coerce").dropna().values
            b = pd.to_numeric(df[outcome][out_mask], errors="coerce").dropna().values
            if len(a) < 10 or len(b) < 10:
                continue
            d = abs(_cohens_d(a, b))
            if d < 0.25:
                continue
            sig = _cluster_signature(df, in_mask)
            findings.append({
                "object_type_id": ot_id,
                "outcome_object_type_id": None,
                "feature": {"name": f"cluster_{cluster_id}", "kind": "hdbscan_cluster",
                             "signature": sig, "cluster_id": cluster_id,
                             "encoded_features": kept[:8]},
                "outcome": {"name": outcome, "kind": "numeric"},
                "n": int(size + (out_mask.sum())),
                "effect_size": float(d),
                "effect_metric": "cohens_d",
                "p_value": None,
                "direction": "higher" if a.mean() > b.mean() else "lower",
                "stability_score": None,
                "title": f"Cluster {cluster_id} differs on {outcome} (n={size})",
                "description": (
                    f"Mean {outcome} in cluster: {a.mean():.2f} vs rest: {b.mean():.2f} "
                    f"(d={d:.2f}). Signature: {sig if sig else 'numeric-driven'}."
                ),
                "evidence": {
                    "cluster_mean": float(a.mean()), "rest_mean": float(b.mean()),
                    "cluster_n": size, "rest_n": int(out_mask.sum()),
                    "signature": sig,
                },
            })
    return findings


@register("clustering", cost_weight=3.0)
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
            findings.extend(await _cluster_one_ot(tenant_id, ot_id, cache))
        except Exception as exc:
            log.warning("clustering failed for %s: %s", ot_id, exc)
    return findings
