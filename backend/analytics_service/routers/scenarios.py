"""
Scenario Simulation router.

POST /scenarios/interpret      — natural language → structured overrides + metrics (Claude)
POST /scenarios/compute        — ad-hoc compute (no persistence)
POST /scenarios                — create and save a scenario
GET  /scenarios                — list saved scenarios
GET  /scenarios/{id}           — get a scenario
DELETE /scenarios/{id}         — delete a scenario
POST /scenarios/{id}/compute   — compute a saved scenario
"""
import os
import json
import statistics
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, Header, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text, select
from database import get_session, ScenarioRow
import anthropic

_anthropic = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

router = APIRouter()

VALID_FUNCS = {"COUNT", "SUM", "AVG", "MIN", "MAX"}


# ── Natural language → structured scenario (Claude) ───────────────────────────

@router.post("/interpret")
async def interpret_scenario(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Use Claude to interpret a natural language simulation description.
    Returns overrides, derived_metrics, and an explanation.
    """
    tenant_id = x_tenant_id or "tenant-001"
    object_type_id: str = body.get("object_type_id", "")
    description: str = body.get("description", "").strip()
    object_type_name: str = body.get("object_type_name", "records")
    fields: list[str] = body.get("fields", [])

    if not object_type_id:
        raise HTTPException(status_code=400, detail="object_type_id required")
    if not description:
        raise HTTPException(status_code=400, detail="description required")

    # Fetch a sample of real records for context
    sample_records = await _fetch_records(db, tenant_id, object_type_id)
    sample = [
        {k: v for k, v in r.items() if not k.startswith("_")}
        for r in sample_records[:8]
    ]

    # Get distinct values for key fields (helps Claude understand the data)
    value_map: dict[str, list] = {}
    for field in fields[:20]:
        vals = list({str(r.get(field)) for r in sample_records[:200] if r.get(field) is not None})[:8]
        if vals:
            value_map[field] = vals

    total = len(sample_records)

    system_prompt = """You are a data simulation analyst. Given a natural language description of a what-if scenario, you produce a structured JSON simulation plan.

You must return ONLY valid JSON, no markdown, no explanation outside the JSON.

The JSON must have exactly these keys:
- "explanation": string — one paragraph describing what the simulation does and why it's meaningful
- "overrides": array of RULE-based overrides (never use individual object_id values). Each override must be:
  { "filter_field": "fieldName", "filter_op": "eq", "filter_value": "matchValue", "property": "fieldToChange", "simulated_value": "newValue" }
  filter_op must be one of: eq, neq, contains, gt, gte, lt, lte.
  Rules apply to ALL matching records automatically — this is required.
- "derived_metrics": array of metrics. Each metric must be:
  { "name": "descriptive_name", "function": "COUNT", "field": "", "filter_field": "fieldName", "filter_value": "value", "filter_op": "eq" }
  function must be COUNT, SUM, AVG, MIN, or MAX. For COUNT, field should be empty string.
  Use filter_field/filter_value so each metric measures a specific subset (e.g., count only records where priority=Alta).
  Create one metric per distinct value you want to track.
- "insight": string — one sentence predicting the likely direction of change"""

    # Limit value_map size to keep prompt compact
    compact_value_map = {k: v[:5] for k, v in list(value_map.items())[:15]}

    user_msg = f"""Object type: {object_type_name}
Total records: {total}
Available fields: {json.dumps(fields[:30])}
Sample distinct values per field: {json.dumps(compact_value_map, ensure_ascii=False)}

Simulation request: "{description}"

Generate a structured simulation plan using RULE-based overrides that apply to ALL matching records.
Keep explanation to 2 sentences max. Keep insight to 1 sentence.
Example override: filter_field="age", filter_op="gte", filter_value="70", property="outcome", simulated_value="Removed"
For metrics: one metric per distinct value you want to count."""

    try:
        response = await _anthropic.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"Claude returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Claude error: {e}")

    return {
        "explanation": parsed.get("explanation", ""),
        "insight": parsed.get("insight", ""),
        "overrides": parsed.get("overrides", []),
        "derived_metrics": parsed.get("derived_metrics", []),
        "object_type_id": object_type_id,
        "total_records": total,
    }


def _compute_metric(
    func: str,
    field: str,
    records: list[dict],
    filter_field: str = "",
    filter_value: str = "",
    filter_op: str = "eq",
) -> float | None:
    """Compute a single aggregate metric over records, with optional pre-filter."""
    filtered = records
    if filter_field:
        subset = []
        for r in records:
            rv = str(r.get(filter_field, ""))
            fv = str(filter_value)
            if filter_op == "eq" and rv == fv:
                subset.append(r)
            elif filter_op == "neq" and rv != fv:
                subset.append(r)
            elif filter_op == "contains" and fv.lower() in rv.lower():
                subset.append(r)
            elif filter_op == "gt":
                try:
                    if float(rv) > float(fv):
                        subset.append(r)
                except (ValueError, TypeError):
                    pass
            elif filter_op == "gte":
                try:
                    if float(rv) >= float(fv):
                        subset.append(r)
                except (ValueError, TypeError):
                    pass
            elif filter_op == "lt":
                try:
                    if float(rv) < float(fv):
                        subset.append(r)
                except (ValueError, TypeError):
                    pass
            elif filter_op == "lte":
                try:
                    if float(rv) <= float(fv):
                        subset.append(r)
                except (ValueError, TypeError):
                    pass
        filtered = subset

    if func == "COUNT":
        return float(len(filtered))
    vals = []
    for r in filtered:
        v = r.get(field)
        if v is None:
            continue
        try:
            vals.append(float(v))
        except (ValueError, TypeError):
            pass
    if not vals:
        return None
    if func == "SUM":
        return sum(vals)
    if func == "AVG":
        return statistics.mean(vals)
    if func == "MIN":
        return min(vals)
    if func == "MAX":
        return max(vals)
    return None


def _apply_overrides(records: list[dict], overrides: list[dict]) -> tuple[list[dict], int]:
    """
    Apply overrides to an in-memory copy of the records.
    Supports two forms:
      - Record override: { object_id, property, simulated_value }
      - Rule override:   { filter_field, filter_op, filter_value, property, simulated_value }
    Returns (simulated_records, affected_count).
    """
    # Build record-level override map
    record_overrides: dict[str, dict[str, object]] = {}
    rule_overrides: list[dict] = []
    for o in overrides:
        if o.get("object_id"):
            oid = str(o["object_id"])
            prop = o.get("property", "")
            if prop:
                record_overrides.setdefault(oid, {})[prop] = o.get("simulated_value")
        elif o.get("filter_field"):
            rule_overrides.append(o)

    result = []
    affected_count = 0
    for r in records:
        rec = dict(r)
        changed = False

        # Record-level overrides
        rec_id = rec.get("_id", "")
        if rec_id in record_overrides:
            rec.update(record_overrides[rec_id])
            changed = True

        # Rule-based overrides
        for rule in rule_overrides:
            ff = rule.get("filter_field", "")
            fv = str(rule.get("filter_value", ""))
            fop = rule.get("filter_op", "eq")
            rv = str(rec.get(ff, ""))

            match = False
            if fop == "eq":
                match = rv == fv
            elif fop == "neq":
                match = rv != fv
            elif fop == "contains":
                match = fv.lower() in rv.lower()
            elif fop in ("gt", "gte", "lt", "lte"):
                try:
                    rv_f, fv_f = float(rv), float(fv)
                    match = (
                        (fop == "gt" and rv_f > fv_f)
                        or (fop == "gte" and rv_f >= fv_f)
                        or (fop == "lt" and rv_f < fv_f)
                        or (fop == "lte" and rv_f <= fv_f)
                    )
                except (ValueError, TypeError):
                    pass

            if match:
                prop = rule.get("property", "")
                if prop:
                    rec[prop] = rule.get("simulated_value")
                    changed = True

        if changed:
            affected_count += 1
        result.append(rec)

    return result, affected_count


async def _fetch_records(db: AsyncSession, tenant_id: str, object_type_id: str) -> list[dict]:
    """Fetch all object_records for a type and flatten data + meta fields."""
    sql = text("""
        SELECT id::text, data
        FROM object_records
        WHERE tenant_id = :tenant_id
          AND object_type_id::text = :object_type_id
        LIMIT 5000
    """)
    result = await db.execute(sql, {"tenant_id": tenant_id, "object_type_id": object_type_id})
    records = []
    for row in result:
        d = dict(row.data or {})
        d["_id"] = row.id
        records.append(d)
    return records


def _build_result(real_records: list[dict], sim_records: list[dict], metrics: list[dict]) -> dict:
    """Compute baseline and simulated metrics, return delta summary."""
    baseline: dict[str, float | None] = {}
    simulated: dict[str, float | None] = {}

    for m in metrics:
        name = m.get("name", "metric")
        func = m.get("function", "COUNT").upper()
        field = m.get("field", "")
        if func not in VALID_FUNCS:
            func = "COUNT"
        baseline[name] = _compute_metric(func, field, real_records)
        simulated[name] = _compute_metric(func, field, sim_records)

    deltas = {}
    for name in baseline:
        b = baseline[name]
        s = simulated[name]
        if b is not None and s is not None:
            absolute = s - b
            percent = ((s - b) / b * 100) if b != 0 else None
        else:
            absolute = None
            percent = None
        deltas[name] = {
            "baseline": b,
            "simulated": s,
            "absolute": absolute,
            "percent": percent,
        }

    affected = len([r for r in sim_records if r.get("_id") in {
        o.get("object_id") for o in []  # placeholder — computed below
    }])

    return {
        "baseline": baseline,
        "simulated": simulated,
        "deltas": deltas,
        "record_count": len(real_records),
    }


# ── Ad-hoc compute (no persistence) ─────────────────────────────────────────

@router.post("/compute")
async def compute_adhoc(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Compute a what-if scenario without saving to DB.
    Body: { object_type_id, overrides: [...], derived_metrics: [...] }
    """
    tenant_id = x_tenant_id or "tenant-001"
    object_type_id = body.get("object_type_id", "")
    overrides: list[dict] = body.get("overrides", [])
    metrics: list[dict] = body.get("derived_metrics", [])

    if not object_type_id:
        raise HTTPException(status_code=400, detail="object_type_id required")
    if not metrics:
        raise HTTPException(status_code=400, detail="At least one derived_metric required")

    real_records = await _fetch_records(db, tenant_id, object_type_id)
    if not real_records:
        raise HTTPException(status_code=404, detail="No records found for this object type")

    sim_records, affected_count = _apply_overrides(real_records, overrides)

    baseline: dict[str, float | None] = {}
    simulated: dict[str, float | None] = {}
    for m in metrics:
        name = m.get("name", "metric")
        func = m.get("function", "COUNT").upper()
        field = m.get("field", "")
        ff = m.get("filter_field", "")
        fv = m.get("filter_value", "")
        fop = m.get("filter_op", "eq")
        if func not in VALID_FUNCS:
            func = "COUNT"
        baseline[name] = _compute_metric(func, field, real_records, ff, fv, fop)
        simulated[name] = _compute_metric(func, field, sim_records, ff, fv, fop)

    deltas = {}
    for name in baseline:
        b = baseline[name]
        s = simulated[name]
        if b is not None and s is not None:
            absolute = s - b
            percent = ((s - b) / b * 100) if b != 0 else None
        else:
            absolute = None
            percent = None
        deltas[name] = {
            "baseline": b,
            "simulated": s,
            "absolute": absolute,
            "percent": percent,
        }

    return {
        "object_type_id": object_type_id,
        "record_count": len(real_records),
        "affected_records": affected_count,
        "baseline": baseline,
        "simulated": simulated,
        "deltas": deltas,
    }


# ── CRUD ──────────────────────────────────────────────────────────────────────

@router.post("", status_code=201)
async def create_scenario(
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    name = body.get("name", "Untitled Scenario")
    object_type_id = body.get("object_type_id", "")
    if not object_type_id:
        raise HTTPException(status_code=400, detail="object_type_id required")

    scenario_id = str(uuid4())
    row = ScenarioRow(
        id=scenario_id,
        tenant_id=tenant_id,
        name=name,
        object_type_id=object_type_id,
        object_type_name=body.get("object_type_name"),
        overrides=body.get("overrides", []),
        derived_metrics=body.get("derived_metrics", []),
        created_by=body.get("created_by"),
    )
    db.add(row)
    await db.commit()
    return _row_to_dict(row)


@router.get("")
async def list_scenarios(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ScenarioRow)
        .where(ScenarioRow.tenant_id == tenant_id)
        .order_by(ScenarioRow.created_at.desc())
    )
    return [_row_to_dict(r) for r in result.scalars().all()]


@router.get("/{scenario_id}")
async def get_scenario(
    scenario_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ScenarioRow).where(
            ScenarioRow.id == scenario_id,
            ScenarioRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Scenario not found")
    return _row_to_dict(row)


@router.delete("/{scenario_id}", status_code=204)
async def delete_scenario(
    scenario_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ScenarioRow).where(
            ScenarioRow.id == scenario_id,
            ScenarioRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Scenario not found")
    await db.delete(row)
    await db.commit()


@router.post("/{scenario_id}/compute")
async def compute_saved_scenario(
    scenario_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Compute a saved scenario and store the result."""
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ScenarioRow).where(
            ScenarioRow.id == scenario_id,
            ScenarioRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Scenario not found")

    real_records = await _fetch_records(db, tenant_id, row.object_type_id)
    if not real_records:
        raise HTTPException(status_code=404, detail="No records found for this object type")

    sim_records, affected_count = _apply_overrides(real_records, row.overrides or [])

    baseline: dict[str, float | None] = {}
    simulated: dict[str, float | None] = {}
    for m in (row.derived_metrics or []):
        name = m.get("name", "metric")
        func = m.get("function", "COUNT").upper()
        field = m.get("field", "")
        ff = m.get("filter_field", "")
        fv = m.get("filter_value", "")
        fop = m.get("filter_op", "eq")
        if func not in VALID_FUNCS:
            func = "COUNT"
        baseline[name] = _compute_metric(func, field, real_records, ff, fv, fop)
        simulated[name] = _compute_metric(func, field, sim_records, ff, fv, fop)

    deltas = {}
    for name in baseline:
        b = baseline[name]
        s = simulated[name]
        if b is not None and s is not None:
            absolute = s - b
            percent = ((s - b) / b * 100) if b != 0 else None
        else:
            absolute = None
            percent = None
        deltas[name] = {"baseline": b, "simulated": s, "absolute": absolute, "percent": percent}

    compute_result = {
        "object_type_id": row.object_type_id,
        "record_count": len(real_records),
        "affected_records": affected_count,
        "baseline": baseline,
        "simulated": simulated,
        "deltas": deltas,
    }

    row.last_result = compute_result
    await db.commit()
    return compute_result


def _row_to_dict(row: ScenarioRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "object_type_id": row.object_type_id,
        "object_type_name": row.object_type_name,
        "overrides": row.overrides or [],
        "derived_metrics": row.derived_metrics or [],
        "last_result": row.last_result,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
