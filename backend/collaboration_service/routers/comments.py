from typing import Optional
from uuid import uuid4
from datetime import datetime, timezone
import asyncpg
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from database import get_pool

router = APIRouter()


class CommentCreate(BaseModel):
    entity_type: str
    entity_id: str
    parent_id: Optional[str] = None
    author_id: str
    author_name: str
    body: str


class CommentUpdate(BaseModel):
    body: Optional[str] = None
    resolved: Optional[bool] = None


def _row_to_dict(row: asyncpg.Record) -> dict:
    return {
        "id": row["id"],
        "tenant_id": row["tenant_id"],
        "entity_type": row["entity_type"],
        "entity_id": row["entity_id"],
        "parent_id": row["parent_id"],
        "author_id": row["author_id"],
        "author_name": row["author_name"],
        "body": row["body"],
        "resolved": row["resolved"],
        "created_at": row["created_at"].isoformat(),
        "updated_at": row["updated_at"].isoformat(),
    }


@router.get("")
async def list_comments(
    entity_type: str,
    entity_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    """List all top-level comments + replies for an entity."""
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT * FROM comments
        WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY created_at ASC
        """,
        tenant_id, entity_type, entity_id,
    )
    return [_row_to_dict(r) for r in rows]


@router.post("", status_code=201)
async def create_comment(
    body: CommentCreate,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    now = datetime.now(timezone.utc)
    comment_id = str(uuid4())
    row = await pool.fetchrow(
        """
        INSERT INTO comments (id, tenant_id, entity_type, entity_id, parent_id, author_id, author_name, body, resolved, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $9)
        RETURNING *
        """,
        comment_id, tenant_id, body.entity_type, body.entity_id,
        body.parent_id, body.author_id, body.author_name, body.body, now,
    )
    return _row_to_dict(row)


@router.patch("/{comment_id}")
async def update_comment(
    comment_id: str,
    body: CommentUpdate,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM comments WHERE id = $1 AND tenant_id = $2", comment_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="Comment not found")

    new_body = body.body if body.body is not None else row["body"]
    new_resolved = body.resolved if body.resolved is not None else row["resolved"]
    now = datetime.now(timezone.utc)

    updated = await pool.fetchrow(
        "UPDATE comments SET body = $1, resolved = $2, updated_at = $3 WHERE id = $4 RETURNING *",
        new_body, new_resolved, now, comment_id,
    )
    return _row_to_dict(updated)


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(
    comment_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    result = await pool.execute("DELETE FROM comments WHERE id = $1 AND tenant_id = $2", comment_id, tenant_id)
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="Comment not found")


@router.get("/count")
async def count_comments(
    entity_type: str,
    entity_id: str,
    x_tenant_id: Optional[str] = Header(None),
):
    tenant_id = x_tenant_id or "tenant-001"
    pool = await get_pool()
    count = await pool.fetchval(
        "SELECT COUNT(*) FROM comments WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3 AND resolved = FALSE",
        tenant_id, entity_type, entity_id,
    )
    return {"count": count}
