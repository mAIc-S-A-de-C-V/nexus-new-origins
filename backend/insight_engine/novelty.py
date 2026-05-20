"""
Novelty scoring vs previous-run findings. For each new finding, look up
prior-run findings with the same (object_type_id, family, feature.name,
outcome.name) signature within the last 3 runs and:

  - Set `prior_insight_id` to the most recent matching prior finding
  - Compute `novelty_score` = 1 - (recurrence_decay × 0.7) where recurrence
    is the number of past runs that produced this signature

A brand-new finding gets novelty=1.0 (full boost in ranker). A signature
seen in all of the last 3 runs gets novelty ≈ 0.3.
"""
import logging
from sqlalchemy import text

from database import PgSession

log = logging.getLogger(__name__)


def _signature(f: dict) -> str:
    return "|".join([
        f.get("object_type_id") or "",
        f.get("family") or "",
        (f.get("feature") or {}).get("name") or "",
        (f.get("outcome") or {}).get("name") or "",
    ])


async def annotate_novelty(tenant_id: str, findings: list[dict],
                             lookback_runs: int = 3) -> None:
    if not findings:
        return
    async with PgSession() as pg:
        row = await pg.execute(text(
            "SELECT id FROM insight_runs "
            "WHERE tenant_id = :t AND status = 'ok' "
            "  AND finished_at IS NOT NULL "
            "ORDER BY finished_at DESC LIMIT :lim"
        ), {"t": tenant_id, "lim": lookback_runs})
        prior_run_ids = [r[0] for r in row.fetchall()]

        if not prior_run_ids:
            for f in findings:
                f["novelty_score"] = 1.0
            return

        # Build per-signature counts and most-recent id from prior runs
        rows = await pg.execute(text(
            "SELECT id, object_type_id, family, feature, outcome, run_id, discovered_at "
            "FROM discovered_insights "
            "WHERE tenant_id = :t AND run_id = ANY(:rids) "
        ), {"t": tenant_id, "rids": prior_run_ids})
        prior = rows.fetchall()

    sig_count: dict[str, int] = {}
    sig_latest: dict[str, str] = {}
    for r in prior:
        m = r._mapping
        feat = m["feature"]
        out = m["outcome"]
        if isinstance(feat, str):
            import json
            try:
                feat = json.loads(feat)
            except Exception:
                feat = {}
        if isinstance(out, str):
            import json
            try:
                out = json.loads(out)
            except Exception:
                out = {}
        sig = "|".join([m["object_type_id"] or "", m["family"] or "",
                         (feat or {}).get("name") or "",
                         (out or {}).get("name") or ""])
        sig_count[sig] = sig_count.get(sig, 0) + 1
        if sig not in sig_latest:
            sig_latest[sig] = m["id"]

    for f in findings:
        sig = _signature(f)
        recur = sig_count.get(sig, 0)
        # 0 → 1.0; 1 → 0.6; 2 → 0.4; 3+ → 0.3
        if recur == 0:
            f["novelty_score"] = 1.0
        elif recur == 1:
            f["novelty_score"] = 0.6
        elif recur == 2:
            f["novelty_score"] = 0.4
        else:
            f["novelty_score"] = 0.3
        if sig in sig_latest:
            f["prior_insight_id"] = sig_latest[sig]
