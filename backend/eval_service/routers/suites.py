"""
Eval Suites CRUD.
GET  /suites
POST /suites
GET  /suites/{id}
PUT  /suites/{id}
DELETE /suites/{id}
"""
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import EvalSuiteRow, EvalRunRow, get_session

router = APIRouter()

VALID_TARGET_TYPES = {"agent", "logic_function", "logic_flow"}
VALID_EVALUATOR_TYPES = {"exact_match", "json_schema_match", "rouge_score", "contains_key_details", "custom_expression"}


class EvaluatorConfigItem(BaseModel):
    type: str
    weight: float = 1.0
    config: dict = Field(default_factory=dict)


class SuiteCreate(BaseModel):
    name: str
    description: Optional[str] = None
    target_type: str
    target_id: str
    target_name: Optional[str] = None
    evaluator_configs: list[EvaluatorConfigItem] = Field(default_factory=list)
    pass_threshold: float = Field(default=0.7, ge=0.0, le=1.0)


class SuiteUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    target_name: Optional[str] = None
    evaluator_configs: Optional[list[EvaluatorConfigItem]] = None
    pass_threshold: Optional[float] = Field(default=None, ge=0.0, le=1.0)


def _row_to_dict(row: EvalSuiteRow, case_count: int = 0, last_run: dict | None = None) -> dict:
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "name": row.name,
        "description": row.description,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "target_name": row.target_name,
        "evaluator_configs": row.evaluator_configs or [],
        "pass_threshold": row.pass_threshold,
        "case_count": case_count,
        "last_run": last_run,
        "created_by": row.created_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


@router.get("")
async def list_suites(
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalSuiteRow)
        .where(EvalSuiteRow.tenant_id == tenant_id)
        .order_by(EvalSuiteRow.updated_at.desc())
    )
    suites = result.scalars().all()

    # Enrich with case counts and last run summary
    out = []
    from database import EvalTestCaseRow
    from sqlalchemy import func as sqlfunc
    for suite in suites:
        count_result = await db.execute(
            select(sqlfunc.count()).select_from(EvalTestCaseRow).where(
                EvalTestCaseRow.suite_id == suite.id
            )
        )
        case_count = count_result.scalar() or 0

        last_run_result = await db.execute(
            select(EvalRunRow)
            .where(EvalRunRow.suite_id == suite.id, EvalRunRow.status == "complete")
            .order_by(EvalRunRow.started_at.desc())
            .limit(1)
        )
        last_run_row = last_run_result.scalar_one_or_none()
        last_run = None
        if last_run_row and last_run_row.summary:
            last_run = {
                "id": last_run_row.id,
                "summary": last_run_row.summary,
                "started_at": last_run_row.started_at.isoformat() if last_run_row.started_at else None,
            }

        out.append(_row_to_dict(suite, case_count, last_run))
    return out


@router.post("", status_code=201)
async def create_suite(
    body: SuiteCreate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    if body.target_type not in VALID_TARGET_TYPES:
        raise HTTPException(400, f"target_type must be one of {VALID_TARGET_TYPES}")
    for ec in body.evaluator_configs:
        if ec.type not in VALID_EVALUATOR_TYPES:
            raise HTTPException(400, f"Unknown evaluator type: {ec.type}")

    row = EvalSuiteRow(
        id=str(uuid4()),
        tenant_id=tenant_id,
        name=body.name,
        description=body.description,
        target_type=body.target_type,
        target_id=body.target_id,
        target_name=body.target_name,
        evaluator_configs=[ec.model_dump() for ec in body.evaluator_configs],
        pass_threshold=body.pass_threshold,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.get("/{suite_id}")
async def get_suite(
    suite_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Suite not found")
    return _row_to_dict(row)


@router.put("/{suite_id}")
async def update_suite(
    suite_id: str,
    body: SuiteUpdate,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Suite not found")

    if body.name is not None:
        row.name = body.name
    if body.description is not None:
        row.description = body.description
    if body.target_type is not None:
        if body.target_type not in VALID_TARGET_TYPES:
            raise HTTPException(400, f"target_type must be one of {VALID_TARGET_TYPES}")
        row.target_type = body.target_type
    if body.target_id is not None:
        row.target_id = body.target_id
    if body.target_name is not None:
        row.target_name = body.target_name
    if body.evaluator_configs is not None:
        row.evaluator_configs = [ec.model_dump() for ec in body.evaluator_configs]
    if body.pass_threshold is not None:
        row.pass_threshold = body.pass_threshold

    await db.commit()
    await db.refresh(row)
    return _row_to_dict(row)


@router.delete("/{suite_id}", status_code=204)
async def delete_suite(
    suite_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    result = await db.execute(
        select(EvalSuiteRow).where(
            EvalSuiteRow.id == suite_id,
            EvalSuiteRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Suite not found")
    await db.delete(row)
    await db.commit()
