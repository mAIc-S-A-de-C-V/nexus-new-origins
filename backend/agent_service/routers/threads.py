"""
Agent Thread endpoints — conversation management + message sending.
Supports both sync (full response) and streaming (SSE) modes.
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import AgentConfigRow, AgentThreadRow, AgentMessageRow, get_session
from runtime import run_agent, stream_agent

router = APIRouter()


class ThreadCreate(BaseModel):
    title: Optional[str] = None
    created_by: Optional[str] = None


class MessageRequest(BaseModel):
    content: str
    stream: bool = False


def _thread_to_dict(row: AgentThreadRow) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "agent_id": row.agent_id,
        "title": row.title,
        "status": row.status,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _msg_to_dict(row: AgentMessageRow) -> dict:
    return {
        "id": row.id,
        "thread_id": row.thread_id,
        "role": row.role,
        "content": row.content,
        "tool_name": row.tool_name,
        "tool_use_id": row.tool_use_id,
        "tool_input": row.tool_input,
        "tool_result": row.tool_result,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


# ── Thread CRUD ───────────────────────────────────────────────────────────────

@router.get("")
async def list_threads(
    agent_id: Optional[str] = None,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    q = select(AgentThreadRow).where(AgentThreadRow.tenant_id == tenant_id)
    if agent_id:
        q = q.where(AgentThreadRow.agent_id == agent_id)
    q = q.order_by(AgentThreadRow.updated_at.desc())
    result = await db.execute(q)
    return [_thread_to_dict(r) for r in result.scalars().all()]


@router.post("/{agent_id}", status_code=201)
async def create_thread(
    agent_id: str,
    body: ThreadCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    # Validate agent exists
    result = await db.execute(
        select(AgentConfigRow).where(
            AgentConfigRow.id == agent_id,
            AgentConfigRow.tenant_id == tenant_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found")

    row = AgentThreadRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        agent_id=agent_id,
        title=body.title,
        created_by=body.created_by,
    )
    db.add(row)
    await db.commit()
    return _thread_to_dict(row)


@router.get("/{thread_id}/messages")
async def get_thread_messages(
    thread_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(AgentMessageRow)
        .where(
            AgentMessageRow.thread_id == thread_id,
            AgentMessageRow.tenant_id == tenant_id,
        )
        .order_by(AgentMessageRow.created_at.asc())
    )
    return [_msg_to_dict(r) for r in result.scalars().all()]


# ── Send message (sync or stream) ─────────────────────────────────────────────

async def _load_history(thread_id: str, tenant_id: str, db: AsyncSession) -> list[dict]:
    """Build Claude-compatible message history from persisted messages."""
    result = await db.execute(
        select(AgentMessageRow)
        .where(
            AgentMessageRow.thread_id == thread_id,
            AgentMessageRow.tenant_id == tenant_id,
        )
        .order_by(AgentMessageRow.created_at.asc())
    )
    rows = result.scalars().all()
    history = []
    for row in rows:
        if row.role == "user":
            history.append({"role": "user", "content": row.content})
        elif row.role == "assistant":
            history.append({"role": "assistant", "content": row.content})
        # tool_use and tool_result are embedded in assistant/user messages by the runtime
        # so we skip them here — the runtime manages the multi-turn history internally
    return history


async def _save_new_messages(
    new_messages: list[dict],
    thread_id: str,
    tenant_id: str,
    db: AsyncSession,
):
    """Persist the new messages generated during a run."""
    for msg in new_messages:
        role = msg.get("role")
        content = msg.get("content")

        if isinstance(content, str):
            row = AgentMessageRow(
                id=str(uuid4()),
                thread_id=thread_id,
                tenant_id=tenant_id,
                role=role,
                content=content,
            )
            db.add(row)
        elif isinstance(content, list):
            for block in content:
                if block.get("type") == "text":
                    row = AgentMessageRow(
                        id=str(uuid4()),
                        thread_id=thread_id,
                        tenant_id=tenant_id,
                        role=role,
                        content=block.get("text", ""),
                    )
                    db.add(row)
                elif block.get("type") == "tool_use":
                    row = AgentMessageRow(
                        id=str(uuid4()),
                        thread_id=thread_id,
                        tenant_id=tenant_id,
                        role="tool_use",
                        content=block.get("name", ""),
                        tool_name=block.get("name"),
                        tool_use_id=block.get("id"),
                        tool_input=block.get("input"),
                    )
                    db.add(row)
                elif block.get("type") == "tool_result":
                    import json
                    result_content = block.get("content", "")
                    try:
                        result_data = json.loads(result_content) if isinstance(result_content, str) else result_content
                    except Exception:
                        result_data = result_content
                    row = AgentMessageRow(
                        id=str(uuid4()),
                        thread_id=thread_id,
                        tenant_id=tenant_id,
                        role="tool_result",
                        content=str(result_content),
                        tool_use_id=block.get("tool_use_id"),
                        tool_result=result_data,
                    )
                    db.add(row)

    await db.commit()


@router.post("/{thread_id}/messages")
async def send_message(
    thread_id: str,
    body: MessageRequest,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"

    # Load thread + agent config
    thread_result = await db.execute(
        select(AgentThreadRow).where(
            AgentThreadRow.id == thread_id,
            AgentThreadRow.tenant_id == tenant_id,
        )
    )
    thread = thread_result.scalar_one_or_none()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    agent_result = await db.execute(
        select(AgentConfigRow).where(AgentConfigRow.id == thread.agent_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent config not found")

    history = await _load_history(thread_id, tenant_id, db)

    if body.stream:
        async def event_generator():
            async for chunk in stream_agent(
                agent_id=agent.id,
                system_prompt=agent.system_prompt,
                model=agent.model,
                enabled_tools=agent.enabled_tools or [],
                max_iterations=agent.max_iterations,
                conversation_history=history,
                new_user_message=body.content,
                tenant_id=tenant_id,
            ):
                yield chunk

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    else:
        outcome = await run_agent(
            agent_id=agent.id,
            system_prompt=agent.system_prompt,
            model=agent.model,
            enabled_tools=agent.enabled_tools or [],
            max_iterations=agent.max_iterations,
            conversation_history=history,
            new_user_message=body.content,
            tenant_id=tenant_id,
        )
        await _save_new_messages(outcome.get("new_messages", []), thread_id, tenant_id, db)
        return {
            "final_text": outcome.get("final_text", ""),
            "iterations": outcome.get("iterations", 0),
            "error": outcome.get("error"),
        }
