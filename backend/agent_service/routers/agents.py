"""
Agent configuration CRUD.
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import AgentConfigRow, get_session

router = APIRouter()

AVAILABLE_TOOLS = [
    "ontology_search",
    "list_object_types",
    "logic_function_run",
    "action_propose",
    "list_actions",
]


class AgentCreate(BaseModel):
    name: str
    description: Optional[str] = None
    system_prompt: str
    model: str = "claude-haiku-4-5-20251001"
    enabled_tools: list[str] = []
    tool_config: dict = {}
    max_iterations: int = 10
    enabled: bool = True


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    system_prompt: Optional[str] = None
    model: Optional[str] = None
    enabled_tools: Optional[list[str]] = None
    tool_config: Optional[dict] = None
    max_iterations: Optional[int] = None
    enabled: Optional[bool] = None


def _to_dict(row: AgentConfigRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "system_prompt": row.system_prompt,
        "model": row.model,
        "enabled_tools": row.enabled_tools or [],
        "tool_config": row.tool_config or {},
        "max_iterations": row.max_iterations,
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/tools")
async def list_available_tools():
    """List all tool names the platform supports."""
    return {"tools": AVAILABLE_TOOLS}


@router.get("")
async def list_agents(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow)
        .where(AgentConfigRow.tenant_id == tenant_id)
        .order_by(AgentConfigRow.created_at.desc())
    )
    return [_to_dict(r) for r in result.scalars().all()]


@router.post("", status_code=201)
async def create_agent(
    body: AgentCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = AgentConfigRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        system_prompt=body.system_prompt,
        model=body.model,
        enabled_tools=body.enabled_tools,
        tool_config=body.tool_config,
        max_iterations=body.max_iterations,
        enabled=body.enabled,
    )
    db.add(row)
    await db.commit()
    return _to_dict(row)


@router.get("/{agent_id}")
async def get_agent(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _to_dict(row)


@router.put("/{agent_id}")
async def update_agent(
    agent_id: str,
    body: AgentUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")

    if body.name is not None:
        row.name = body.name
    if body.description is not None:
        row.description = body.description
    if body.system_prompt is not None:
        row.system_prompt = body.system_prompt
    if body.model is not None:
        row.model = body.model
    if body.enabled_tools is not None:
        row.enabled_tools = body.enabled_tools
    if body.tool_config is not None:
        row.tool_config = body.tool_config
    if body.max_iterations is not None:
        row.max_iterations = body.max_iterations
    if body.enabled is not None:
        row.enabled = body.enabled

    await db.commit()
    return _to_dict(row)


@router.delete("/{agent_id}", status_code=204)
async def delete_agent(
    agent_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    await db.delete(row)
    await db.commit()
