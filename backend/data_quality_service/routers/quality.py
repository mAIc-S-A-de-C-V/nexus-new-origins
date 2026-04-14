from typing import Optional
from fastapi import APIRouter, Header
from database import get_pool
from profiler import profile_object_type, profile_all_types

router = APIRouter()


@router.get("/summary")
async def quality_summary(x_tenant_id: Optional[str] = Header(None)):
    """All object types with their latest quality scores."""
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    return await profile_all_types(pool, tenant_id)


@router.get("/{object_type_id}")
async def get_quality_profile(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    """Full property-level quality profile for one object type."""
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    return await profile_object_type(pool, object_type_id, tenant_id)


@router.post("/{object_type_id}/run", status_code=202)
async def trigger_profile_run(
    object_type_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    """Trigger a fresh profile run (same as GET but explicitly logs intent)."""
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    result = await profile_object_type(pool, object_type_id, tenant_id)
    return result
