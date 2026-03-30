from typing import Optional
from datetime import datetime, timezone
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from shared.models import (
    ObjectType, ObjectTypeVersion, SchemaDiff, PropertyDiff,
    EnrichmentProposal, FieldConflict, OntologyLink
)
from database import ObjectTypeRow, ObjectTypeVersionRow, OntologyLinkRow, get_session

router = APIRouter()


def _row_to_ot(row: ObjectTypeRow) -> ObjectType:
    return ObjectType.model_validate(row.data)


def _row_to_version(row: ObjectTypeVersionRow) -> ObjectTypeVersion:
    return ObjectTypeVersion.model_validate(row.data)


def _row_to_link(row: OntologyLinkRow) -> OntologyLink:
    return OntologyLink.model_validate(row.data)


async def _snapshot(db: AsyncSession, ot: ObjectType, description: str, created_by: str):
    version_row = ObjectTypeVersionRow(
        id=str(uuid4()),
        object_type_id=ot.id,
        version=ot.version,
        data=ObjectTypeVersion(
            id=str(uuid4()),
            object_type_id=ot.id,
            version=ot.version,
            snapshot=ot,
            change_description=description,
            created_at=datetime.now(timezone.utc).isoformat(),
            created_by=created_by,
        ).model_dump(mode="json"),
    )
    db.add(version_row)


# ── Object Types ───────────────────────────────────────────────────────────

@router.get("", response_model=list[ObjectType])
async def list_object_types(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(select(ObjectTypeRow).where(ObjectTypeRow.tenant_id == tenant_id))
    return [_row_to_ot(r) for r in result.scalars().all()]


@router.post("", response_model=ObjectType, status_code=201)
async def create_object_type(
    ot: ObjectType,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    ot.id = str(uuid4())
    ot.tenant_id = tenant_id
    ot.version = 1
    ot.created_at = datetime.now(timezone.utc).isoformat()
    ot.updated_at = datetime.now(timezone.utc).isoformat()

    row = ObjectTypeRow(
        id=ot.id, tenant_id=tenant_id,
        name=ot.name, display_name=ot.display_name,
        version=1, data=ot.model_dump(mode="json"),
    )
    db.add(row)
    await _snapshot(db, ot, "Initial creation", "api")
    await db.commit()
    return ot


@router.get("/{object_type_id}", response_model=ObjectType)
async def get_object_type(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectTypeRow).where(ObjectTypeRow.id == object_type_id, ObjectTypeRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Object type not found")
    return _row_to_ot(row)


@router.put("/{object_type_id}", response_model=ObjectType)
async def update_object_type(
    object_type_id: str,
    updates: ObjectType,
    change_description: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectTypeRow).where(ObjectTypeRow.id == object_type_id, ObjectTypeRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Object type not found")

    updates.id = object_type_id
    updates.tenant_id = tenant_id
    updates.version = row.version + 1
    updates.updated_at = datetime.now(timezone.utc).isoformat()

    row.version = updates.version
    row.name = updates.name
    row.display_name = updates.display_name
    row.data = updates.model_dump(mode="json")
    await _snapshot(db, updates, change_description or "Schema update", "api")
    await db.commit()
    return updates


@router.delete("/{object_type_id}", status_code=204)
async def delete_object_type(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectTypeRow).where(ObjectTypeRow.id == object_type_id, ObjectTypeRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Object type not found")
    await db.delete(row)
    await db.commit()


@router.get("/{object_type_id}/versions", response_model=list[ObjectTypeVersion])
async def get_versions(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    result = await db.execute(
        select(ObjectTypeVersionRow)
        .where(ObjectTypeVersionRow.object_type_id == object_type_id)
        .order_by(ObjectTypeVersionRow.version)
    )
    return [_row_to_version(r) for r in result.scalars().all()]


@router.get("/{object_type_id}/diff/{v1}/{v2}", response_model=SchemaDiff)
async def get_diff(
    object_type_id: str,
    v1: int,
    v2: int,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    result = await db.execute(
        select(ObjectTypeVersionRow).where(ObjectTypeVersionRow.object_type_id == object_type_id)
    )
    versions = {r.version: _row_to_version(r) for r in result.scalars().all()}
    if v1 not in versions or v2 not in versions:
        raise HTTPException(status_code=404, detail="Version not found")

    diffs = _compute_diff(versions[v1].snapshot, versions[v2].snapshot)
    return SchemaDiff(
        object_type_id=object_type_id,
        from_version=v1,
        to_version=v2,
        diffs=diffs,
        has_breaking_changes=any(d.breaking_change for d in diffs),
        generated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.post("/{object_type_id}/set-pipeline")
async def set_source_pipeline(
    object_type_id: str,
    body: dict,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Bind a pipeline as the authoritative data source for this object type.
    Called automatically by the pipeline service after a successful run.
    Once set, records/sync is blocked — the pipeline owns the data.
    """
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectTypeRow).where(
            ObjectTypeRow.id == object_type_id,
            ObjectTypeRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Object type not found")

    pipeline_id: str = body.get("pipeline_id", "")
    if not pipeline_id:
        raise HTTPException(status_code=400, detail="pipeline_id is required")

    ot_data = dict(row.data)
    ot_data["source_pipeline_id"] = pipeline_id
    ot_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    row.data = ot_data
    await db.commit()

    return {"object_type_id": object_type_id, "source_pipeline_id": pipeline_id}


@router.post("/{object_type_id}/enrich", response_model=ObjectType)
async def apply_enrichment(
    object_type_id: str,
    proposal: EnrichmentProposal,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(ObjectTypeRow).where(ObjectTypeRow.id == object_type_id, ObjectTypeRow.tenant_id == tenant_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Object type not found")

    existing = _row_to_ot(row)
    existing_names = {p.name for p in existing.properties}
    new_props = [p for p in proposal.new_properties if p.name not in existing_names]

    existing.properties = existing.properties + new_props
    existing.version = row.version + 1
    existing.updated_at = datetime.now(timezone.utc).isoformat()

    row.version = existing.version
    row.data = existing.model_dump(mode="json")
    await _snapshot(db, existing, f"Enrichment from {proposal.source_connector_id}: +{len(new_props)} properties", "api")
    await db.commit()
    return existing


# ── Links ──────────────────────────────────────────────────────────────────

@router.get("/links/all", response_model=list[OntologyLink])
async def list_links(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(select(OntologyLinkRow).where(OntologyLinkRow.tenant_id == tenant_id))
    return [_row_to_link(r) for r in result.scalars().all()]


@router.post("/links", response_model=OntologyLink, status_code=201)
async def create_link(
    link: OntologyLink,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    link.id = str(uuid4())
    row = OntologyLinkRow(
        id=link.id, tenant_id=tenant_id,
        source_object_type_id=link.source_object_type_id,
        target_object_type_id=link.target_object_type_id,
        data=link.model_dump(mode="json"),
    )
    db.add(row)
    await db.commit()
    return link


@router.delete("/links/{link_id}", status_code=204)
async def delete_link(
    link_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    result = await db.execute(select(OntologyLinkRow).where(OntologyLinkRow.id == link_id))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Link not found")
    await db.delete(row)
    await db.commit()


# ── Helpers ────────────────────────────────────────────────────────────────

def _compute_diff(v1: ObjectType, v2: ObjectType) -> list[PropertyDiff]:
    diffs = []
    v1_props = {p.name: p for p in v1.properties}
    v2_props = {p.name: p for p in v2.properties}

    for name, prop in v2_props.items():
        if name not in v1_props:
            diffs.append(PropertyDiff(property_name=name, change_type="ADDED",
                new_value={"semantic_type": prop.semantic_type.value, "data_type": prop.data_type},
                breaking_change=False))

    for name, prop in v1_props.items():
        if name not in v2_props:
            diffs.append(PropertyDiff(property_name=name, change_type="REMOVED",
                old_value={"semantic_type": prop.semantic_type.value, "data_type": prop.data_type},
                breaking_change=True))

    for name, v2p in v2_props.items():
        if name in v1_props:
            v1p = v1_props[name]
            if v1p.semantic_type != v2p.semantic_type or v1p.data_type != v2p.data_type:
                diffs.append(PropertyDiff(property_name=name, change_type="MODIFIED",
                    old_value={"semantic_type": v1p.semantic_type.value, "data_type": v1p.data_type},
                    new_value={"semantic_type": v2p.semantic_type.value, "data_type": v2p.data_type},
                    breaking_change=v1p.data_type != v2p.data_type))
    return diffs
