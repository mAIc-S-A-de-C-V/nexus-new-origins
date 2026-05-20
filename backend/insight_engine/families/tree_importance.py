"""
Tree-based feature importance. One LightGBM model per (object_type, outcome)
trained over the full feature matrix; emits one finding per top-K feature
whose permutation importance exceeds the 95th-percentile null permutation.

LightGBM is robust to missing values, mixed dtypes (after one-hot for
small-cardinality strings), and gives us interaction-aware importance for
"free" — features that matter only in combination with others surface here
but stay invisible to univariate tests.
"""
import logging
import math

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder

from families import register
from data_loader import load_ot_dataframe

log = logging.getLogger(__name__)

try:
    import lightgbm as lgb
except Exception:  # pragma: no cover - module-level fallback
    lgb = None


def _prepare_xy(df: pd.DataFrame, outcome_name: str,
                 feature_names: list[str]) -> tuple[pd.DataFrame, pd.Series, str, list[str]] | None:
    if outcome_name not in df.columns:
        return None
    y_raw = df[outcome_name]
    feature_names = [c for c in feature_names if c in df.columns and c != outcome_name]
    if not feature_names:
        return None

    X = df[feature_names].copy()
    # Encode object/string columns to category codes
    cat_cols = []
    for col in X.columns:
        if not pd.api.types.is_numeric_dtype(X[col]):
            X[col] = X[col].astype("category")
            cat_cols.append(col)

    if pd.api.types.is_numeric_dtype(y_raw):
        y = pd.to_numeric(y_raw, errors="coerce")
        kind = "regression"
    else:
        y = pd.Series(LabelEncoder().fit_transform(y_raw.astype(str)), index=y_raw.index)
        kind = "classification"

    keep = X.dropna(how="all").index.intersection(y.dropna().index)
    X = X.loc[keep]
    y = y.loc[keep]
    return X, y, kind, cat_cols


def _permutation_importance(model, X: pd.DataFrame, y: pd.Series,
                              kind: str, n_repeats: int = 5, seed: int = 0) -> dict[str, float]:
    rng = np.random.default_rng(seed)
    if kind == "regression":
        base = model.predict(X)
        base_loss = float(((base - y) ** 2).mean())
    else:
        base_loss = float((np.argmax(model.predict_proba(X), axis=1) != y).mean())
    out: dict[str, float] = {}
    for col in X.columns:
        loss_diffs = []
        original = X[col].copy()
        for _ in range(n_repeats):
            perm = rng.permutation(len(X))
            X[col] = X[col].iloc[perm].values
            if kind == "regression":
                p = model.predict(X)
                loss = float(((p - y) ** 2).mean())
            else:
                loss = float((np.argmax(model.predict_proba(X), axis=1) != y).mean())
            loss_diffs.append(loss - base_loss)
        X[col] = original
        out[col] = float(np.mean(loss_diffs))
    return out


async def _train_and_score(df: pd.DataFrame, outcome_name: str,
                            object_type_id: str) -> list[dict]:
    if lgb is None:
        return []

    feature_names = [c for c in df.columns
                     if c not in (outcome_name, "_record_id", "_source_id", "_case_id")]
    prep = _prepare_xy(df, outcome_name, feature_names)
    if prep is None:
        return []
    X, y, kind, cat_cols = prep
    if len(X) < 50 or X.shape[1] == 0:
        return []

    try:
        if kind == "regression":
            model = lgb.LGBMRegressor(
                n_estimators=200, learning_rate=0.05,
                min_data_in_leaf=20, feature_fraction=0.9,
                verbose=-1,
            )
        else:
            n_classes = int(y.nunique())
            if n_classes < 2:
                return []
            model = lgb.LGBMClassifier(
                n_estimators=200, learning_rate=0.05,
                min_data_in_leaf=20, feature_fraction=0.9,
                verbose=-1,
            )
        model.fit(X, y, categorical_feature=cat_cols)
    except Exception as exc:
        log.warning("LightGBM fit failed for %s on %s: %s", object_type_id, outcome_name, exc)
        return []

    # Permutation importance with one null permutation per feature for floor
    perm = _permutation_importance(model, X.copy(), y, kind, n_repeats=3)
    # Null: shuffle y and re-fit a tiny model just to get a baseline noise level
    try:
        y_null = pd.Series(np.random.permutation(y.values), index=y.index)
        if kind == "regression":
            null_model = lgb.LGBMRegressor(n_estimators=80, verbose=-1)
        else:
            null_model = lgb.LGBMClassifier(n_estimators=80, verbose=-1)
        null_model.fit(X, y_null, categorical_feature=cat_cols)
        null_perm = _permutation_importance(null_model, X.copy(), y_null, kind, n_repeats=2)
        null_threshold = float(np.percentile(list(null_perm.values()), 95))
    except Exception:
        null_threshold = 0.0

    findings: list[dict] = []
    for feat, imp in perm.items():
        if imp <= null_threshold:
            continue
        scaled = float(min(1.0, max(0.0, imp / (abs(null_threshold) + abs(imp) + 1e-6))))
        findings.append({
            "object_type_id": object_type_id,
            "outcome_object_type_id": None,
            "feature": {"name": feat, "kind": "lgb_feature"},
            "outcome": {"name": outcome_name, "kind": kind},
            "n": int(len(X)),
            "effect_size": scaled,
            "effect_metric": "permutation_importance",
            "p_value": None,
            "direction": None,
            "stability_score": None,
            "title": f"{feat} drives {outcome_name} (LightGBM importance)",
            "description": (
                f"Permutation importance Δloss = {imp:.4f}, null 95% = "
                f"{null_threshold:.4f}, n = {len(X)}."
            ),
            "evidence": {
                "permutation_importance": imp,
                "null_threshold_95": null_threshold,
                "kind": kind,
                "all_importances": {k: float(v) for k, v in perm.items()},
            },
        })

    # Keep at most top-10 features per outcome to control noise
    findings.sort(key=lambda f: f["effect_size"], reverse=True)
    return findings[:10]


@register("tree_importance", cost_weight=4.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    tenant_id = ctx["tenant_id"]
    cache: dict = ctx.setdefault("ot_cache", {})
    findings: list[dict] = []
    seen = set()
    for spec in specs:
        outcome = spec.outcome
        ot = outcome.get("object_type_id")
        outcome_name = outcome.get("name")
        if not ot or not outcome_name:
            continue
        key = (ot, outcome_name)
        if key in seen:
            continue
        seen.add(key)
        try:
            df = await load_ot_dataframe(tenant_id, ot, cache=cache)
        except Exception as exc:
            log.warning("tree loader failed for %s: %s", ot, exc)
            continue
        if df.empty:
            continue
        findings.extend(await _train_and_score(df, outcome_name, ot))
    return findings
