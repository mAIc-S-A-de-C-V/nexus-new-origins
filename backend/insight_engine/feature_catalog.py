"""
Enumerates the (object_type, property) pairs that can serve as **features**
during discovery, with metadata (cardinality, missing rate, dtype, semantic
type, denylist check). The planner consumes this to plan tests.
"""
from dataclasses import dataclass, asdict
from typing import Any
import re

from clients.ontology import list_object_types, fetch_records


DERIVED_DENY_PATTERNS = [
    re.compile(r"(?i)^id$"),
    re.compile(r"(?i)_id$"),
    re.compile(r"(?i)uuid"),
    re.compile(r"(?i)tenant"),
    re.compile(r"(?i)created_at$"),
    re.compile(r"(?i)updated_at$"),
    re.compile(r"(?i)deleted_at$"),
    re.compile(r"(?i)^_"),
]


def _is_denied_by_pattern(name: str) -> bool:
    return any(p.search(name) for p in DERIVED_DENY_PATTERNS)


def _infer_dtype(values: list[Any]) -> str:
    """Best-effort dtype: number / bool / datetime-ish / string."""
    nonnull = [v for v in values if v is not None and v != ""]
    if not nonnull:
        return "empty"
    sample = nonnull[:50]
    if all(isinstance(v, bool) for v in sample):
        return "bool"
    if all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in sample):
        return "number"
    if all(isinstance(v, str) for v in sample):
        # crude date detection
        date_hits = sum(1 for v in sample if re.match(r"^\d{4}-\d{2}-\d{2}", v))
        if date_hits / len(sample) > 0.8:
            return "datetime"
        return "string"
    return "mixed"


@dataclass
class FeatureMeta:
    object_type_id: str
    name: str
    dtype: str
    semantic_type: str | None
    cardinality: int
    missing_rate: float
    n_records: int
    denylisted: bool
    denylist_reason: str | None = None
    role: str = "feature"  # "feature" | "outcome_candidate" | "id_field"

    def to_dict(self) -> dict:
        return asdict(self)


async def build_feature_catalog(tenant_id: str, user_feature_denylist: list[str]) -> list[FeatureMeta]:
    """Walk every object type, sample its records, and build one FeatureMeta
    per (object_type, property)."""
    user_deny = set(user_feature_denylist or [])
    out: list[FeatureMeta] = []
    object_types = await list_object_types(tenant_id)
    for ot in object_types:
        records = await fetch_records(tenant_id, ot["id"], limit=10000)
        n = len(records)
        if n == 0:
            continue
        # Use declared properties (canonical names) plus any keys present in records
        declared_props = {p.get("name"): p for p in (ot.get("properties") or []) if p.get("name")}
        keys = set(declared_props.keys())
        for rec in records:
            for k in rec.keys():
                if k.startswith("_"):
                    continue
                keys.add(k)
        for key in keys:
            values = [rec.get(key) for rec in records]
            nonnull = [v for v in values if v is not None and v != ""]
            cardinality = len(set(
                v if isinstance(v, (str, int, float, bool)) else str(v)
                for v in nonnull
            ))
            missing_rate = 1.0 - (len(nonnull) / max(n, 1))
            dtype = _infer_dtype(values)
            sem = (declared_props.get(key) or {}).get("semantic_type")
            denylisted = False
            reason: str | None = None
            if key in user_deny:
                denylisted = True
                reason = "user_denylist"
            elif _is_denied_by_pattern(key):
                denylisted = True
                reason = "pattern_denylist"
            elif sem == "IDENTIFIER":
                denylisted = True
                reason = "semantic_identifier"
            elif missing_rate > 0.95:
                denylisted = True
                reason = "too_many_missing"
            elif cardinality < 2:
                denylisted = True
                reason = "single_value"
            out.append(FeatureMeta(
                object_type_id=ot["id"], name=key,
                dtype=dtype, semantic_type=sem,
                cardinality=cardinality, missing_rate=missing_rate,
                n_records=n, denylisted=denylisted, denylist_reason=reason,
            ))
    return out
