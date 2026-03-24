import hashlib
import json
from typing import Optional
from datetime import datetime
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, Field

router = APIRouter()
_store: dict[str, list[dict]] = {}  # connector_id -> list of schema versions


class SchemaVersion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    connector_id: str
    hash: str
    schema: dict
    version: int = 1
    registered_at: datetime = Field(default_factory=datetime.utcnow)
    tenant_id: str


class RegisterSchemaRequest(BaseModel):
    connector_id: str
    schema: dict


@router.get("/{connector_id}", response_model=list[SchemaVersion])
async def get_schemas(connector_id: str, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    versions = _store.get(connector_id, [])
    return [v for v in versions if v["tenant_id"] == tenant_id]


@router.post("", response_model=SchemaVersion, status_code=201)
async def register_schema(req: RegisterSchemaRequest, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"

    schema_json = json.dumps(req.schema, sort_keys=True)
    schema_hash = "sha256:" + hashlib.sha256(schema_json.encode()).hexdigest()[:16]

    existing = _store.get(req.connector_id, [])

    # Deduplicate by hash
    for v in existing:
        if v["hash"] == schema_hash:
            return v

    version_num = len(existing) + 1
    schema_version = {
        "id": str(uuid4()),
        "connector_id": req.connector_id,
        "hash": schema_hash,
        "schema": req.schema,
        "version": version_num,
        "registered_at": datetime.utcnow().isoformat(),
        "tenant_id": tenant_id,
    }

    if req.connector_id not in _store:
        _store[req.connector_id] = []
    _store[req.connector_id].append(schema_version)

    return schema_version


@router.get("/{connector_id}/latest")
async def get_latest_schema(connector_id: str, x_tenant_id: Optional[str] = Header(None)):
    tenant_id = x_tenant_id or "tenant-001"
    versions = [v for v in _store.get(connector_id, []) if v["tenant_id"] == tenant_id]
    if not versions:
        raise HTTPException(status_code=404, detail="No schema registered for this connector")
    return versions[-1]
