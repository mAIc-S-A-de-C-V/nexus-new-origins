import os
import asyncio
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import attributes
from pydantic import BaseModel
from datetime import datetime, timezone
from uuid import uuid4
import httpx

from database import get_session, CompanyRow, TeamMemberRow, ProjectRow, ProjectStageRow

EVENT_LOG_URL = os.environ.get("EVENT_LOG_SERVICE_URL", "http://event-log-service:8005")


async def _emit(case_id: str, activity: str, tenant_id: str, attributes: dict = None):
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            await client.post(f"{EVENT_LOG_URL}/events", json={
                "id": str(uuid4()),
                "case_id": case_id,
                "activity": activity,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "object_type_id": "project",
                "object_id": case_id,
                "pipeline_id": "",
                "connector_id": "",
                "tenant_id": tenant_id,
                "attributes": attributes or {},
            })
    except Exception:
        pass

router = APIRouter()

DEFAULT_STAGES = [
    {"name": "Discovery",     "stageType": "discovery",    "color": "#7C3AED", "order": 0},
    {"name": "HUs",           "stageType": "hu",           "color": "#2563EB", "order": 1},
    {"name": "UX & Screens",  "stageType": "ux",           "color": "#DB2777", "order": 2},
    {"name": "Development",   "stageType": "development",  "color": "#059669", "order": 3},
    {"name": "Entrega",       "stageType": "entrega",      "color": "#D97706", "order": 4},
]

# ── Pydantic schemas ─────────────────────────────────────────────────────────

class CompanyIn(BaseModel):
    name: str
    color: str = "#2563EB"
    description: str = ""

class TeamMemberIn(BaseModel):
    name: str
    role: str  # pm | dev | qa | ux | explorer | analyst | other
    email: str = ""
    color: str = "#2563EB"

class ProjectIn(BaseModel):
    name: str
    description: str = ""
    objectTypeId: str = ""
    recordId: str = ""
    recordName: str = ""
    pmId: str = ""
    status: str = "active"

class StageIn(BaseModel):
    name: str
    stageType: str = "custom"
    parentId: str = ""
    assignedToId: str = ""
    startDate: str = ""
    endDate: str = ""
    color: str = "#475569"
    order: int = 0

class StageUpdate(BaseModel):
    name: Optional[str] = None
    stageType: Optional[str] = None
    assignedToId: Optional[str] = None
    startDate: Optional[str] = None
    endDate: Optional[str] = None
    color: Optional[str] = None
    order: Optional[int] = None
    progress: Optional[int] = None        # 0-100
    comments: Optional[list] = None       # list of {id, text, author, createdAt}

# ── Helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()

def _tid(x_tenant_id: Optional[str]) -> str:
    return x_tenant_id or "tenant-001"

# ── Companies ────────────────────────────────────────────────────────────────

@router.get("/companies")
async def list_companies(
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    rows = (await db.execute(select(CompanyRow).where(CompanyRow.tenant_id == tid))).scalars().all()
    return [r.data for r in rows]


@router.post("/companies", status_code=201)
async def create_company(
    body: CompanyIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    cid = str(uuid4())
    data = {**body.model_dump(), "id": cid, "createdAt": _now()}
    db.add(CompanyRow(id=cid, tenant_id=tid, data=data))
    await db.commit()
    return data


@router.put("/companies/{cid}")
async def update_company(
    cid: str,
    body: CompanyIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(CompanyRow).where(CompanyRow.id == cid, CompanyRow.tenant_id == tid))).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    row.data = {**row.data, **body.model_dump()}
    attributes.flag_modified(row, "data")
    await db.commit()
    return row.data


@router.delete("/companies/{cid}", status_code=204)
async def delete_company(
    cid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(CompanyRow).where(CompanyRow.id == cid, CompanyRow.tenant_id == tid))).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()

# ── Team Members ─────────────────────────────────────────────────────────────

@router.get("/companies/{cid}/members")
async def list_members(
    cid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    rows = (await db.execute(
        select(TeamMemberRow).where(TeamMemberRow.tenant_id == tid, TeamMemberRow.company_id == cid)
    )).scalars().all()
    return [r.data for r in rows]


@router.post("/companies/{cid}/members", status_code=201)
async def create_member(
    cid: str,
    body: TeamMemberIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    mid = str(uuid4())
    data = {**body.model_dump(), "id": mid, "companyId": cid, "createdAt": _now()}
    db.add(TeamMemberRow(id=mid, tenant_id=tid, company_id=cid, data=data))
    await db.commit()
    return data


@router.put("/members/{mid}")
async def update_member(
    mid: str,
    body: TeamMemberIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(TeamMemberRow).where(TeamMemberRow.id == mid, TeamMemberRow.tenant_id == tid))).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    row.data = {**row.data, **body.model_dump()}
    attributes.flag_modified(row, "data")
    await db.commit()
    return row.data


@router.delete("/members/{mid}", status_code=204)
async def delete_member(
    mid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(TeamMemberRow).where(TeamMemberRow.id == mid, TeamMemberRow.tenant_id == tid))).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()

# ── Projects ─────────────────────────────────────────────────────────────────

@router.get("/projects/all")
async def list_all_projects(
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    """Returns all projects with their stages, progress, and comments embedded."""
    tid = _tid(x_tenant_id)
    project_rows = (await db.execute(
        select(ProjectRow).where(ProjectRow.tenant_id == tid)
    )).scalars().all()

    # Fetch all stages for all projects in one query
    all_stage_rows = (await db.execute(
        select(ProjectStageRow).where(ProjectStageRow.tenant_id == tid)
    )).scalars().all()

    # Index stages by project_id
    stages_by_project: dict = {}
    for sr in all_stage_rows:
        pid = sr.project_id
        if pid not in stages_by_project:
            stages_by_project[pid] = []
        stages_by_project[pid].append(sr.data)

    # Fetch company names for context
    company_rows = (await db.execute(
        select(CompanyRow).where(CompanyRow.tenant_id == tid)
    )).scalars().all()
    company_names = {r.id: r.data.get("name", "") for r in company_rows}

    result = []
    for pr in project_rows:
        p = dict(pr.data)
        stages = sorted(stages_by_project.get(pr.id, []), key=lambda s: s.get("order", 0))
        p["company_name"] = company_names.get(pr.company_id, "")
        p["stages"] = stages
        p["total_progress"] = (
            sum(s.get("progress", 0) for s in stages) // len(stages) if stages else 0
        )
        p["total_comments"] = sum(len(s.get("comments", [])) for s in stages)
        p["all_comments"] = [
            {**c, "stage_name": s.get("name"), "stage_type": s.get("stageType")}
            for s in stages
            for c in s.get("comments", [])
        ]
        result.append(p)
    return result


@router.get("/members/all")
async def list_all_members(
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    """Returns all members with their stage assignments and comments made."""
    tid = _tid(x_tenant_id)
    member_rows = (await db.execute(
        select(TeamMemberRow).where(TeamMemberRow.tenant_id == tid)
    )).scalars().all()

    # Fetch all projects and stages to build activity context
    project_rows = (await db.execute(
        select(ProjectRow).where(ProjectRow.tenant_id == tid)
    )).scalars().all()
    project_names = {r.id: r.data.get("name", "") for r in project_rows}

    all_stage_rows = (await db.execute(
        select(ProjectStageRow).where(ProjectStageRow.tenant_id == tid)
    )).scalars().all()

    result = []
    for mr in member_rows:
        m = dict(mr.data)
        mid = mr.id

        # Stages assigned to this member
        assignments = []
        comments_made = []
        for sr in all_stage_rows:
            s = sr.data
            project_name = project_names.get(s.get("projectId", ""), "")
            if s.get("assignedToId") == mid:
                assignments.append({
                    "project_name": project_name,
                    "stage_name": s.get("name"),
                    "stage_type": s.get("stageType"),
                    "progress": s.get("progress", 0),
                    "start_date": s.get("startDate", ""),
                    "end_date": s.get("endDate", ""),
                })
            # Comments made by this member (matched by name)
            for c in s.get("comments", []):
                if c.get("author") == m.get("name"):
                    comments_made.append({
                        "project_name": project_name,
                        "stage_name": s.get("name"),
                        "text": c.get("text", ""),
                        "created_at": c.get("createdAt", ""),
                    })

        m["assignments"] = assignments
        m["comments_made"] = comments_made
        m["active_stages"] = len([a for a in assignments if a["progress"] < 100])
        result.append(m)
    return result


@router.get("/companies/{cid}/projects")
async def list_projects(
    cid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    rows = (await db.execute(
        select(ProjectRow).where(ProjectRow.tenant_id == tid, ProjectRow.company_id == cid)
    )).scalars().all()
    return [r.data for r in rows]


@router.post("/companies/{cid}/projects", status_code=201)
async def create_project(
    cid: str,
    body: ProjectIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    pid = str(uuid4())
    data = {**body.model_dump(), "id": pid, "companyId": cid, "createdAt": _now()}
    db.add(ProjectRow(id=pid, tenant_id=tid, company_id=cid, data=data))
    asyncio.create_task(_emit(pid, "PROJECT_CREATED", tid, {"name": body.name, "company_id": cid, "pm_id": body.pmId}))

    # Auto-create the 5 default stages
    for tmpl in DEFAULT_STAGES:
        sid = str(uuid4())
        sdata = {
            **tmpl,
            "id": sid,
            "projectId": pid,
            "parentId": "",
            "assignedToId": "",
            "startDate": "",
            "endDate": "",
        }
        db.add(ProjectStageRow(id=sid, tenant_id=tid, project_id=pid, data=sdata))

    await db.commit()
    return data


@router.get("/{pid}")
async def get_project(
    pid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(ProjectRow).where(ProjectRow.id == pid, ProjectRow.tenant_id == tid))).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    stage_rows = (await db.execute(
        select(ProjectStageRow).where(ProjectStageRow.project_id == pid, ProjectStageRow.tenant_id == tid)
    )).scalars().all()
    stages = sorted([r.data for r in stage_rows], key=lambda s: (s.get("order", 0), s.get("name", "")))
    return {**row.data, "stages": stages}


@router.put("/{pid}")
async def update_project(
    pid: str,
    body: ProjectIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(ProjectRow).where(ProjectRow.id == pid, ProjectRow.tenant_id == tid))).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    old_status = row.data.get("status")
    old_pm = row.data.get("pmId")
    row.data = {**row.data, **body.model_dump()}
    attributes.flag_modified(row, "data")
    await db.commit()
    if old_status != body.status:
        asyncio.create_task(_emit(pid, "PROJECT_STATUS_CHANGED", tid, {"from": old_status, "to": body.status}))
    if old_pm != body.pmId:
        asyncio.create_task(_emit(pid, "PROJECT_PM_ASSIGNED", tid, {"from_pm": old_pm, "to_pm": body.pmId}))
    return row.data


@router.delete("/{pid}", status_code=204)
async def delete_project(
    pid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(ProjectRow).where(ProjectRow.id == pid, ProjectRow.tenant_id == tid))).scalar_one_or_none()
    if row:
        # Delete stages first
        stage_rows = (await db.execute(select(ProjectStageRow).where(ProjectStageRow.project_id == pid))).scalars().all()
        for sr in stage_rows:
            await db.delete(sr)
        await db.delete(row)
        await db.commit()

# ── Stages ───────────────────────────────────────────────────────────────────

@router.post("/{pid}/stages", status_code=201)
async def create_stage(
    pid: str,
    body: StageIn,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    sid = str(uuid4())
    data = {**body.model_dump(), "id": sid, "projectId": pid}
    db.add(ProjectStageRow(id=sid, tenant_id=tid, project_id=pid, data=data))
    await db.commit()
    return data


@router.put("/stages/{sid}")
async def update_stage(
    sid: str,
    body: StageUpdate,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(ProjectStageRow).where(ProjectStageRow.id == sid, ProjectStageRow.tenant_id == tid))).scalar_one_or_none()
    if not row:
        raise HTTPException(404)
    patch = {k: v for k, v in body.model_dump().items() if v is not None or k in ('progress', 'comments')}
    old_progress = row.data.get("progress")
    old_assignee = row.data.get("assignedToId")
    row.data = {**row.data, **patch}
    attributes.flag_modified(row, "data")
    await db.commit()
    pid = row.data.get("projectId", sid)
    if body.progress is not None and old_progress != body.progress:
        asyncio.create_task(_emit(pid, "STAGE_PROGRESS_UPDATED", tid, {"stage_type": row.data.get("stageType"), "from": old_progress, "to": body.progress}))
    if body.assignedToId and old_assignee != body.assignedToId:
        asyncio.create_task(_emit(pid, "STAGE_ASSIGNED", tid, {"stage_type": row.data.get("stageType"), "assigned_to_id": body.assignedToId}))
    if body.comments is not None:
        asyncio.create_task(_emit(pid, "COMMENT_ADDED", tid, {"stage_type": row.data.get("stageType"), "comment_count": len(body.comments)}))
    return row.data


@router.delete("/stages/{sid}", status_code=204)
async def delete_stage(
    sid: str,
    db: AsyncSession = Depends(get_session),
    x_tenant_id: Optional[str] = Header(None),
):
    tid = _tid(x_tenant_id)
    row = (await db.execute(select(ProjectStageRow).where(ProjectStageRow.id == sid, ProjectStageRow.tenant_id == tid))).scalar_one_or_none()
    if row:
        await db.delete(row)
        await db.commit()
