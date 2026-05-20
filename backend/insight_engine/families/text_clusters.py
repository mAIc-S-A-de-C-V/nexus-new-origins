"""
Text-embedding clustering. Gated by `embeddings_enabled` in config and the
sentence-transformers package being installed (lazy import). Off by default
because the model weights add ~100MB and embedding 5000 rows takes ~10s.

For each text column whose average length > 30:
  - Sample up to 5000 records, embed with `all-MiniLM-L6-v2`
  - HDBSCAN clusters on the embedding
  - For each cluster, compute outcome stats and TF-IDF top tokens
  - Emit a finding when cluster outcome differs from population (Cohen's d ≥ 0.3)
"""
import logging
import re
from collections import Counter

import numpy as np
import pandas as pd

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)

# Lazy holder so we only try the import when the family actually runs.
_st = None
_hdb = None


def _try_load_models() -> bool:
    global _st, _hdb
    if _st is not None and _hdb is not None:
        return True
    try:
        from sentence_transformers import SentenceTransformer  # type: ignore
        import hdbscan as _h
        _st = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        _hdb = _h
        return True
    except Exception as exc:
        log.info("sentence-transformers / hdbscan unavailable for text_clusters: %s", exc)
        return False


def _top_tokens(texts: list[str], top_k: int = 8) -> list[str]:
    tokens: list[str] = []
    for t in texts:
        for tok in re.findall(r"[a-zA-Z]{3,}", (t or "").lower()):
            tokens.append(tok)
    stop = {"the", "and", "for", "with", "from", "this", "that", "have", "are", "was", "but", "you", "your", "not", "they", "all", "any", "can"}
    counts = Counter(t for t in tokens if t not in stop)
    return [w for w, _ in counts.most_common(top_k)]


@register("text_clusters", cost_weight=4.0, requires=("embeddings_enabled",))
async def run(specs: list, ctx: dict) -> list[dict]:
    if not _try_load_models():
        return []
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    findings: list[dict] = []
    seen_ot = set()

    for spec in specs:
        ot_id = (spec.outcome or {}).get("object_type_id")
        if not ot_id or ot_id in seen_ot:
            continue
        seen_ot.add(ot_id)
        try:
            df = await load_ot_dataframe(tenant_id, ot_id, cache=cache)
        except Exception:
            continue
        if df.empty:
            continue

        text_cols = []
        for c in df.columns:
            if c.startswith("_"):
                continue
            s = df[c]
            if pd.api.types.is_numeric_dtype(s):
                continue
            try:
                avg_len = s.dropna().astype(str).str.len().mean()
            except Exception:
                continue
            if avg_len and avg_len > 30:
                text_cols.append(c)
        if not text_cols:
            continue

        outcome_cols = [c for c in df.columns if c in ("cycle_hours", "event_count", "rework_flag", "total_cost") and df[c].notna().sum() > 50]

        for tc in text_cols:
            texts = df[tc].dropna().astype(str).tolist()
            if len(texts) < 60:
                continue
            sample = texts[:5000]
            try:
                emb = _st.encode(sample, show_progress_bar=False)
            except Exception as exc:
                log.warning("embedding failed for %s/%s: %s", ot_id, tc, exc)
                continue
            try:
                clu = _hdb.HDBSCAN(min_cluster_size=max(15, len(sample) // 50))
                labels = clu.fit_predict(emb)
            except Exception as exc:
                log.warning("HDBSCAN on embeddings failed: %s", exc)
                continue
            valid = labels >= 0
            if valid.sum() == 0:
                continue
            sample_idx_of_df = df.index[df[tc].notna()][:len(sample)]
            label_series = pd.Series(labels, index=sample_idx_of_df[:len(labels)])
            df_lbl = df.loc[label_series.index]
            df_lbl["_cluster"] = label_series.values
            for cluster_id in sorted(set(labels[valid])):
                mask = df_lbl["_cluster"] == cluster_id
                size = int(mask.sum())
                if size < 15:
                    continue
                tokens = _top_tokens(df_lbl.loc[mask, tc].dropna().astype(str).tolist())
                for outcome in outcome_cols:
                    in_v = pd.to_numeric(df_lbl.loc[mask, outcome], errors="coerce").dropna().values
                    out_v = pd.to_numeric(df_lbl.loc[~mask, outcome], errors="coerce").dropna().values
                    if len(in_v) < 10 or len(out_v) < 10:
                        continue
                    sa, sb = in_v.std(ddof=1), out_v.std(ddof=1)
                    import math
                    pooled = math.sqrt(((len(in_v) - 1) * sa**2 + (len(out_v) - 1) * sb**2) / (len(in_v) + len(out_v) - 2))
                    if pooled <= 1e-9:
                        continue
                    d = abs((in_v.mean() - out_v.mean()) / pooled)
                    if d < 0.3:
                        continue
                    findings.append({
                        "object_type_id": ot_id,
                        "outcome_object_type_id": None,
                        "feature": {"name": f"{tc}_cluster_{cluster_id}",
                                     "kind": "text_cluster", "tokens": tokens, "cluster_id": int(cluster_id),
                                     "text_column": tc},
                        "outcome": {"name": outcome, "kind": "numeric"},
                        "n": int(len(in_v) + len(out_v)),
                        "effect_size": float(d),
                        "effect_metric": "cohens_d",
                        "p_value": None,
                        "direction": "higher" if in_v.mean() > out_v.mean() else "lower",
                        "stability_score": None,
                        "title": (
                            f"Text cluster in '{tc}' ({', '.join(tokens[:3])}) "
                            f"differs on {outcome}"
                        ),
                        "description": (
                            f"Cluster of {size} records (themes: {', '.join(tokens[:6])}): "
                            f"{outcome} mean {in_v.mean():.2f} vs population {out_v.mean():.2f} (d={d:.2f})."
                        ),
                        "evidence": {
                            "top_tokens": tokens, "cluster_n": size,
                            "in_mean": float(in_v.mean()), "out_mean": float(out_v.mean()),
                        },
                    })
    return findings
