"""
GET/PATCH insight_engine_config. PATCH triggers a scheduler reload so cron
changes take effect immediately.
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_pg_session, get_or_create_config

router = APIRouter()


def _row(r) -> dict:
    d = dict(r._mapping)
    for k in ("updated_at",):
        if d.get(k) and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    for jk in ("family_enabled", "family_priors", "feature_denylist", "outcome_denylist"):
        if isinstance(d.get(jk), str):
            try:
                d[jk] = json.loads(d[jk])
            except Exception:
                pass
    return d


@router.get("")
async def get_config(tenant_id: str = "tenant-001"):
    cfg = await get_or_create_config(tenant_id)
    return _row(type("R", (), {"_mapping": cfg})()) if isinstance(cfg, dict) else cfg


class PatchConfig(BaseModel):
    enabled: Optional[bool] = None
    schedule_cron: Optional[str] = None
    timezone: Optional[str] = None
    family_enabled: Optional[dict] = None
    family_priors: Optional[dict] = None
    max_tests: Optional[int] = None
    max_runtime_minutes: Optional[int] = None
    max_memory_mb: Optional[int] = None
    min_effect_size: Optional[float] = None
    min_sample_size: Optional[int] = None
    min_stability_score: Optional[float] = None
    feature_denylist: Optional[list] = None
    outcome_denylist: Optional[list] = None
    bootstrap_iterations: Optional[int] = None
    holdout_pct: Optional[float] = None
    keep_top_n: Optional[int] = None
    llm_titles_enabled: Optional[bool] = None
    embeddings_enabled: Optional[bool] = None
    causal_enabled: Optional[bool] = None
    cross_ot_enabled: Optional[bool] = None


@router.patch("")
async def patch_config(body: PatchConfig, tenant_id: str = "tenant-001",
                        pg: AsyncSession = Depends(get_pg_session)):
    await get_or_create_config(tenant_id)  # ensure row exists
    fields = body.dict(exclude_unset=True)
    if not fields:
        return await get_config(tenant_id)
    sets = []
    params: dict = {"t": tenant_id}
    json_fields = {"family_enabled", "family_priors", "feature_denylist", "outcome_denylist"}
    for k, v in fields.items():
        if k in json_fields:
            sets.append(f"{k} = CAST(:{k} AS jsonb)")
            params[k] = json.dumps(v)
        else:
            sets.append(f"{k} = :{k}")
            params[k] = v
    sets.append("updated_at = NOW()")
    await pg.execute(text(
        f"UPDATE insight_engine_config SET {', '.join(sets)} WHERE tenant_id = :t"
    ), params)
    await pg.commit()

    # Reload schedules so cron changes take effect immediately
    try:
        from scheduler import reload_schedules
        await reload_schedules()
    except Exception:
        pass

    return await get_config(tenant_id)
