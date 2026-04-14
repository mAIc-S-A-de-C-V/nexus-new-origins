"""
PII Scanner — detects personally identifiable information in object type records.

POST /infer/scan-pii
  body: { object_type_id, sample_size?: 100 }
  returns: { scanned_at, fields[], risk_score, high_risk_fields[], total_records_sampled }

POST /infer/scan-all          Scan all object types for the tenant
GET  /infer/scan-results/{id} Get async scan results (stored in memory, TTL 1h)
"""
import re
import os
import json
import asyncio
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Header, HTTPException

router = APIRouter()

ONTOLOGY_API = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")

# ── Regex patterns ────────────────────────────────────────────────────────────

PATTERNS: dict[str, str] = {
    "EMAIL":       r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    "PHONE":       r"(?:\+?1[\s\-.]?)?\(?\d{3}\)?[\s\-.]?\d{3}[\s\-.]?\d{4}",
    "SSN":         r"\b\d{3}-\d{2}-\d{4}\b",
    "CREDIT_CARD": r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b",
    "DOB":         r"\b(?:0[1-9]|1[0-2])[/\-](?:0[1-9]|[12]\d|3[01])[/\-](?:19|20)\d{2}\b",
    "IP_ADDRESS":  r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b",
    "PASSPORT":    r"\b[A-Z]{1,2}\d{6,9}\b",
    "IBAN":        r"\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7,19}\b",
}

# Field names that strongly suggest PII even without regex matches
PII_FIELD_HINTS: list[str] = [
    "name", "first_name", "last_name", "full_name", "fname", "lname",
    "email", "mail", "correo",
    "phone", "tel", "telefono", "celular", "movil", "mobile",
    "address", "direccion", "street", "ciudad", "city", "zip", "postal",
    "ssn", "dob", "birth", "nacimiento", "cedula", "dni", "nit",
    "password", "passwd", "secret", "token", "api_key",
    "patient", "usuario", "persona", "user", "person",
    "gender", "genero", "sexo", "age", "edad",
    "nationality", "nacionalidad", "passport", "pasaporte",
    "income", "salary", "salario", "cuenta",
]

# In-memory scan result cache (run_id → result dict)
_scan_cache: dict[str, dict] = {}

_anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")


async def _fetch_records(tenant_id: str, object_type_id: str, sample_size: int) -> list[dict]:
    """Fetch sample records from the ontology-service."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(
                f"{ONTOLOGY_API}/object-types/{object_type_id}/records",
                headers={"x-tenant-id": tenant_id},
                params={"limit": sample_size},
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
                if isinstance(data, dict):
                    for key in ("items", "records", "data"):
                        if key in data and isinstance(data[key], list):
                            return data[key]
        except Exception:
            pass
    return []


async def _claude_verify_pii(field: str, values: list[str]) -> dict:
    """
    Ask Claude to verify if a field contains PII based on sample values.
    Returns { is_pii, pii_type, confidence }.
    """
    if not _anthropic_key:
        return {"is_pii": False}
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(api_key=_anthropic_key)
        prompt = f"""Field name: "{field}"
Sample values: {json.dumps(values[:5])}

Does this field contain PII (personally identifiable information)?
Reply with a single JSON object only:
{{"is_pii": true/false, "pii_type": "NAME|EMAIL|PHONE|ADDRESS|ID|FINANCIAL|OTHER|null", "confidence": 0.0-1.0, "reason": "one sentence"}}"""
        msg = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[{"role": "user", "content": prompt}],
        )
        text = msg.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception:
        return {"is_pii": False}


def _scan_field(field: str, values: list[str]) -> dict:
    """Run regex patterns on field values. Returns detected PII types + confidence."""
    if not values:
        return {"pii_detected": False, "pii_types": [], "confidence": 0.0, "needs_claude": False}

    detected: dict[str, float] = {}
    for ptype, pattern in PATTERNS.items():
        match_count = sum(1 for v in values if re.search(pattern, str(v)))
        if match_count > 0:
            detected[ptype] = round(match_count / len(values), 3)

    # Field name heuristic
    field_lower = field.lower()
    field_hint = any(hint in field_lower for hint in PII_FIELD_HINTS)

    # Need Claude only if field name is suspicious but regex didn't fire
    needs_claude = field_hint and not detected

    return {
        "pii_detected": bool(detected),
        "pii_types": list(detected.keys()),
        "confidence": max(detected.values()) if detected else 0.0,
        "needs_claude": needs_claude,
        "regex_matched": bool(detected),
    }


async def _scan_object_type(
    tenant_id: str,
    object_type_id: str,
    object_type_name: str,
    sample_size: int = 100,
) -> dict:
    """Full PII scan for one object type."""
    records = await _fetch_records(tenant_id, object_type_id, sample_size)
    if not records:
        return {
            "object_type_id": object_type_id,
            "object_type_name": object_type_name,
            "scanned_at": datetime.now(timezone.utc).isoformat(),
            "total_records_sampled": 0,
            "fields": [],
            "risk_score": 0.0,
            "high_risk_fields": [],
            "error": "No records found",
        }

    # Extract flat field data from records (handle {data: {}} or flat structure)
    flat_records = []
    for r in records:
        if "data" in r and isinstance(r["data"], dict):
            flat_records.append(r["data"])
        else:
            flat_records.append({k: v for k, v in r.items() if not k.startswith("_") and k != "id"})

    if not flat_records:
        flat_records = records

    # Get all unique fields
    all_fields: set[str] = set()
    for r in flat_records:
        all_fields.update(r.keys())
    all_fields.discard("id")
    all_fields.discard("_id")

    findings = []
    claude_tasks = []

    for field in sorted(all_fields):
        values = [str(r.get(field, "")) for r in flat_records if r.get(field) is not None and r.get(field) != ""]
        if not values:
            findings.append({
                "field": field,
                "pii_detected": False,
                "pii_types": [],
                "confidence": 0.0,
                "recommendation": "ok",
                "sample_count": 0,
            })
            continue

        scan = _scan_field(field, values)

        if scan["needs_claude"]:
            claude_tasks.append((field, values[:5], len(findings)))
            findings.append({
                "field": field,
                "pii_detected": False,
                "pii_types": [],
                "confidence": 0.0,
                "recommendation": "ok",
                "sample_count": len(values),
                "_pending_claude": True,
            })
        else:
            rec = "ok"
            if scan["confidence"] > 0.5:
                rec = "restrict"
            elif scan["confidence"] > 0.1:
                rec = "review"
            findings.append({
                "field": field,
                "pii_detected": scan["pii_detected"],
                "pii_types": scan["pii_types"],
                "confidence": scan["confidence"],
                "recommendation": rec,
                "sample_count": len(values),
            })

    # Run Claude verifications concurrently (max 5 to stay within rate limits)
    if claude_tasks:
        claude_results = await asyncio.gather(
            *[_claude_verify_pii(field, vals) for field, vals, _ in claude_tasks[:5]],
            return_exceptions=True,
        )
        for i, (field, _, idx) in enumerate(claude_tasks[:5]):
            cr = claude_results[i]
            if isinstance(cr, dict) and cr.get("is_pii"):
                conf = float(cr.get("confidence", 0.5))
                ptype = cr.get("pii_type") or "UNKNOWN"
                findings[idx].update({
                    "pii_detected": True,
                    "pii_types": [ptype],
                    "confidence": conf,
                    "recommendation": "restrict" if conf > 0.5 else "review",
                    "claude_verified": True,
                })
            if "_pending_claude" in findings[idx]:
                del findings[idx]["_pending_claude"]

    # Clean up any remaining _pending_claude flags
    for f in findings:
        f.pop("_pending_claude", None)

    pii_count = sum(1 for f in findings if f["pii_detected"])
    risk_score = round(pii_count / len(findings), 3) if findings else 0.0
    high_risk = [f["field"] for f in findings if f["confidence"] > 0.5]

    return {
        "object_type_id": object_type_id,
        "object_type_name": object_type_name,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
        "total_records_sampled": len(flat_records),
        "fields": findings,
        "risk_score": risk_score,
        "high_risk_fields": high_risk,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/scan-pii")
async def scan_pii(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    object_type_id = body.get("object_type_id", "")
    if not object_type_id:
        raise HTTPException(status_code=400, detail="object_type_id required")
    sample_size = min(int(body.get("sample_size", 100)), 500)
    object_type_name = body.get("object_type_name", "records")

    result = await _scan_object_type(tenant_id, object_type_id, object_type_name, sample_size)
    return result


@router.post("/scan-all")
async def scan_all(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
):
    """
    Kick off an async scan of all object types for the tenant.
    Returns immediately with a scan_id. Poll GET /infer/scan-results/{id}.
    """
    tenant_id = x_tenant_id or "tenant-001"
    scan_id = str(uuid4())
    _scan_cache[scan_id] = {"status": "running", "started_at": datetime.now(timezone.utc).isoformat(), "results": []}

    async def _run():
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(
                    f"{ONTOLOGY_API}/object-types",
                    headers={"x-tenant-id": tenant_id},
                )
                ots = resp.json() if resp.status_code == 200 else []
                if isinstance(ots, dict):
                    ots = ots.get("items") or ots.get("data") or []
            except Exception:
                ots = []

        results = []
        for ot in ots:
            r = await _scan_object_type(
                tenant_id,
                ot["id"],
                ot.get("displayName") or ot.get("display_name") or ot.get("name", ""),
                100,
            )
            results.append(r)

        _scan_cache[scan_id].update({
            "status": "complete",
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "results": results,
            "total_scanned": len(results),
            "total_high_risk_fields": sum(len(r.get("high_risk_fields", [])) for r in results),
        })

    asyncio.create_task(_run())
    return {"scan_id": scan_id, "status": "running"}


@router.get("/scan-results/{scan_id}")
async def get_scan_results(scan_id: str):
    if scan_id not in _scan_cache:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _scan_cache[scan_id]
