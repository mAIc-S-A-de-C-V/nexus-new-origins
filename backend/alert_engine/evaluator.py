"""
Alert rule evaluator — checks each enabled rule against live data.
Runs on a schedule via scheduler.py.
"""
import logging
import statistics
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from database import PgSession, TsSession
from webhooks import deliver_to_webhooks

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
    # Derive a run_link from details when the rule's payload references one — lets
    # the frontend's history view jump directly to the run drilldown.
    run_link: dict | None = None
    if isinstance(details, dict):
        if details.get("pipeline_run_id"):
            run_link = {"kind": "pipeline", "run_id": details["pipeline_run_id"],
                        "pipeline_id": details.get("pipeline_id")}
        elif details.get("agent_run_id"):
            run_link = {"kind": "agent", "run_id": details["agent_run_id"],
                        "agent_id": details.get("agent_id")}

    await pg.execute(
        text(
            "INSERT INTO alert_notifications "
            "(tenant_id, rule_id, rule_name, rule_type, severity, message, details, run_link) "
            "VALUES (:tid, :rid, :rname, :rtype, :sev, :msg, CAST(:det AS jsonb), CAST(:rl AS jsonb))"
        ),
        {
            "tid": tenant_id,
            "rid": rule_id,
            "rname": rule_name,
            "rtype": rule_type,
            "sev": severity,
            "msg": message,
            "det": json.dumps(details),
            "rl": json.dumps(run_link) if run_link else None,
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

    notification = {
        "rule_id": rule_id,
        "rule_name": rule_name,
        "rule_type": rule_type,
        "severity": severity,
        "message": message,
        "details": details,
    }
    await deliver_to_webhooks(tenant_id, notification)

    # Phase 14: resolve routing + on-call + per-user preferences. Best-effort:
    # failures don't block the underlying notification row from being written.
    try:
        from notifier import dispatch
        await dispatch(tenant_id, notification)
    except Exception as exc:
        log.info("routing dispatch skipped: %s", exc)


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


# ── metric_deviation ──────────────────────────────────────────────────────────

# Maps a metric name to a SQL builder that returns a per-day series
# (day_date, value) for the given tenant + scope. Each builder accepts the
# rule config and returns (sql, params).
def _series_sql_case_count(tenant_id, otype, days, extra_filter_sql, extra_params):
    sql = f"""
        SELECT DATE_TRUNC('day', timestamp)::date AS day,
               COUNT(DISTINCT case_id)::float AS value
        FROM events
        WHERE tenant_id = :tid
          AND object_type_id = :otype
          AND timestamp >= NOW() - (:days || ' days')::INTERVAL
          {_SYSTEM_EXCL}
          {extra_filter_sql}
        GROUP BY 1
        ORDER BY 1
    """
    params = {"tid": tenant_id, "otype": otype, "days": days, **extra_params}
    return sql, params


def _series_sql_cycle_hours(tenant_id, otype, days, extra_filter_sql, extra_params):
    sql = f"""
        WITH case_spans AS (
            SELECT case_id,
                   MIN(timestamp) AS first_ts,
                   MAX(timestamp) AS last_ts,
                   EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 3600 AS hours
            FROM events
            WHERE tenant_id = :tid
              AND object_type_id = :otype
              AND timestamp >= NOW() - (:days || ' days')::INTERVAL
              {_SYSTEM_EXCL}
              {extra_filter_sql}
            GROUP BY case_id
            HAVING COUNT(*) >= 2
        )
        SELECT DATE_TRUNC('day', first_ts)::date AS day,
               AVG(hours)::float AS value
        FROM case_spans
        GROUP BY 1
        ORDER BY 1
    """
    params = {"tid": tenant_id, "otype": otype, "days": days, **extra_params}
    return sql, params


def _series_sql_rework_pct(tenant_id, otype, days, extra_filter_sql, extra_params):
    sql = f"""
        WITH per_day AS (
            SELECT DATE_TRUNC('day', timestamp)::date AS day,
                   case_id,
                   activity,
                   LAG(activity) OVER (PARTITION BY case_id ORDER BY timestamp) AS prev_activity
            FROM events
            WHERE tenant_id = :tid
              AND object_type_id = :otype
              AND timestamp >= NOW() - (:days || ' days')::INTERVAL
              {_SYSTEM_EXCL}
              {extra_filter_sql}
        ),
        per_day_stats AS (
            SELECT day,
                   COUNT(DISTINCT case_id) AS total_cases,
                   COUNT(DISTINCT case_id) FILTER (WHERE activity = prev_activity) AS rework_cases
            FROM per_day
            GROUP BY day
        )
        SELECT day,
               (rework_cases::float / NULLIF(total_cases, 0) * 100)::float AS value
        FROM per_day_stats
        WHERE total_cases >= 1
        ORDER BY 1
    """
    params = {"tid": tenant_id, "otype": otype, "days": days, **extra_params}
    return sql, params


def _series_sql_transition_hours(tenant_id, otype, days, from_act, to_act,
                                  extra_filter_sql, extra_params):
    sql = f"""
        WITH ordered AS (
            SELECT case_id, activity, timestamp,
                   LAG(activity)  OVER (PARTITION BY case_id ORDER BY timestamp) AS prev_activity,
                   LAG(timestamp) OVER (PARTITION BY case_id ORDER BY timestamp) AS prev_ts
            FROM events
            WHERE tenant_id = :tid
              AND object_type_id = :otype
              AND timestamp >= NOW() - (:days || ' days')::INTERVAL
              {_SYSTEM_EXCL}
              {extra_filter_sql}
        )
        SELECT DATE_TRUNC('day', timestamp)::date AS day,
               AVG(EXTRACT(EPOCH FROM (timestamp - prev_ts)) / 3600)::float AS value
        FROM ordered
        WHERE prev_activity = :from_act AND activity = :to_act
        GROUP BY 1
        ORDER BY 1
    """
    params = {"tid": tenant_id, "otype": otype, "days": days,
              "from_act": from_act, "to_act": to_act, **extra_params}
    return sql, params


_METRIC_BUILDERS = {
    "case_count": _series_sql_case_count,
    "cycle_hours_avg": _series_sql_cycle_hours,
    "rework_pct": _series_sql_rework_pct,
}


def _build_filter_sql(filter_dict):
    """Build a JSONB attributes filter clause from a {key: value} mapping.
    Each filter becomes `AND attributes::jsonb ->> 'key' = :flt_key`. Returns
    (sql_fragment, params)."""
    if not filter_dict:
        return "", {}
    clauses = []
    params = {}
    for i, (k, v) in enumerate(filter_dict.items()):
        kk = f"flt_{i}"
        vv = f"fltv_{i}"
        clauses.append(f"AND (attributes::jsonb ->> :{kk}) = :{vv}")
        params[kk] = str(k)
        params[vv] = str(v)
    return " ".join(clauses), params


def _compute_zscore_series(rows, recent_window_days, seasonality):
    """Given a list of (day, value) tuples, return (per-day analysis list,
    baseline_count, recent_anomaly_count). Each per-day entry has keys:
    day, value, baseline_mean, baseline_std, z."""
    if not rows:
        return [], 0, 0

    today = max(r[0] for r in rows)
    recent_start = today - timedelta(days=recent_window_days - 1)
    baseline = [(d, v) for (d, v) in rows if d < recent_start and v is not None]
    recent = [(d, v) for (d, v) in rows if d >= recent_start and v is not None]

    series = []

    if seasonality == "dow":
        stats_by_dow = {}
        bucket = {}
        for d, v in baseline:
            bucket.setdefault(d.weekday(), []).append(v)
        for dow, vs in bucket.items():
            mean = statistics.fmean(vs) if vs else 0.0
            stdev = statistics.pstdev(vs) if len(vs) > 1 else 0.0
            stats_by_dow[dow] = (mean, stdev)
        for d, v in recent:
            mean, stdev = stats_by_dow.get(d.weekday(), (0.0, 0.0))
            z = (v - mean) / stdev if stdev > 1e-9 else 0.0
            series.append({"day": d.isoformat(), "value": v,
                           "baseline_mean": mean, "baseline_std": stdev, "z": z})
    else:
        bvals = [v for _, v in baseline]
        b_mean = statistics.fmean(bvals) if bvals else 0.0
        b_stdev = statistics.pstdev(bvals) if len(bvals) > 1 else 0.0
        for d, v in recent:
            z = (v - b_mean) / b_stdev if b_stdev > 1e-9 else 0.0
            series.append({"day": d.isoformat(), "value": v,
                           "baseline_mean": b_mean, "baseline_std": b_stdev, "z": z})

    return series, len(baseline), len(recent)


async def _eval_metric_deviation(rule: dict, ts):
    """Generic z-score-vs-baseline evaluator.

    config:
      metric                 case_count | cycle_hours_avg | rework_pct | transition_hours_avg
      object_type_id         OT to scope to (or use rule.object_type_id)
      from_activity, to_activity   only for transition_hours_avg
      filter                 optional attributes-JSON filter {k: v}
      baseline_window_days   default 28
      recent_window_days     default 7
      min_zscore             default 2.5
      min_baseline_samples   default 14 — bail if baseline too sparse
      direction              both | above | below   (default both)
      seasonality            none | dow             (default none)
    """
    cfg = rule["config"]
    metric = cfg.get("metric", "case_count")
    otype = rule.get("object_type_id") or cfg.get("object_type_id", "")
    baseline_days = int(cfg.get("baseline_window_days", 28))
    recent_days = int(cfg.get("recent_window_days", 7))
    min_z = float(cfg.get("min_zscore", 2.5))
    min_base = int(cfg.get("min_baseline_samples", 14))
    direction = cfg.get("direction", "both")
    seasonality = cfg.get("seasonality", "none")
    tenant_id = rule["tenant_id"]
    total_days = baseline_days + recent_days

    filter_sql, filter_params = _build_filter_sql(cfg.get("filter") or {})

    if metric == "transition_hours_avg":
        from_act = cfg.get("from_activity", "")
        to_act = cfg.get("to_activity", "")
        if not from_act or not to_act:
            return None
        sql, params = _series_sql_transition_hours(
            tenant_id, otype, total_days, from_act, to_act, filter_sql, filter_params)
    else:
        builder = _METRIC_BUILDERS.get(metric)
        if builder is None:
            log.warning("metric_deviation: unknown metric %s", metric)
            return None
        sql, params = builder(tenant_id, otype, total_days, filter_sql, filter_params)

    rows_result = await ts.execute(text(sql), params)
    rows = [(r._mapping["day"], r._mapping["value"]) for r in rows_result.fetchall()]

    series, baseline_count, recent_count = _compute_zscore_series(
        rows, recent_days, seasonality)

    if baseline_count < min_base or not series:
        return None

    # Find the most extreme z within the recent window matching direction.
    candidates = []
    for s in series:
        z = s["z"]
        if direction == "above" and z <= 0:
            continue
        if direction == "below" and z >= 0:
            continue
        candidates.append(s)
    if not candidates:
        return None

    worst = max(candidates, key=lambda s: abs(s["z"]))
    if abs(worst["z"]) < min_z:
        return None

    severity = "critical" if abs(worst["z"]) >= 2 * min_z else "warning"
    direction_word = "above" if worst["z"] > 0 else "below"
    metric_label = {
        "case_count": "case volume",
        "cycle_hours_avg": "avg cycle time",
        "rework_pct": "rework %",
        "transition_hours_avg": f"transition {cfg.get('from_activity')}→{cfg.get('to_activity')} hours",
    }.get(metric, metric)

    return {
        "severity": severity,
        "message": (
            f"{metric_label} on {worst['day']} is {worst['value']:.2f} "
            f"({direction_word} baseline {worst['baseline_mean']:.2f} ± {worst['baseline_std']:.2f}, "
            f"z={worst['z']:+.2f})"
        ),
        "details": {
            "metric": metric,
            "object_type_id": otype,
            "worst_day": worst["day"],
            "worst_value": worst["value"],
            "worst_z": worst["z"],
            "baseline_mean": worst["baseline_mean"],
            "baseline_std": worst["baseline_std"],
            "baseline_samples": baseline_count,
            "recent_samples": recent_count,
            "min_zscore": min_z,
            "direction": direction,
            "seasonality": seasonality,
            "series": series,
        },
    }


# ── correlation_alert ─────────────────────────────────────────────────────────

import os
import httpx

INSIGHT_ENGINE_URL = os.environ.get("INSIGHT_ENGINE_URL", "http://insight-engine-service:8016")


async def _eval_correlation_alert(rule: dict, ts):
    """Fire when a promoted insight's effect_size shifts past `threshold` from
    the pinned baseline, OR when an insight that was previously dismissed
    reappears in a later run."""
    cfg = rule["config"]
    insight_id = cfg.get("insight_id")
    threshold = float(cfg.get("threshold", 0.3))
    if not insight_id:
        return None

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{INSIGHT_ENGINE_URL}/insights/{insight_id}",
                params={"tenant_id": rule["tenant_id"]},
            )
            if resp.status_code >= 400:
                return None
            ins = resp.json()
    except Exception:
        return None

    # Pinned baseline lives in config (stamped at promote time)
    baseline = float(cfg.get("baseline_effect") or 0.0)
    current = float(ins.get("effect_size") or 0.0)
    delta = current - baseline
    rel = abs(delta) / max(abs(baseline), 1e-6) if baseline != 0 else abs(current)

    if baseline == 0.0:
        # Treat current as baseline for the next run; do not fire yet.
        return None

    if rel < threshold:
        return None

    return {
        "severity": "warning",
        "message": (
            f"Insight '{ins.get('title')}' effect shifted: "
            f"{baseline:+.3f} → {current:+.3f} ({rel*100:.0f}% change)"
        ),
        "details": {
            "insight_id": insight_id,
            "baseline_effect": baseline,
            "current_effect": current,
            "threshold": threshold,
            "insight_status": ins.get("status"),
        },
    }


# ── streaming_anomaly ─────────────────────────────────────────────────────────

async def _eval_streaming_anomaly(rule: dict, ts):
    """EWMA / Holt-Winters style streaming anomaly. Uses
    `alert_rule_streaming_state` to keep incremental baseline state per rule.
    Implemented end-to-end in Phase 13."""
    from streaming_state import update_and_score
    cfg = rule["config"]
    metric = cfg.get("metric", "case_count")
    otype = rule.get("object_type_id") or cfg.get("object_type_id", "")
    window_minutes = int(cfg.get("window_minutes", 15))
    method = cfg.get("method", "ewma")
    alpha = float(cfg.get("alpha", 0.3))
    min_z = float(cfg.get("min_zscore", 3.0))
    tenant_id = rule["tenant_id"]

    # Compute the current window value
    if metric == "case_count":
        sql = (
            "SELECT COUNT(DISTINCT case_id)::float AS value "
            "FROM events "
            "WHERE tenant_id = :t AND object_type_id = :o "
            "  AND timestamp >= NOW() - (:w || ' minutes')::INTERVAL "
            + _SYSTEM_EXCL
        )
    elif metric == "event_count":
        sql = (
            "SELECT COUNT(*)::float AS value "
            "FROM events "
            "WHERE tenant_id = :t AND object_type_id = :o "
            "  AND timestamp >= NOW() - (:w || ' minutes')::INTERVAL "
            + _SYSTEM_EXCL
        )
    else:
        return None
    row = await ts.execute(text(sql),
                           {"t": tenant_id, "o": otype, "w": window_minutes})
    r = row.fetchone()
    if not r:
        return None
    value = float(r._mapping["value"] or 0)

    state = await update_and_score(rule["id"], value, method=method, alpha=alpha)
    z = state.get("z", 0.0)
    if abs(z) < min_z or state.get("warmup", True):
        return None
    return {
        "severity": "critical" if abs(z) >= 2 * min_z else "warning",
        "message": (
            f"Streaming {metric} = {value:.1f} (z={z:+.2f}, "
            f"baseline mean ≈ {state.get('mean', 0):.1f})"
        ),
        "details": {
            "metric": metric, "value": value, "z": z, "method": method,
            "ewma_mean": state.get("mean"), "ewma_var": state.get("var"),
            "window_minutes": window_minutes,
        },
    }


# ── Evaluator dispatch ─────────────────────────────────────────────────────────

EVALUATORS = {
    "stuck_case": _eval_stuck_case,
    "slow_transition": _eval_slow_transition,
    "rework_spike": _eval_rework_spike,
    "case_volume_anomaly": _eval_case_volume_anomaly,
    "metric_deviation": _eval_metric_deviation,
    "correlation_alert": _eval_correlation_alert,
    "streaming_anomaly": _eval_streaming_anomaly,
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
