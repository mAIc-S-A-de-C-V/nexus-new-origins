from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from kernel_manager import KernelRegistry, execute

router = APIRouter()
registry = KernelRegistry()


class CreateSessionResponse(BaseModel):
    session_id: str


class ExecuteRequest(BaseModel):
    code: str
    timeout_sec: int = Field(default=30, ge=1, le=300)


@router.on_event("startup")
async def _startup() -> None:
    await registry.start_gc()


@router.post("/sessions", response_model=CreateSessionResponse, status_code=201)
async def create_session(
    request: Request,
    x_tenant_id: Optional[str] = Header(None),
    authorization: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1]
    session = await registry.create(tenant_id=tenant_id, auth_token=token)
    return CreateSessionResponse(session_id=session.session_id)


@router.post("/sessions/{session_id}/execute")
async def execute_cell(session_id: str, body: ExecuteRequest):
    if registry.get(session_id) is None:
        raise HTTPException(status_code=404, detail="Kernel session not found")
    return await execute(registry, session_id, body.code, body.timeout_sec)


@router.post("/sessions/{session_id}/interrupt")
async def interrupt(session_id: str):
    ok = await registry.interrupt(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Kernel session not found")
    return {"interrupted": True}


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(session_id: str):
    ok = await registry.delete(session_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Kernel session not found")
