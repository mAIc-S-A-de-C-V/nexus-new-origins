"""
Promote an insight to a correlation_alert rule in alert_engine. Marks the
insight `status='promoted'` and stamps the new rule_id into evidence.
"""
import json
import logging
from sqlalchemy import text

from database import PgSession
from clients.alert_engine import create_correlation_alert_rule

log = logging.getLogger(__name__)


async def promote_insight_to_alert(tenant_id: str, insight_id: str,
                                    threshold: float = 0.3) -> dict | None:
    async with PgSession() as pg:
        row = await pg.execute(text(
            "SELECT * FROM discovered_insights WHERE id = :i AND tenant_id = :t"
        ), {"i": insight_id, "t": tenant_id})
        r = row.fetchone()
        if not r:
            return None
        ins = dict(r._mapping)

    rule = await create_correlation_alert_rule(
        tenant_id=tenant_id,
        insight_id=insight_id,
        insight_title=ins.get("title") or "Insight",
        threshold=threshold,
    )
    if not rule:
        return None

    async with PgSession() as pg:
        evidence = ins.get("evidence") or {}
        if isinstance(evidence, str):
            try:
                evidence = json.loads(evidence)
            except Exception:
                evidence = {}
        evidence["promoted_rule_id"] = rule.get("id")
        evidence["promoted_at"] = rule.get("created_at")
        await pg.execute(text(
            "UPDATE discovered_insights "
            "SET status = 'promoted', evidence = CAST(:ev AS jsonb) "
            "WHERE id = :i AND tenant_id = :t"
        ), {"ev": json.dumps(evidence), "i": insight_id, "t": tenant_id})
        await pg.commit()

    return rule
