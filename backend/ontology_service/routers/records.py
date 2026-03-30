"""
Records API — persisted merged records per ObjectType.

POST /object-types/{ot_id}/records/sync  → pull from all source connectors, merge nested arrays, upsert
GET  /object-types/{ot_id}/records        → list persisted merged records
"""
import os
import httpx
from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header, Depends, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm.attributes import flag_modified
from database import get_session, ObjectTypeRow, ObjectRecordRow

CONNECTOR_API = os.environ.get("CONNECTOR_SERVICE_URL", "http://connector-service:8001")

router = APIRouter()


# ── GET records ─────────────────────────────────────────────────────────────

@router.get("/{ot_id}/records")
async def list_records(
    ot_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectRecordRow)
        .where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
        )
        .order_by(ObjectRecordRow.updated_at.desc())
    )
    rows = result.scalars().all()
    return {
        "records": [r.data for r in rows],
        "total": len(rows),
        "synced_at": rows[0].updated_at.isoformat() if rows else None,
    }


# ── POST sync ───────────────────────────────────────────────────────────────

@router.post("/{ot_id}/records/sync")
async def sync_records(
    ot_id: str,
    background_tasks: BackgroundTasks,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Pull data from all source connectors for this ObjectType, join nested arrays
    by matching on company/entity name, and upsert merged records into the DB.
    """
    tenant_id = x_tenant_id or "tenant-001"

    result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == ot_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    ot_row = result.scalar_one_or_none()
    if not ot_row:
        raise HTTPException(status_code=404, detail="Object type not found")

    ot_data = ot_row.data

    # Pipeline-backed objects must be synced by running the pipeline, not by pulling connectors directly
    source_pipeline_id = ot_data.get("source_pipeline_id")
    if source_pipeline_id:
        raise HTTPException(
            status_code=409,
            detail=f"This object type is backed by pipeline '{source_pipeline_id}'. Run the pipeline to sync records — direct connector sync is disabled.",
        )

    # Data is stored as snake_case by Pydantic serialization
    source_connector_ids: list[str] = ot_data.get("source_connector_ids", [])
    properties: list[dict] = ot_data.get("properties", [])

    # Map connector_id -> prop_name for array/nested properties (e.g. meetings)
    # These connectors may or may not be in source_connector_ids — include them regardless
    array_connector_map: dict[str, str] = {}
    for prop in properties:
        if prop.get("data_type") == "array" or prop.get("name", "").endswith("[]"):
            cid = prop.get("source_connector_id")
            if cid:
                raw_name = prop.get("name", "nested").rstrip("[]")
                array_connector_map[cid] = raw_name

    # All connectors = source connectors + any array-property connectors not already listed
    all_connector_ids = list(dict.fromkeys(source_connector_ids + list(array_connector_map.keys())))

    if not all_connector_ids:
        raise HTTPException(status_code=400, detail="No source connectors configured on this object type")

    primary_connector_ids = [c for c in all_connector_ids if c not in array_connector_map]

    async with httpx.AsyncClient(timeout=60) as client:
        # Fetch flat records from primary connectors
        primary_records: list[dict] = []
        for cid in primary_connector_ids:
            try:
                r = await client.get(f"{CONNECTOR_API}/connectors/{cid}/schema",
                                     headers={"x-tenant-id": tenant_id})
                if r.is_success:
                    primary_records.extend(r.json().get("sample_rows", []))
            except Exception:
                pass

        # Fetch nested records from array connectors
        nested_by_connector: dict[str, list[dict]] = {}
        for cid in array_connector_map:
            try:
                r = await client.get(f"{CONNECTOR_API}/connectors/{cid}/schema",
                                     headers={"x-tenant-id": tenant_id})
                nested_by_connector[cid] = r.json().get("sample_rows", []) if r.is_success else []
            except Exception:
                nested_by_connector[cid] = []

    if not primary_records:
        return {"synced": 0, "message": "No records fetched from primary connectors"}

    # Build merged records
    merged: list[dict] = []
    for rec in primary_records:
        record = dict(rec)

        # Determine this record's display name for matching (try common name fields)
        name_val = _extract_name(record)

        for cid, prop_name in array_connector_map.items():
            nested = nested_by_connector.get(cid, [])
            matched = _match_nested(nested, name_val) if name_val else []
            # Store as "meetings[]" key so the DB viewer renders it as nested
            record[f"{prop_name}[]"] = matched

        merged.append(record)

    # Upsert into object_records
    pk_field = _guess_pk(merged[0]) if merged else "id"
    upserted = 0
    for record in merged:
        source_id = str(record.get(pk_field) or uuid4())

        existing = await db.execute(
            select(ObjectRecordRow).where(
                ObjectRecordRow.object_type_id == ot_id,
                ObjectRecordRow.tenant_id == tenant_id,
                ObjectRecordRow.source_id == source_id,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.data = record
            row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(ObjectRecordRow(
                id=str(uuid4()),
                object_type_id=ot_id,
                tenant_id=tenant_id,
                source_id=source_id,
                data=record,
            ))
        upserted += 1

    await db.commit()
    return {
        "synced": upserted,
        "primary_records": len(primary_records),
        "nested_connectors": len(array_connector_map),
        "message": f"Upserted {upserted} records",
    }


# ── POST ingest (pipeline push) ─────────────────────────────────────────────

@router.post("/{ot_id}/records/ingest")
async def ingest_records(
    ot_id: str,
    payload: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Directly upsert records produced by a pipeline into this object type.
    Called by the DAG executor's SINK_OBJECT node — the pipeline owns the data,
    not the connector. Records are stamped with _pipeline_id and _pipeline_run_at.
    """
    tenant_id = x_tenant_id or "tenant-001"
    records: list[dict] = payload.get("records", [])
    pk_field: str = payload.get("pk_field", "id")
    pipeline_id: str = payload.get("pipeline_id", "")

    if not records:
        return {"ingested": 0, "message": "No records provided"}

    result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == ot_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    ot_row = result.scalar_one_or_none()
    if not ot_row:
        raise HTTPException(status_code=404, detail="Object type not found")

    if not records[0].get(pk_field):
        pk_field = _guess_pk(records[0])

    run_at = datetime.now(timezone.utc).isoformat()
    ingested = 0

    for record in records:
        record = dict(record)
        record["_pipeline_id"] = pipeline_id
        record["_pipeline_run_at"] = run_at

        source_id = str(record.get(pk_field) or uuid4())

        existing = await db.execute(
            select(ObjectRecordRow).where(
                ObjectRecordRow.object_type_id == ot_id,
                ObjectRecordRow.tenant_id == tenant_id,
                ObjectRecordRow.source_id == source_id,
            )
        )
        row = existing.scalar_one_or_none()
        if row:
            row.data = record
            row.updated_at = datetime.now(timezone.utc)
        else:
            db.add(ObjectRecordRow(
                id=str(uuid4()),
                object_type_id=ot_id,
                tenant_id=tenant_id,
                source_id=source_id,
                data=record,
            ))
        ingested += 1

    await db.commit()
    return {
        "ingested": ingested,
        "pipeline_id": pipeline_id,
        "message": f"Ingested {ingested} records from pipeline {pipeline_id}",
    }


# ── POST array-append ───────────────────────────────────────────────────────

@router.post("/{ot_id}/records/array-append")
async def array_append_records(
    ot_id: str,
    payload: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Append incoming records to an array field on matching target records.

    Payload:
      array_field  – name of the array property on the target object (e.g. "meetings")
      merge_key    – field on the target record used for matching (e.g. "deal_name")
      join_key     – field on incoming records that holds the match value (default "__join_key__")
      records      – list of incoming records (each must have join_key set)
    """
    tenant_id = x_tenant_id or "tenant-001"
    array_field: str = payload.get("array_field", "")
    merge_key: str = payload.get("merge_key", "")
    join_key: str = payload.get("join_key", "__join_key__")
    incoming: list[dict] = payload.get("records", [])

    if not array_field or not merge_key or not incoming:
        raise HTTPException(status_code=400, detail="array_field, merge_key, and records are required")

    # Load all existing records for this object type
    result = await db.execute(
        select(ObjectRecordRow).where(
            ObjectRecordRow.object_type_id == ot_id,
            ObjectRecordRow.tenant_id == tenant_id,
        )
    )
    rows = result.scalars().all()

    if not rows:
        return {"appended": 0, "message": "No target records found"}

    # Build a map: normalized merge_key value → row
    def _norm(val: str) -> str:
        return str(val).strip().lower()

    target_map: dict[str, ObjectRecordRow] = {}
    for row in rows:
        mk_val = row.data.get(merge_key) or row.data.get(merge_key.replace("_", "")) or ""
        if mk_val:
            target_map[_norm(mk_val)] = row

    array_key = f"{array_field}[]"
    appended = 0

    for rec in incoming:
        jk_val = rec.get(join_key, "")
        if not jk_val:
            continue
        jk_norm = _norm(jk_val)

        # Exact match first
        matched_row = target_map.get(jk_norm)

        # Partial/fuzzy match: substring or word overlap
        if not matched_row:
            for key, row in target_map.items():
                if jk_norm in key or key in jk_norm:
                    matched_row = row
                    break

        # Word-level match: any significant word (≥4 chars) from join_key appears in target key
        if not matched_row:
            jk_words = [w for w in jk_norm.split() if len(w) >= 4]
            for key, row in target_map.items():
                if any(w in key for w in jk_words):
                    matched_row = row
                    break

        if not matched_row:
            continue

        current_data = dict(matched_row.data)
        current_array: list = current_data.get(array_key, [])
        if not isinstance(current_array, list):
            current_array = []

        # Avoid duplicates: skip if a record with same id already in array
        rec_id = rec.get("id") or rec.get("uuid") or rec.get("meeting_id")
        if rec_id and any(r.get("id") == rec_id or r.get("uuid") == rec_id for r in current_array):
            continue

        current_array.append(rec)
        current_data[array_key] = current_array
        matched_row.data = current_data
        flag_modified(matched_row, "data")
        matched_row.updated_at = datetime.now(timezone.utc)
        appended += 1

    await db.commit()
    return {
        "appended": appended,
        "total_incoming": len(incoming),
        "target_records": len(rows),
        "message": f"Appended {appended} records to {array_field}[] on matching targets",
    }


# ── Helpers ─────────────────────────────────────────────────────────────────

def _extract_name(record: dict) -> str:
    """Extract a normalized entity name from a record for join matching."""
    raw = (
        record.get("name") or
        record.get("company_name") or
        record.get("company") or
        (str(record.get("firstname", "")) + " " + str(record.get("lastname", ""))).strip() or
        record.get("title") or
        ""
    )
    return str(raw).strip().lower()


def _match_nested(nested_records: list[dict], entity_name: str) -> list[dict]:
    """
    Match nested records (e.g. Fireflies transcripts) against an entity name.
    A transcript matches if the entity name appears in its title, participants,
    organizer_email, or overview text.
    """
    if not entity_name or len(entity_name) < 3:
        return []

    # Split into words for multi-word company names (match any significant word)
    words = [w for w in entity_name.split() if len(w) >= 4]
    if not words:
        words = [entity_name]

    matches = []
    for rec in nested_records:
        searchable = " ".join([
            str(rec.get("title", "")),
            str(rec.get("organizer_email", "")),
            " ".join(str(p) for p in (rec.get("participants") or [])),
            str(rec.get("overview", "")),
            str(rec.get("keywords", "")),
        ]).lower()

        # Match if the full name or any significant word matches
        if entity_name in searchable or any(w in searchable for w in words):
            matches.append(rec)

    return matches


def _guess_pk(record: dict) -> str:
    """Guess the primary key field from a record."""
    for candidate in ["hs_object_id", "id", "record_id", "uuid"]:
        if record.get(candidate):
            return candidate
    return next(iter(record), "id")
