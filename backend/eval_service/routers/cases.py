"""
Eval Test Cases CRUD.
GET  /suites/{suite_id}/cases     → list cases for a suite
POST /suites/{suite_id}/cases     → add a case
GET  /cases/{case_id}
PUT  /cases/{case_id}
DELETE /cases/{case_id}

NOTE: /suites/{suite_id}/cases routes are mounted separately in main.py via the suites router.
The /cases routes are mounted at /cases.
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import EvalTestCaseRow, EvalSuiteRow, get_session

router = APIRouter()


class CaseCreate(BaseModel):
    name: str
    inputs: dict = Field(default_factory=dict)
    expected_outputs: Optional[dict] = None
    tags: list[str] = Field(default_factory=list)


class CaseUpdate(BaseModel):
    name: Optional[str] = None
    inputs: Optional[dict] = None
    expected_outputs: Optional[dict] = None
    tags: Optional[list[str]] = None


def _row_to_dict(row: EvalTestCaseRow) -> dict:
    return {
        "id": row.id,
        "suite_id": row.suite_id,
        "name": row.name,
        "inputs": row.inputs or {},
        "expected_outputs": row.expected_outputs,
        "tags": row.tags or [],
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("/suites/{suite_id}/cases")
async def list_cases(
    suite_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    # Verify suite ownership
    suite_result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    if not suite_result.scalar_one_or_none():
        raise HTTPException(404, "Suite not found")

    result = await db.execute(
        select(EvalTestCaseRow)
        .where(EvalTestCaseRow.suite_id == suite_id)
        .order_by(EvalTestCaseRow.created_at.asc())
    )
    return [_row_to_dict(r) for r in result.scalars().all()]


@router.post("/suites/{suite_id}/cases", status_code=201)
async def create_case(
    suite_id: str,
    body: CaseCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    suite_result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    if not suite_result.scalar_one_or_none():
        raise HTTPException(404, "Suite not found")

    row = EvalTestCaseRow(
        id=str(uuid4()),
        suite_id=suite_id,
        tenant_id=tenant_id,
        name=body.name,
        inputs=body.inputs,
        expected_outputs=body.expected_outputs,
        tags=body.tags,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.get("/{case_id}")
async def get_case(
    case_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalTestCaseRow).where(
            EvalTestCaseRow.id == case_id,
            EvalTestCaseRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Test case not found")
    return _row_to_dict(row)


@router.put("/{case_id}")
async def update_case(
    case_id: str,
    body: CaseUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalTestCaseRow).where(
            EvalTestCaseRow.id == case_id,
            EvalTestCaseRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Test case not found")

    if body.name is not None:
        row.name = body.name
    if body.inputs is not None:
        row.inputs = body.inputs
    if body.expected_outputs is not None:
        row.expected_outputs = body.expected_outputs
    if body.tags is not None:
        row.tags = body.tags

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{case_id}", status_code=204)
async def delete_case(
    case_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalTestCaseRow).where(
            EvalTestCaseRow.id == case_id,
            EvalTestCaseRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Test case not found")
    await db.delete(row)
    await db.commit()
