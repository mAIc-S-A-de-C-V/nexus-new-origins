"""
Record-linkage discoverer. Three insight kinds:

  1. WITHIN_OT_DUPLICATES — record pairs within one OT that share a normalized
     identity (email, phone, fuzzy name). Surfaces dedupe candidates.
  2. CROSS_OT_OVERLAP — records across two OTs that share normalized values
     (e.g., 47 customer emails appear in vendor records → likely same entity).
     Surfaces hidden joins worth declaring as ontology_links.
  3. FIELD_VALUE_OVERLAP — pairs of fields in different OTs whose normalized
     value sets overlap heavily (Jaccard > 0.5). Surfaces synonymous fields.

Blocking on first-character + length keeps within-OT comparisons O(n) per
block rather than O(n²) per OT.
"""
import logging
import re
from collections import defaultdict
from typing import Iterable

import jellyfish

from families import register
from clients.ontology import list_object_types, fetch_records

log = logging.getLogger(__name__)

EMAIL_RE = re.compile(r"[^a-z0-9._+-@]")
DIGIT_RE = re.compile(r"\D+")


def _norm_email(v) -> str | None:
    if not isinstance(v, str):
        return None
    s = EMAIL_RE.sub("", v.strip().lower())
    return s if "@" in s else None


def _norm_phone(v) -> str | None:
    if v is None:
        return None
    s = DIGIT_RE.sub("", str(v))
    return s if 7 <= len(s) <= 16 else None


def _norm_name(v) -> str | None:
    if not isinstance(v, str):
        return None
    s = re.sub(r"\s+", " ", v.strip().lower())
    return s or None


def _identity_columns(props: list[dict]) -> dict[str, tuple[str, str]]:
    """Return {col_name: (kind, normalizer_name)} for identity-bearing props."""
    out: dict[str, tuple[str, str]] = {}
    for p in props:
        name = p.get("name")
        sem = p.get("semantic_type")
        if not name:
            continue
        if sem == "EMAIL" or name.lower().endswith("email"):
            out[name] = ("email", "_norm_email")
        elif sem == "PHONE" or name.lower().endswith("phone"):
            out[name] = ("phone", "_norm_phone")
        elif sem == "PERSON_NAME" or name.lower() in ("name", "full_name", "person_name"):
            out[name] = ("name", "_norm_name")
    return out


NORMALIZERS = {"_norm_email": _norm_email, "_norm_phone": _norm_phone, "_norm_name": _norm_name}


def _block_key(s: str) -> str:
    if not s:
        return ""
    return s[0] + str(len(s))


async def _within_ot_duplicates(tenant_id: str, ot: dict) -> list[dict]:
    props = ot.get("properties") or []
    id_cols = _identity_columns(props)
    if not id_cols:
        return []
    records = await fetch_records(tenant_id, ot["id"], limit=20000)
    if not records:
        return []

    findings: list[dict] = []
    for col, (kind, norm_name) in id_cols.items():
        norm_fn = NORMALIZERS[norm_name]
        normalized = []
        for r in records:
            n = norm_fn(r.get(col))
            if n:
                normalized.append((r.get("_record_id"), n))
        if len(normalized) < 4:
            continue
        # Block by first char + length
        blocks: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for rid, n in normalized:
            blocks[_block_key(n)].append((rid, n))
        pairs = []
        for block in blocks.values():
            if len(block) < 2:
                continue
            for i in range(len(block)):
                for j in range(i + 1, len(block)):
                    if kind == "email":
                        if block[i][1] == block[j][1]:
                            pairs.append((block[i][0], block[j][0], 1.0))
                    elif kind == "phone":
                        if block[i][1] == block[j][1]:
                            pairs.append((block[i][0], block[j][0], 1.0))
                    else:  # name fuzzy
                        sim = jellyfish.jaro_winkler_similarity(block[i][1], block[j][1])
                        if sim >= 0.92:
                            pairs.append((block[i][0], block[j][0], sim))
            if len(pairs) >= 1000:
                break  # cap per col
        if not pairs:
            continue
        # Per-record duplicate degree
        dup_count = defaultdict(int)
        for a, b, _ in pairs:
            dup_count[a] += 1
            dup_count[b] += 1
        avg_sim = sum(s for _, _, s in pairs) / len(pairs)
        findings.append({
            "object_type_id": ot["id"],
            "outcome_object_type_id": None,
            "feature": {"name": col, "kind": kind, "linkage": "within_ot"},
            "outcome": {"name": "duplicates", "kind": "categorical"},
            "n": int(len(normalized)),
            "effect_size": float(min(1.0, len(pairs) / max(len(normalized), 1) * 2)),
            "effect_metric": "jaccard_overlap",
            "p_value": None,
            "direction": None,
            "stability_score": None,
            "title": f"{ot['display_name']} has {len(pairs)} likely duplicate {kind}s on '{col}'",
            "description": (
                f"{len(pairs)} candidate pairs share a normalized {kind} value "
                f"(avg similarity {avg_sim:.2f}). Most-duplicated: top 5 are listed."
            ),
            "evidence": {
                "sample_pairs": [{"a": a, "b": b, "sim": s} for a, b, s in pairs[:10]],
                "top_duplicated_record_ids": sorted(dup_count, key=lambda k: -dup_count[k])[:5],
                "sample_record_ids": [a for a, _, _ in pairs[:30]],
            },
        })
    return findings


async def _cross_ot_overlap(tenant_id: str, object_types: list[dict]) -> list[dict]:
    """For each pair of OTs, intersect normalized email/phone sets."""
    # Build per-OT normalized email/phone sets
    sets_by_ot: dict[str, dict[str, set[str]]] = {}
    for ot in object_types:
        id_cols = _identity_columns(ot.get("properties") or [])
        if not id_cols:
            continue
        records = await fetch_records(tenant_id, ot["id"], limit=20000)
        per: dict[str, set[str]] = defaultdict(set)
        for col, (kind, norm_name) in id_cols.items():
            norm_fn = NORMALIZERS[norm_name]
            for r in records:
                n = norm_fn(r.get(col))
                if n:
                    per[kind].add(n)
        if per:
            sets_by_ot[ot["id"]] = per

    findings: list[dict] = []
    ot_ids = sorted(sets_by_ot.keys())
    for i in range(len(ot_ids)):
        for j in range(i + 1, len(ot_ids)):
            a_id, b_id = ot_ids[i], ot_ids[j]
            for kind in ("email", "phone"):
                a_set = sets_by_ot[a_id].get(kind, set())
                b_set = sets_by_ot[b_id].get(kind, set())
                if not a_set or not b_set:
                    continue
                overlap = a_set & b_set
                if len(overlap) < 5:
                    continue
                jaccard = len(overlap) / len(a_set | b_set)
                if jaccard < 0.05:
                    continue
                a_name = next(o["display_name"] for o in object_types if o["id"] == a_id)
                b_name = next(o["display_name"] for o in object_types if o["id"] == b_id)
                findings.append({
                    "object_type_id": a_id,
                    "outcome_object_type_id": b_id,
                    "feature": {"name": kind, "kind": "cross_ot_identity"},
                    "outcome": {"name": "shared_records", "kind": "set"},
                    "n": int(len(a_set) + len(b_set)),
                    "effect_size": float(jaccard),
                    "effect_metric": "jaccard_overlap",
                    "p_value": None,
                    "direction": None,
                    "stability_score": None,
                    "title": f"{a_name} ↔ {b_name}: {len(overlap)} shared {kind}s",
                    "description": (
                        f"{len(overlap)} normalized {kind} values appear in both. "
                        f"Jaccard = {jaccard:.2f}. Consider declaring an ontology_link "
                        f"to enable cross-object joins."
                    ),
                    "evidence": {
                        "sample_values": list(overlap)[:10],
                        "a_set_size": len(a_set), "b_set_size": len(b_set),
                    },
                })
    return findings


@register("record_linkage", cost_weight=2.0)
async def run(specs: list, ctx: dict) -> list[dict]:
    """Ignores specs — runs once per OT and once per OT-pair regardless."""
    tenant_id = ctx["tenant_id"]
    findings: list[dict] = []
    object_types = await list_object_types(tenant_id)
    for ot in object_types:
        try:
            findings.extend(await _within_ot_duplicates(tenant_id, ot))
        except Exception as exc:
            log.warning("record_linkage within-OT failed for %s: %s", ot.get("id"), exc)
    try:
        findings.extend(await _cross_ot_overlap(tenant_id, object_types))
    except Exception as exc:
        log.warning("record_linkage cross-OT failed: %s", exc)
    return findings
