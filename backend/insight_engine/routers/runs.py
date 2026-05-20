"""
Run history endpoints + manual /run-now trigger.
"""
import asyncio
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_pg_session
from orchestrator import run as run_discovery

router = APIRouter()


def _row(r) -> dict:
    d = dict(r._mapping)
    for k in ("started_at", "finished_at"):
        if d.get(k) and hasattr(d[k], "isoformat"):
            d[k] = d[k].isoformat()
    for jk in ("families_run", "family_durations_ms", "config_snapshot"):
        if isinstance(d.get(jk), str):
            try:
                d[jk] = json.loads(d[jk])
            except Exception:
                pass
    return d


@router.get("")
async def list_runs(tenant_id: str = "tenant-001",
                    limit: int = 30,
                    pg: AsyncSession = Depends(get_pg_session)):
    rows = await pg.execute(text(
        "SELECT * FROM insight_runs WHERE tenant_id = :t "
        "ORDER BY started_at DESC LIMIT :lim"
    ), {"t": tenant_id, "lim": int(limit)})
    return {"runs": [_row(r) for r in rows.fetchall()]}


@router.get("/{run_id}")
async def get_run(run_id: str, tenant_id: str = "tenant-001",
                   pg: AsyncSession = Depends(get_pg_session)):
    row = await pg.execute(text(
        "SELECT * FROM insight_runs WHERE id = :r AND tenant_id = :t"
    ), {"r": run_id, "t": tenant_id})
    r = row.fetchone()
    if not r:
        raise HTTPException(404, "Run not found")
    return _row(r)


@router.get("/{run_id}/report")
async def run_report(run_id: str, tenant_id: str = "tenant-001",
                      pg: AsyncSession = Depends(get_pg_session)):
    """Detailed per-run report: family breakdown + top insights from this run."""
    base = await pg.execute(text(
        "SELECT * FROM insight_runs WHERE id = :r AND tenant_id = :t"
    ), {"r": run_id, "t": tenant_id})
    b = base.fetchone()
    if not b:
        raise HTTPException(404, "Run not found")
    run = _row(b)
    fam_rows = await pg.execute(text(
        "SELECT family, COUNT(*) AS n, AVG(effect_size) AS avg_effect, "
        "       MAX(rank_score) AS top_rank "
        "FROM discovered_insights "
        "WHERE tenant_id = :t AND run_id = :r "
        "GROUP BY family"
    ), {"t": tenant_id, "r": run_id})
    families = [dict(r._mapping) for r in fam_rows.fetchall()]
    top_rows = await pg.execute(text(
        "SELECT id, family, title, effect_size, rank_score, status "
        "FROM discovered_insights "
        "WHERE tenant_id = :t AND run_id = :r "
        "ORDER BY rank_score DESC LIMIT 10"
    ), {"t": tenant_id, "r": run_id})
    return {
        "run": run,
        "families": families,
        "top_insights": [dict(r._mapping) for r in top_rows.fetchall()],
    }


@router.post("/run-now")
async def run_now(tenant_id: str = "tenant-001"):
    """Kick discovery immediately (manual override). Runs as a background
    task so the request returns quickly; the run_id is created synchronously
    so the caller can poll for completion."""
    # Pre-create the run row so we can return its id immediately.
    from database import PgSession, get_or_create_config
    from sqlalchemy import text as t
    cfg = await get_or_create_config(tenant_id)
    async with PgSession() as pg:
        row = await pg.execute(t(
            "INSERT INTO insight_runs (tenant_id, status, config_snapshot) "
            "VALUES (:t, 'queued', CAST(:c AS jsonb)) RETURNING id"
        ), {"t": tenant_id, "c": json.dumps({k: v for k, v in cfg.items()
                                              if isinstance(v, (str, int, float, bool, list, dict, type(None)))})})
        await pg.commit()
        queue_run_id = row.fetchone()._mapping["id"]

    async def _bg():
        await run_discovery(tenant_id, manual=True)
    asyncio.create_task(_bg())
    return {"queued_run_id": queue_run_id, "tenant_id": tenant_id}
