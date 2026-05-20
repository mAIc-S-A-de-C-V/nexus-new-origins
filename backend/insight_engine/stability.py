"""
Bootstrap + holdout replication helpers. Phase 5 turns on bootstrap; Phase 11
turns on holdout replication and computes deterministic 80/20 splits.

Every family produces a "raw finding" with an `_estimate(sample)` closure or a
prepared `replication_payload` so stability checks can re-evaluate against a
subset without re-running the entire pipeline.
"""
import hashlib
import random
import statistics
from typing import Callable


def bootstrap_effect(estimate_fn: Callable[[list], float], data: list,
                     iterations: int = 100, seed: int = 0) -> dict:
    """Bootstrap a scalar effect. estimate_fn takes a resampled list and
    returns a float effect. Returns {mean, std, frac_same_sign,
    stability_score}.

    stability_score ∈ [0,1] = fraction of bootstrap estimates with the same
    sign as the point estimate. >=0.95 considered stable."""
    if not data or iterations < 5:
        return {"mean": 0.0, "std": 0.0, "frac_same_sign": 0.0, "stability_score": 0.0}
    rng = random.Random(seed)
    point = estimate_fn(data)
    if point == 0.0:
        return {"mean": 0.0, "std": 0.0, "frac_same_sign": 0.5, "stability_score": 0.5}
    results = []
    n = len(data)
    for _ in range(iterations):
        sample = [data[rng.randrange(n)] for _ in range(n)]
        try:
            results.append(float(estimate_fn(sample)))
        except Exception:
            continue
    if not results:
        return {"mean": 0.0, "std": 0.0, "frac_same_sign": 0.0, "stability_score": 0.0}
    same = sum(1 for r in results if (r >= 0) == (point >= 0))
    frac = same / len(results)
    return {
        "mean": statistics.fmean(results),
        "std": statistics.pstdev(results) if len(results) > 1 else 0.0,
        "frac_same_sign": frac,
        "stability_score": frac,
    }


def holdout_split(record_ids: list[str], holdout_pct: float = 0.2,
                  salt: str = "v1") -> tuple[set[str], set[str]]:
    """Deterministic train/test split by hashing record ids. Stable across
    runs so a 'replicated on holdout' finding stays replicated next run
    (modulo new records). Returns (train_ids, holdout_ids)."""
    train, holdout = set(), set()
    threshold = int(0xFFFFFFFF * (1.0 - holdout_pct))
    for rid in record_ids:
        h = hashlib.sha1(f"{salt}:{rid}".encode()).digest()
        n = int.from_bytes(h[:4], "big")
        if n < threshold:
            train.add(rid)
        else:
            holdout.add(rid)
    return train, holdout


def replication_check(point_effect: float, holdout_effect: float,
                      min_ratio: float = 0.7) -> bool:
    """Holdout replication: pass if direction matches and |holdout| / |point|
    >= min_ratio."""
    if point_effect == 0.0:
        return False
    if (point_effect >= 0) != (holdout_effect >= 0):
        return False
    return abs(holdout_effect) / abs(point_effect) >= min_ratio
