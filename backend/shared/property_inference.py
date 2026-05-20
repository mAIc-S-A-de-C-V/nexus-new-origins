"""
Heuristic property inference from sample records.

Given a list of dicts (sample rows from a connector, OT, or pasted JSON),
return a list of ObjectType-property suggestions: name + data_type +
semantic_type + sample_values + required + nullable.

Pure-Python, no LLM. Fast (~100 rows in <50ms). Callers can present the
result as a "Suggested properties" table that the user accepts/edits/rejects
before creating or extending an ObjectType.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any


# Field-name patterns → semantic type. First match wins. Lowercased + stripped
# before matching. Order matters (more specific before less specific).
_NAME_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"^(id|uuid|guid|key)$"), "IDENTIFIER"),
    # Catches `idKey`, `idSexo`, `idApplicant`, `user_id`, `account_id`, etc.
    # Name is lowercased before matching, so `idK` becomes `idk`; check for
    # `^id` + at least one more letter (excluding common false-positives).
    (re.compile(r"(_id$|^id_|_uuid|^id[a-z]|^id\d|nie$|codigo)"), "IDENTIFIER"),
    (re.compile(r"(^|_)(email|e_mail|mail)($|_)"), "EMAIL"),
    (re.compile(r"(^|_)(phone|tel|mobile|celular|movil)"), "PHONE"),
    (re.compile(r"(^|_)(url|link|href|website|site)($|_)"), "URL"),
    (re.compile(r"(^|_)(foto|photo|image|img|avatar|picture)"), "URL"),
    (re.compile(r"(^|_)(name|nombre|first|last|primer|apellido|surname)"), "PERSON_NAME"),
    (re.compile(r"(^|_)(address|direccion|street|calle)"), "ADDRESS"),
    (re.compile(r"(^|_)(amount|price|cost|total|monto|precio|costo|fee)"), "CURRENCY"),
    (re.compile(r"(^|_)(qty|quantity|count|cantidad|num)"), "QUANTITY"),
    (re.compile(r"(^|_)(percent|pct|rate|ratio)"), "PERCENTAGE"),
    (re.compile(r"(^|_)(status|estado|state)($|_)"), "STATUS"),
    (re.compile(r"(^|_)(category|categoria|type|tipo|kind|class)"), "CATEGORY"),
    (re.compile(r"(^|_)(date|fecha|day)($|_)"), "DATE"),
    (re.compile(r"(^|_)(at|datetime|timestamp|created|updated|modified|modifica)"), "DATETIME"),
]

_EMAIL_RE = re.compile(r"^[\w.+-]+@[\w-]+\.[\w.-]+$")
_URL_RE = re.compile(r"^https?://", re.IGNORECASE)
# A phone needs either a `+` prefix OR formatting punctuation, AND 8+
# digits total. A naked "2362177" (7-digit ID code) shouldn't qualify.
_PHONE_RE = re.compile(r"^(\+\d[\d\s\-().]{6,}|\d{2,}[\s\-()][\d\s\-().]{4,})$")
_ISO_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}")
_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DDMMYYYY_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def _python_to_data_type(v: Any) -> str:
    """Pick a coarse JSON-Schema-ish data_type for one value."""
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "boolean"
    if isinstance(v, int):
        return "integer"
    if isinstance(v, float):
        return "number"
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return "string"
        if _ISO_DATETIME_RE.match(s):
            return "datetime"
        if _ISO_DATE_RE.match(s):
            return "date"
        if _DDMMYYYY_RE.match(s):
            # Common LATAM date format — surface as date so users see it
            return "date"
        # Numeric-looking strings stay as string (the user can cast in MAP)
        return "string"
    if isinstance(v, list):
        return "array"
    if isinstance(v, dict):
        return "json"
    return "string"


def _detect_semantic_from_values(values: list[Any]) -> str | None:
    """Look at non-null sample values; return a semantic type if a clear
    pattern dominates, else None."""
    strs = [str(v).strip() for v in values if v is not None and str(v).strip()]
    if not strs:
        return None
    sample = strs[: min(20, len(strs))]
    n = len(sample)
    matches_email = sum(1 for s in sample if _EMAIL_RE.match(s))
    matches_url = sum(1 for s in sample if _URL_RE.match(s))
    matches_phone = sum(1 for s in sample if _PHONE_RE.match(s))
    matches_dt = sum(1 for s in sample if _ISO_DATETIME_RE.match(s))
    matches_date = sum(1 for s in sample if _ISO_DATE_RE.match(s) or _DDMMYYYY_RE.match(s))
    # >= 70% threshold so the odd outlier doesn't drag the field to TEXT
    if matches_email / n >= 0.7:
        return "EMAIL"
    if matches_url / n >= 0.7:
        return "URL"
    if matches_dt / n >= 0.7:
        return "DATETIME"
    if matches_date / n >= 0.7:
        return "DATE"
    if matches_phone / n >= 0.7:
        return "PHONE"
    return None


def _detect_semantic_from_name(name: str) -> str | None:
    n = name.lower().strip()
    for pat, sem in _NAME_PATTERNS:
        if pat.search(n):
            return sem
    return None


def _pick_data_type(values: list[Any]) -> str:
    """Most common non-null type wins. Numeric heterogeneity collapses to
    `number` (int+float). Empty samples default to `string`."""
    types = [_python_to_data_type(v) for v in values if v is not None]
    if not types:
        return "string"
    counts: dict[str, int] = {}
    for t in types:
        counts[t] = counts.get(t, 0) + 1
    if counts.get("integer") and counts.get("number"):
        # mixed numeric → number
        merged = counts.pop("integer", 0) + counts.pop("number", 0)
        counts["number"] = merged
    return max(counts.items(), key=lambda x: x[1])[0]


def infer_properties(
    records: list[dict[str, Any]],
    max_samples: int = 5,
) -> list[dict[str, Any]]:
    """Walk the (flat) keys of the sample records and emit one property
    suggestion per key. Nested dicts/lists are surfaced as `json` /
    `array` data_type — caller can split them later with a MAP step.

    Returns a list of {name, data_type, semantic_type, required, nullable,
    sample_values, inference_confidence}.
    """
    if not records:
        return []

    # Collect per-key values across all records, preserving insertion order
    # of first appearance for stable output.
    keys_in_order: list[str] = []
    by_key: dict[str, list[Any]] = {}
    for rec in records:
        if not isinstance(rec, dict):
            continue
        for k, v in rec.items():
            if k not in by_key:
                by_key[k] = []
                keys_in_order.append(k)
            by_key[k].append(v)

    total = len(records)
    out: list[dict[str, Any]] = []
    for k in keys_in_order:
        values = by_key[k]
        non_null = [v for v in values if v is not None and v != ""]
        data_type = _pick_data_type(non_null)
        sem = _detect_semantic_from_name(k) or _detect_semantic_from_values(non_null) or "TEXT"

        # Type-derived semantic overrides for the obvious cases — if the
        # value pattern says DATETIME but the name didn't suggest anything,
        # use DATETIME instead of TEXT.
        if data_type == "datetime" and sem == "TEXT":
            sem = "DATETIME"
        if data_type == "date" and sem == "TEXT":
            sem = "DATE"
        if data_type == "boolean" and sem == "TEXT":
            sem = "BOOLEAN"

        # `sample_values` — first few unique non-null string-cast values
        seen: set[str] = set()
        samples: list[str] = []
        for v in non_null:
            s = str(v)[:120]  # cap long blobs
            if s in seen:
                continue
            seen.add(s)
            samples.append(s)
            if len(samples) >= max_samples:
                break

        present_count = len(non_null)
        required = total > 0 and present_count == total
        # Confidence: tied to fill rate + whether semantic type came from a
        # pattern match (vs name fallback). Cheap heuristic, just for the UI.
        confidence = round(min(1.0, 0.5 + 0.5 * (present_count / max(total, 1))), 2)

        out.append({
            "name": k,
            "display_name": k,
            "data_type": data_type,
            "semantic_type": sem,
            "required": required,
            "nullable": not required,
            "sample_values": samples,
            "inference_confidence": confidence,
            "fill_rate": round(present_count / max(total, 1), 3),
        })
    return out
