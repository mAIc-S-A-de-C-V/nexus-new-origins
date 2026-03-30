"""
Alert rule evaluator — checks each enabled rule against live data.
Runs on a schedule via scheduler.py.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import text
from database import PgSession, TsSession

log = logging.getLogger(__name__)

# ── SQL helpers ────────────────────────────────────────────────────────────────

_SYSTEM_EXCL = (
    "AND activity NOT IN ("
    "'PIPELINE_RUN_STARTED','PIPELINE_RUN_COMPLETED','PIPELINE_RUN_FAILED',"
    "'PIPELINE_COMPLETED','PIPELINE_FAILED',"
    "'CONNECTOR_SCHEMA_FETCHED','CONNECTOR_TEST_PASSED','CONNECTOR_TEST_FAILED',"
    "'RECORD_SYNCED'"
    ")"
)


async def _get_enabled_rules(pg) -> list[dict]:
    rows = await pg.execute(
        text(
            "SELECT r.*, lf.fired_at AS last_fired "
            "FROM alert_rules r "
            "LEFT JOIN alert_rule_last_fired lf ON lf.rule_id = r.id "
            "WHERE r.enabled = TRUE "
            "ORDER BY r.created_at"
        )
    )
    return [dict(r._mapping) for r in rows.fetchall()]


async def _cooldown_ok(rule: dict) -> bool:
    """Return True if enough time has passed since the rule last fired."""
    last_fired = rule.get("last_fired")
    if last_fired is None:
        return True
    now = datetime.now(timezone.utc)
    if last_fired.tzinfo is None:
        last_fired = last_fired.replace(tzinfo=timezone.utc)
    elapsed_minutes = (now - last_fired).total_seconds() / 60
    return elapsed_minutes >= rule["cooldown_minutes"]


async def _record_fired(pg, rule_id: str, rule_name: str, rule_type: str,
                         severity: str, message: str, details: dict, tenant_id: str):
    import json
    await pg.execute(
        text(
            "INSERT INTO alert_notifications "
            "(tenant_id, rule_id, rule_name, rule_type, severity, message, details) "
            "VALUES (:tid, :rid, :rname, :rtype, :sev, :msg, CAST(:det AS jsonb))"
        ),
        {
            "tid": tenant_id,
            "rid": rule_id,
            "rname": rule_name,
            "rtype": rule_type,
            "sev": severity,
            "msg": message,
            "det": json.dumps(details),
        },
    )
    await pg.execute(
        text(
            "INSERT INTO alert_rule_last_fired (rule_id, fired_at) "
            "VALUES (:rid, NOW()) "
            "ON CONFLICT (rule_id) DO UPDATE SET fired_at = NOW()"
        ),
        {"rid": rule_id},
    )
    await pg.commit()
    log.info("Alert fired: rule=%s type=%s message=%s", rule_name, rule_type, message)


# ── Rule evaluators ────────────────────────────────────────────────────────────

async def _eval_stuck_case(rule: dict, ts):
    cfg = rule["config"]
    otype = rule.get("object_type_id") or cfg.get("object_type_id", "")
    threshold_hours = float(cfg.get("threshold_hours", 72))
    tenant_id = rule["tenant_id"]

    sql = f"""
        WITH last_events AS (
            SELECT case_id,
                   MAX(timestamp) AS last_ts,
                   MAX(activity)  AS current_activity
            FROM events
            WHERE tenant_id = :tid
              AND object_type_id = :otype
              {_SYSTEM_EXCL}
            GROUP BY case_id
        )
        SELECT case_id, current_activity,
               EXTRACT(EPOCH FROM (NOW() - last_ts)) / 3600 AS hours_stuck
        FROM last_events
        WHERE EXTRACT(EPOCH FROM (NOW() - last_ts)) / 3600 > :thresh
        ORDER BY hours_stuck DESC
        LIMIT 20
    """
    rows = await ts.execute(
        text(sql), {"tid": tenant_id, "otype": otype, "thresh": threshold_hours}
    )
    stuck = [dict(r._mapping) for r in rows.fetchall()]
    if not stuck:
        return None

    return {
        "severity": "critical" if threshold_hours >= 120 else "warning",
        "message": f"{len(stuck)} case(s) stuck for >{threshold_hours:.0f}h in {otype}",
        "details": {"stuck_cases": stuck[:5], "total_stuck": len(stuck)},
    }


async def _eval_slow_transition(rule: dict, ts):
    cfg = rule["config"]
    otype = rule.get("object_type_id") or cfg.get("object_type_id", "")
    from_act = cfg.get("from_activity", "")
    to_act = cfg.get("to_activity", "")
    threshold_hours = float(cfg.get("threshold_hours", 48))
    tenant_id = rule["tenant_id"]

    sql = f"""
        WITH transitions AS (
            SELECT
                a.case_id,
                a.activity AS from_activity,
                b.activity AS to_activity,
                EXTRACT(EPOCH FROM (b.timestamp - a.timestamp)) / 3600 AS hours
            FROM events a
            JOIN events b
              ON b.case_id = a.case_id
             AND b.object_type_id = a.object_type_id
             AND b.tenant_id = a.tenant_id
             AND b.timestamp > a.timestamp
             AND NOT EXISTS (
                 SELECT 1 FROM events c
                 WHERE c.case_id = a.case_id
                   AND c.tenant_id = a.tenant_id
                   AND c.timestamp > a.timestamp
                   AND c.timestamp < b.timestamp
             )
            WHERE a.tenant_id = :tid
              AND a.object_type_id = :otype
              AND a.activity = :from_act
              AND b.activity = :to_act
        )
        SELECT AVG(hours) AS avg_hours, COUNT(*) AS sample_count
        FROM transitions
        WHERE hours > :thresh
    """
    rows = await ts.execute(
        text(sql),
        {"tid": tenant_id, "otype": otype, "from_act": from_act,
         "to_act": to_act, "thresh": threshold_hours},
    )
    row = rows.fetchone()
    if not row or not row.sample_count:
        return None

    return {
        "severity": "warning",
        "message": (
            f"Transition {from_act}→{to_act} averaging "
            f"{row.avg_hours:.1f}h (threshold: {threshold_hours:.0f}h)"
        ),
        "details": {
            "from_activity": from_act,
            "to_activity": to_act,
            "avg_hours": float(row.avg_hours),
            "sample_count": int(row.sample_count),
        },
    }


async def _eval_rework_spike(rule: dict, ts):
    cfg = rule["config"]
    otype = rule.get("object_type_id") or cfg.get("object_type_id", "")
    threshold_pct = float(cfg.get("threshold_pct", 20))
    tenant_id = rule["tenant_id"]

    sql = f"""
        WITH case_events AS (
            SELECT case_id,
                   activity,
                   LAG(activity) OVER (PARTITION BY case_id ORDER BY timestamp) AS prev_activity
            FROM events
            WHERE tenant_id = :tid
              AND object_type_id = :otype
              {_SYSTEM_EXCL}
        ),
        rework_cases AS (
            SELECT DISTINCT case_id
            FROM case_events
            WHERE activity = prev_activity
        )
        SELECT
            COUNT(DISTINCT r.case_id)::float / NULLIF(COUNT(DISTINCT e.case_id), 0) * 100 AS rework_pct,
            COUNT(DISTINCT e.case_id) AS total_cases
        FROM events e
        LEFT JOIN rework_cases r ON r.case_id = e.case_id
        WHERE e.tenant_id = :tid
          AND e.object_type_id = :otype
          {_SYSTEM_EXCL}
    """
    rows = await ts.execute(text(sql), {"tid": tenant_id, "otype": otype})
    row = rows.fetchone()
    if not row or not row.total_cases or not row.rework_pct:
        return None

    rework_pct = float(row.rework_pct or 0)
    if rework_pct < threshold_pct:
        return None

    return {
        "severity": "warning",
        "message": f"Rework rate {rework_pct:.1f}% exceeds threshold {threshold_pct:.0f}% in {otype}",
        "details": {
            "rework_pct": rework_pct,
            "threshold_pct": threshold_pct,
            "total_cases": int(row.total_cases),
        },
    }


async def _eval_case_volume_anomaly(rule: dict, ts):
    cfg = rule["config"]
    otype = rule.get("object_type_id") or cfg.get("object_type_id", "")
    window_hours = int(cfg.get("window_hours", 24))
    min_drop_pct = float(cfg.get("min_drop_pct", 50))
    tenant_id = rule["tenant_id"]

    sql = f"""
        WITH buckets AS (
            SELECT
                DATE_TRUNC('hour', timestamp) AS hour,
                COUNT(DISTINCT case_id) AS case_count
            FROM events
            WHERE tenant_id = :tid
              AND object_type_id = :otype
              AND timestamp >= NOW() - INTERVAL '7 days'
              {_SYSTEM_EXCL}
            GROUP BY 1
        ),
        recent AS (
            SELECT AVG(case_count) AS avg_recent
            FROM buckets
            WHERE hour >= NOW() - (:window_hours || ' hours')::INTERVAL
        ),
        baseline AS (
            SELECT AVG(case_count) AS avg_baseline
            FROM buckets
            WHERE hour < NOW() - (:window_hours || ' hours')::INTERVAL
        )
        SELECT r.avg_recent, b.avg_baseline,
               CASE WHEN b.avg_baseline > 0
                    THEN (b.avg_baseline - r.avg_recent) / b.avg_baseline * 100
                    ELSE 0
               END AS drop_pct
        FROM recent r, baseline b
    """
    rows = await ts.execute(
        text(sql), {"tid": tenant_id, "otype": otype, "window_hours": window_hours}
    )
    row = rows.fetchone()
    if not row or not row.avg_baseline or not row.drop_pct:
        return None

    drop_pct = float(row.drop_pct or 0)
    if drop_pct < min_drop_pct:
        return None

    return {
        "severity": "critical",
        "message": (
            f"Case volume dropped {drop_pct:.0f}% vs baseline "
            f"(recent avg: {row.avg_recent:.1f}/hr, baseline: {row.avg_baseline:.1f}/hr)"
        ),
        "details": {
            "drop_pct": drop_pct,
            "avg_recent": float(row.avg_recent or 0),
            "avg_baseline": float(row.avg_baseline),
        },
    }


# ── Evaluator dispatch ─────────────────────────────────────────────────────────

EVALUATORS = {
    "stuck_case": _eval_stuck_case,
    "slow_transition": _eval_slow_transition,
    "rework_spike": _eval_rework_spike,
    "case_volume_anomaly": _eval_case_volume_anomaly,
}


async def run_evaluation_cycle():
    """Called by the scheduler every minute."""
    async with PgSession() as pg:
        rules = await _get_enabled_rules(pg)

    for rule in rules:
        rule_type = rule["rule_type"]
        evaluator = EVALUATORS.get(rule_type)
        if evaluator is None:
            continue

        if not await _cooldown_ok(rule):
            continue

        try:
            async with TsSession() as ts:
                result = await evaluator(rule, ts)

            if result:
                async with PgSession() as pg:
                    await _record_fired(
                        pg,
                        rule_id=rule["id"],
                        rule_name=rule["name"],
                        rule_type=rule_type,
                        severity=result["severity"],
                        message=result["message"],
                        details=result["details"],
                        tenant_id=rule["tenant_id"],
                    )
        except Exception as exc:
            log.error("Error evaluating rule %s (%s): %s", rule["name"], rule_type, exc)
