"""
CRUD for alert rules.
"""
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_pg_session

router = APIRouter()

VALID_RULE_TYPES = {
    "stuck_case",
    "slow_transition",
    "rework_spike",
    "case_volume_anomaly",
}


class RuleCreate(BaseModel):
    name: str
    rule_type: str
    object_type_id: str | None = None
    config: dict = {}
    cooldown_minutes: int = 60
    enabled: bool = True


class RuleUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None
    cooldown_minutes: int | None = None
    enabled: bool | None = None


@router.get("")
async def list_rules(
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    rows = await pg.execute(
        text(
            "SELECT r.*, lf.fired_at AS last_fired "
            "FROM alert_rules r "
            "LEFT JOIN alert_rule_last_fired lf ON lf.rule_id = r.id "
            "WHERE r.tenant_id = :tid "
            "ORDER BY r.created_at"
        ),
        {"tid": tenant_id},
    )
    rules = []
    for row in rows.fetchall():
        d = dict(row._mapping)
        if d.get("last_fired"):
            d["last_fired"] = d["last_fired"].isoformat()
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat()
        if d.get("updated_at"):
            d["updated_at"] = d["updated_at"].isoformat()
        rules.append(d)
    return {"rules": rules}


@router.post("", status_code=201)
async def create_rule(
    body: RuleCreate,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    if body.rule_type not in VALID_RULE_TYPES:
        raise HTTPException(400, f"Invalid rule_type. Valid: {sorted(VALID_RULE_TYPES)}")

    row = await pg.execute(
        text(
            "INSERT INTO alert_rules "
            "(tenant_id, name, rule_type, object_type_id, config, cooldown_minutes, enabled) "
            "VALUES (:tid, :name, :rtype, :otype, CAST(:cfg AS jsonb), :cool, :enabled) "
            "RETURNING id, name, rule_type, object_type_id, config, cooldown_minutes, enabled, created_at"
        ),
        {
            "tid": tenant_id,
            "name": body.name,
            "rtype": body.rule_type,
            "otype": body.object_type_id,
            "cfg": json.dumps(body.config),
            "cool": body.cooldown_minutes,
            "enabled": body.enabled,
        },
    )
    await pg.commit()
    result = dict(row.fetchone()._mapping)
    result["created_at"] = result["created_at"].isoformat()
    return result


@router.get("/{rule_id}")
async def get_rule(
    rule_id: str,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    row = await pg.execute(
        text(
            "SELECT * FROM alert_rules WHERE id = :id AND tenant_id = :tid"
        ),
        {"id": rule_id, "tid": tenant_id},
    )
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Rule not found")
    d = dict(r._mapping)
    d["created_at"] = d["created_at"].isoformat()
    d["updated_at"] = d["updated_at"].isoformat()
    return d


@router.patch("/{rule_id}")
async def update_rule(
    rule_id: str,
    body: RuleUpdate,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    sets = ["updated_at = NOW()"]
    params: dict = {"id": rule_id, "tid": tenant_id}

    if body.name is not None:
        sets.append("name = :name")
        params["name"] = body.name
    if body.config is not None:
        sets.append("config = CAST(:cfg AS jsonb)")
        params["cfg"] = json.dumps(body.config)
    if body.cooldown_minutes is not None:
        sets.append("cooldown_minutes = :cool")
        params["cool"] = body.cooldown_minutes
    if body.enabled is not None:
        sets.append("enabled = :enabled")
        params["enabled"] = body.enabled

    await pg.execute(
        text(f"UPDATE alert_rules SET {', '.join(sets)} WHERE id = :id AND tenant_id = :tid"),
        params,
    )
    await pg.commit()
    return await get_rule(rule_id, tenant_id, pg)


@router.delete("/{rule_id}", status_code=204)
async def delete_rule(
    rule_id: str,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    await pg.execute(
        text("DELETE FROM alert_rules WHERE id = :id AND tenant_id = :tid"),
        {"id": rule_id, "tid": tenant_id},
    )
    await pg.commit()


@router.post("/{rule_id}/test")
async def test_rule(
    rule_id: str,
    tenant_id: str = "tenant-001",
    pg: AsyncSession = Depends(get_pg_session),
):
    """Trigger immediate evaluation for this rule (ignores cooldown)."""
    from sqlalchemy import text as t
    row = await pg.execute(
        t("SELECT * FROM alert_rules WHERE id = :id AND tenant_id = :tid"),
        {"id": rule_id, "tid": tenant_id},
    )
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Rule not found")

    rule = dict(r._mapping)
    # Force cooldown to 0 for test
    rule["cooldown_minutes"] = 0
    rule["last_fired"] = None

    from evaluator import EVALUATORS
    from database import TsSession

    evaluator = EVALUATORS.get(rule["rule_type"])
    if not evaluator:
        raise HTTPException(400, "No evaluator for this rule type")

    async with TsSession() as ts:
        result = await evaluator(rule, ts)

    return {"triggered": result is not None, "result": result}
