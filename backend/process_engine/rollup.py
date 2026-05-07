"""
Hourly rollup of `events` rows into a destination ontology OT.

Why
---
Process-mining-style pivots over multi-million row event tables stay slow even
with indexes — `COUNT(DISTINCT case_id)` over 4M+ rows blows out work_mem and
spills to disk. The fix is OLAP-style pre-aggregation: roll up raw events into
a small per-hour summary table once an hour, then point dashboards at the
summary instead of the raw events.

Shape
-----
Source: rows in TimescaleDB `events` table with `object_type_id = source_ot`
        plus the standard process-engine columns (case_id, activity, timestamp,
        attributes, resource).

Per hour, per (dim_1, dim_2, ...) tuple we compute:
  - event_count    = COUNT(*)
  - case_count     = COUNT(DISTINCT case_id)

…and POST those aggregated rows to the ontology service's `/records/ingest`
endpoint with a composite `_rollup_key` so a re-run for the same hour replaces
the previous values cleanly (idempotent).

The frontend can then build dashboard widgets on the destination OT and slice
by dimensions / time range with normal indexed range scans on a tiny table
(typically <10k rows for a week of data).
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Reuse the SQL helpers we already use in the pivot endpoint so the rollup
# semantics match what the slow path computes.
from routers.process import (  # type: ignore[import-not-found]
    _SYSTEM_EXCL,
    _build_user_excl,
    _build_attribute_filters,
    _resolved_activity_expr,
    _resolved_case_id_expr,
    _resolved_timestamp_expr,
    _pivot_dim_sql,
)

logger = logging.getLogger(__name__)

ONTOLOGY_URL = os.environ.get("ONTOLOGY_SERVICE_URL", "http://ontology-service:8004")
ROLLUP_INGEST_TIMEOUT_S = float(os.environ.get("ROLLUP_INGEST_TIMEOUT_S", "60"))
# Pre-aggregating still touches every event row in the window once. Cap so a
# bad config (e.g. backfilling a year on a high-frequency sensor) can't hang.
ROLLUP_QUERY_TIMEOUT_S = float(os.environ.get("ROLLUP_QUERY_TIMEOUT_S", "300"))


def _floor_hour(dt: datetime) -> datetime:
    """Snap to the start of dt's hour, in UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)


_VALID_METRIC_METHODS = {"count", "count_distinct", "sum", "avg", "min", "max"}


def parse_metrics_string(s: str | list | None) -> list[dict]:
    """Parse a friendly metrics string into a list of {method, field?, name?}.

    Accepts:
      - a list (already-parsed) — returned as-is after validation
      - a comma-separated string: "count, avg:value, max:reading as peak"

    Each token is either:
      - "count" / "count_distinct"  → no field needed
      - "<method>:<field>"          → method ∈ sum/avg/min/max, field on snapshot
      - "<method>:<field> as <name>"→ optional alias for the output column

    Returns a list of dicts:
      {"method": str, "field": str | None, "name": str}
    """
    if not s:
        return []
    if isinstance(s, list):
        out: list[dict] = []
        for spec in s:
            if not isinstance(spec, dict):
                continue
            method = str(spec.get("method", "")).strip().lower()
            if method not in _VALID_METRIC_METHODS:
                continue
            field = spec.get("field") or None
            name = spec.get("name") or _default_metric_name(method, field)
            out.append({"method": method, "field": field, "name": name})
        return out

    parsed: list[dict] = []
    for tok in str(s).split(","):
        tok = tok.strip()
        if not tok:
            continue
        # Optional 'as <alias>' suffix
        alias: Optional[str] = None
        if " as " in tok.lower():
            i = tok.lower().rindex(" as ")
            alias = tok[i + 4:].strip() or None
            tok = tok[:i].strip()
        if ":" in tok:
            method, field = (p.strip() for p in tok.split(":", 1))
        else:
            method, field = tok, ""
        method = method.lower()
        if method not in _VALID_METRIC_METHODS:
            # Skip unknown methods rather than failing the whole rollup —
            # makes the field forgiving when users mistype.
            continue
        parsed.append({
            "method": method,
            "field": field or None,
            "name": alias or _default_metric_name(method, field or None),
        })
    return parsed


def _default_metric_name(method: str, field: Optional[str]) -> str:
    if method in ("count",):
        return "event_count"
    if method == "count_distinct":
        return "case_count"
    if not field:
        return method
    # Sanitise field for use as a column name
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in field)
    return f"{method}_{safe}"


def _safe_snapshot_field(field: str) -> str:
    """Allow A-Za-z0-9_- and dot only. Returns '' if invalid."""
    import re as _re
    if _re.match(r"^[A-Za-z0-9_.\-]+$", field or ""):
        return field
    return ""


async def compute_hourly_rollup(
    *,
    db: AsyncSession,
    source_object_type_id: str,
    target_object_type_id: str,
    tenant_id: str,
    from_hour: datetime,
    to_hour: datetime,
    dimensions: list[str],
    activity_attribute: str = "",
    case_id_attribute: str = "",
    timestamp_attribute: str = "",
    excluded_activities: Optional[list[str]] = None,
    attribute_filters: Optional[dict[str, str]] = None,
    metrics: Optional[list[dict] | str] = None,
) -> dict:
    """Roll up events for every hour in [from_hour, to_hour) and upsert the
    summaries into the target OT.

    Returns a summary dict with row counts + timing. Safe to re-run for the
    same hour range — composite `_rollup_key` ensures previous values are
    overwritten, not duplicated.
    """
    started_at = time.perf_counter()

    # Snap to hour boundaries so a "from = 14:23" doesn't silently produce a
    # partial bucket the dashboard would then mis-interpret.
    from_hour = _floor_hour(from_hour)
    to_hour = _floor_hour(to_hour)
    if to_hour <= from_hour:
        return {
            "rows_written": 0,
            "hours_processed": 0,
            "elapsed_ms": 0.0,
            "warning": "to_hour <= from_hour, nothing to do",
        }

    if not dimensions:
        # A rollup with no dimensions still has the time bucket as the only
        # implicit dim — useful for "hourly event count" timeseries.
        dimensions = []

    excluded_activities = excluded_activities or []
    attribute_filters = attribute_filters or {}

    # Build the SQL helpers exactly the way the live pivot does so the rollup
    # numbers match the (slow) pivot numbers down to the row.
    user_excl_sql, user_excl_params = _build_user_excl(excluded_activities)
    af_sql, af_params = _build_attribute_filters(attribute_filters)
    act_expr = _resolved_activity_expr(activity_attribute)
    cid_expr = _resolved_case_id_expr(case_id_attribute)
    ts_expr = _resolved_timestamp_expr(timestamp_attribute)

    # Map each dimension to a SQL expression. Reuses _pivot_dim_sql so the
    # built-in 'activity'/'resource'/'month'/'day_of_week' shorthands and
    # arbitrary record_snapshot attribute keys all behave identically here.
    dim_select_parts: list[str] = []
    dim_group_parts: list[str] = []
    dim_params: dict = {}
    for i, dim in enumerate(dimensions):
        expr, params = _pivot_dim_sql(dim, i)
        dim_select_parts.append(f"{expr} AS d_{i}")
        dim_group_parts.append(f"d_{i}")
        dim_params.update(params)

    bind_params: dict = {
        "source_ot": source_object_type_id,
        "tenant_id": tenant_id,
        "from_hour": from_hour,
        "to_hour": to_hour,
        **({"act_attr": activity_attribute} if activity_attribute else {}),
        **({"case_id_attr": case_id_attribute} if case_id_attribute else {}),
        **({"ts_attr": timestamp_attribute} if timestamp_attribute else {}),
        **user_excl_params,
        **af_params,
        **dim_params,
    }

    extra_select = (", " + ", ".join(dim_select_parts)) if dim_select_parts else ""
    extra_group = (", " + ", ".join(dim_group_parts)) if dim_group_parts else ""

    # Build metric SELECT columns. If the caller didn't specify metrics, default
    # to count + count_distinct for backward compat.
    parsed_metrics = parse_metrics_string(metrics) if metrics else []
    if not parsed_metrics:
        parsed_metrics = [
            {"method": "count", "field": None, "name": "event_count"},
            {"method": "count_distinct", "field": None, "name": "case_count"},
        ]

    metric_select_parts: list[str] = []
    for i, m in enumerate(parsed_metrics):
        method = m["method"]
        field = m.get("field")
        alias = f"m_{i}"
        if method == "count":
            metric_select_parts.append(f"COUNT(*) AS {alias}")
        elif method == "count_distinct":
            metric_select_parts.append(
                f"COUNT(DISTINCT resolved_case_id) AS {alias}"
            )
        elif method in ("sum", "avg", "min", "max"):
            safe_field = _safe_snapshot_field(field or "")
            if not safe_field:
                # Caller asked for sum/avg/etc but the field name is bad — emit
                # NULL rather than dropping the metric so the column still
                # appears in the destination OT and the user can spot the bug.
                metric_select_parts.append(f"NULL::numeric AS {alias}")
                continue
            # Regex-guarded numeric cast — any row whose value isn't a clean
            # number becomes NULL, which SUM/AVG/MIN/MAX naturally ignore.
            value_expr = (
                f"CASE WHEN snapshot->>'{safe_field}' ~ "
                f"'^-?[[:digit:]]+([.][[:digit:]]+)?$' "
                f"THEN (snapshot->>'{safe_field}')::numeric ELSE NULL END"
            )
            sql_fn = method.upper()
            metric_select_parts.append(f"{sql_fn}({value_expr}) AS {alias}")

    metric_select_sql = ",\n            ".join(metric_select_parts)

    sql = text(f"""
        WITH _events AS (
            SELECT
                {cid_expr} AS resolved_case_id,
                {act_expr} AS activity,
                {ts_expr} AS resolved_ts,
                resource,
                attributes->'record_snapshot' AS snapshot
            FROM events
            WHERE object_type_id = :source_ot
              AND tenant_id = :tenant_id
              AND ({cid_expr}) != ''
              {_SYSTEM_EXCL}
              {user_excl_sql}
              AND ({ts_expr}) >= :from_hour
              AND ({ts_expr}) <  :to_hour
              {af_sql}
        )
        SELECT
            date_trunc('hour', resolved_ts) AS hour_bucket
            {extra_select},
            {metric_select_sql}
        FROM _events
        GROUP BY hour_bucket {extra_group}
        ORDER BY hour_bucket
    """)

    # Bump work_mem so multi-million-row aggregations don't spill — same trick
    # the pivot uses. `SET LOCAL` only persists for this transaction.
    try:
        await db.execute(text("SET LOCAL work_mem = '256MB'"))
    except Exception:
        # Read-only sessions may reject SET LOCAL; not fatal — query just runs
        # with the default work_mem.
        pass

    try:
        result = await asyncio.wait_for(
            db.execute(sql, bind_params),
            timeout=ROLLUP_QUERY_TIMEOUT_S,
        )
        rows = result.fetchall()
    except asyncio.TimeoutError:
        logger.warning(
            "rollup query timed out (%.0fs) source_ot=%s tenant=%s window=%s..%s",
            ROLLUP_QUERY_TIMEOUT_S, source_object_type_id, tenant_id, from_hour, to_hour,
        )
        raise

    # Build idempotent records for ingest. The composite `_rollup_key` lets
    # the ingest endpoint upsert by source_id, so a second run for the same
    # hour overwrites instead of duplicating.
    records: list[dict] = []
    for r in rows:
        hour_iso = r.hour_bucket.astimezone(timezone.utc).isoformat()
        # Pull dimension values out of d_0, d_1, ...
        dim_values: list[str] = []
        for i in range(len(dimensions)):
            v = getattr(r, f"d_{i}", None)
            dim_values.append(str(v) if v is not None else "")
        rollup_key_parts = [hour_iso] + dim_values
        rec: dict = {
            "_rollup_key": "|".join(rollup_key_parts),
            "hour_bucket": hour_iso,
        }
        # Add a column for each metric, named per the metric spec.
        for i, m in enumerate(parsed_metrics):
            v = getattr(r, f"m_{i}", None)
            col_name = m["name"]
            if m["method"] in ("count", "count_distinct"):
                rec[col_name] = int(v or 0)
            else:
                # sum/avg/min/max on numeric snapshot values — preserve None
                # (rather than coercing to 0) so charts can distinguish
                # "no readings this hour" from "readings averaged to 0".
                rec[col_name] = float(v) if v is not None else None
        for dim, value in zip(dimensions, dim_values):
            rec[dim] = value
        records.append(rec)

    # POST to ontology /records/ingest. Upsert by `_rollup_key`.
    rows_written = 0
    if records:
        try:
            async with httpx.AsyncClient(timeout=ROLLUP_INGEST_TIMEOUT_S) as client:
                resp = await client.post(
                    f"{ONTOLOGY_URL}/object-types/{target_object_type_id}/records/ingest",
                    json={
                        "records": records,
                        "pk_field": "_rollup_key",
                        "pipeline_id": "rollup-hourly",
                    },
                    headers={"x-tenant-id": tenant_id},
                )
                if resp.is_success:
                    body = resp.json()
                    rows_written = int(body.get("ingested", len(records)))
                else:
                    logger.warning(
                        "rollup ingest failed (%s): %s",
                        resp.status_code, resp.text[:300],
                    )
                    raise RuntimeError(
                        f"Ontology ingest returned {resp.status_code}: {resp.text[:200]}"
                    )
        except httpx.HTTPError as exc:
            logger.exception("rollup ingest connection failed")
            raise RuntimeError(f"Could not reach ontology service: {exc}") from exc

    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    hours_processed = int((to_hour - from_hour).total_seconds() // 3600)
    return {
        "rows_written": rows_written,
        "hours_processed": hours_processed,
        "from_hour": from_hour.isoformat(),
        "to_hour": to_hour.isoformat(),
        "dimensions": dimensions,
        "elapsed_ms": round(elapsed_ms, 1),
    }


async def rollup_recent(
    *,
    db: AsyncSession,
    source_object_type_id: str,
    target_object_type_id: str,
    tenant_id: str,
    hours_back: int,
    dimensions: list[str],
    **kwargs,
) -> dict:
    """Convenience: roll up the last N hours through the most recently
    completed hour. Useful for cron — `hours_back=2` re-runs the last 2 hours
    every 10 minutes catches late-arriving events without re-running history."""
    now = datetime.now(timezone.utc)
    to_hour = _floor_hour(now)
    from_hour = to_hour - timedelta(hours=max(1, int(hours_back)))
    return await compute_hourly_rollup(
        db=db,
        source_object_type_id=source_object_type_id,
        target_object_type_id=target_object_type_id,
        tenant_id=tenant_id,
        from_hour=from_hour,
        to_hour=to_hour,
        dimensions=dimensions,
        **kwargs,
    )
