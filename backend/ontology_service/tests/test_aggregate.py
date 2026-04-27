"""
Unit tests for the /aggregate endpoint's pure SQL builder.

We test the SQL string + bind params produced for a variety of request shapes,
plus the validation guardrails. We do NOT execute the SQL — that's covered by
integration tests against a real Postgres.
"""
import pytest
from fastapi import HTTPException

from routers.records import (
    AggregateRequest,
    AggregationSpec,
    TimeBucketSpec,
    build_aggregate_sql,
    _safe_field,
    _AGG_METHODS,
    _BUCKETS,
)


# ── _safe_field ───────────────────────────────────────────────────────────


def test_safe_field_accepts_typical_names():
    for name in ("status", "amount", "created_at", "_underscore", "Camel123"):
        assert _safe_field(name) == name


def test_safe_field_rejects_injection_attempts():
    bad = ["", "1starts_with_digit", "has space", "has-dash", "has;semi", "drop'table", "x' OR 1=1"]
    for name in bad:
        with pytest.raises(HTTPException) as exc:
            _safe_field(name)
        assert exc.value.status_code == 400


def test_safe_field_rejects_overlong_names():
    with pytest.raises(HTTPException):
        _safe_field("a" * 64)


# ── Validation rules ──────────────────────────────────────────────────────


def test_group_by_and_time_bucket_together_emit_multi_series_sql():
    """Multi-series time series: both dimensions allowed; response gains a `series` col."""
    body = AggregateRequest(
        group_by="metric_type",
        time_bucket=TimeBucketSpec(field="created_at", interval="day"),
        aggregations=[AggregationSpec(field="value", method="avg")],
    )
    sql, _ = build_aggregate_sql(body, "tenant-1", "ot-1")
    # time bucket goes into `grp`, group_by becomes `series`
    assert "AS grp" in sql
    assert "AS series" in sql
    assert "GROUP BY grp, series" in sql
    # Both dimensions get NULL guards in WHERE
    assert "data->>'metric_type' IS NOT NULL" in sql
    assert "date_trunc('day'" in sql
    # Default ordering puts time first then series
    assert "ORDER BY grp ASC, series ASC" in sql


def test_aggregations_required():
    body = AggregateRequest(aggregations=[])
    with pytest.raises(HTTPException) as exc:
        build_aggregate_sql(body, "t", "o")
    assert exc.value.status_code == 400


def test_invalid_aggregation_method():
    body = AggregateRequest(aggregations=[AggregationSpec(method="median")])
    with pytest.raises(HTTPException) as exc:
        build_aggregate_sql(body, "t", "o")
    assert exc.value.status_code == 400
    assert "median" in exc.value.detail


def test_sum_requires_field():
    body = AggregateRequest(aggregations=[AggregationSpec(method="sum")])
    with pytest.raises(HTTPException) as exc:
        build_aggregate_sql(body, "t", "o")
    assert exc.value.status_code == 400
    assert "requires a field" in exc.value.detail


def test_count_does_not_require_field():
    body = AggregateRequest(aggregations=[AggregationSpec(method="count")])
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "COUNT(*)" in sql


def test_invalid_time_bucket_interval():
    # Pydantic accepts any string for interval; the builder validates against _BUCKETS.
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="created_at", interval="century"),
        aggregations=[AggregationSpec(method="count")],
    )
    with pytest.raises(HTTPException) as exc:
        build_aggregate_sql(body, "t", "o")
    assert exc.value.status_code == 400


# ── SQL composition ──────────────────────────────────────────────────────


def test_count_only_no_group_returns_total():
    body = AggregateRequest(aggregations=[AggregationSpec(method="count")])
    sql, params = build_aggregate_sql(body, "tenant-001", "ot-1")
    assert "COUNT(*)" in sql
    assert "'_total' AS grp" in sql
    assert "GROUP BY" not in sql
    assert params == {"tid": "tenant-001", "otid": "ot-1"}


def test_group_by_uses_jsonb_accessor_and_filters_nulls():
    body = AggregateRequest(
        group_by="status",
        aggregations=[AggregationSpec(method="count")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "data->>'status' AS grp" in sql
    assert "GROUP BY grp" in sql
    assert "data->>'status' IS NOT NULL" in sql
    assert "ORDER BY agg_0 DESC NULLS LAST" in sql  # default ordering when grouped


def test_time_bucket_uses_date_trunc():
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="created_at", interval="day"),
        aggregations=[AggregationSpec(method="count")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "date_trunc('day'" in sql
    assert "(data->>'created_at')::timestamptz" in sql or "data->>'created_at'" in sql
    assert "GROUP BY grp" in sql


@pytest.mark.parametrize("interval,expected_sql_interval", [
    ("second",      "1 second"),
    ("5_seconds",   "5 seconds"),
    ("30_seconds",  "30 seconds"),
    ("minute",      "1 minute"),
    ("5_minutes",   "5 minutes"),
    ("15_minutes",  "15 minutes"),
    ("30_minutes",  "30 minutes"),
])
def test_sub_hour_buckets_use_date_bin(interval, expected_sql_interval):
    """Sub-hour intervals route through Postgres date_bin (PG 14+)."""
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="time", interval=interval),
        aggregations=[AggregationSpec(method="count")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "date_bin(" in sql
    assert f"INTERVAL '{expected_sql_interval}'" in sql
    assert "TIMESTAMPTZ '2000-01-01'" in sql
    assert "date_trunc" not in sql


def test_calendar_buckets_still_use_date_trunc():
    """hour/day/week/month/quarter/year keep using date_trunc (cleaner SQL plans)."""
    for interval in ("hour", "day", "week", "month", "quarter", "year"):
        body = AggregateRequest(
            time_bucket=TimeBucketSpec(field="time", interval=interval),
            aggregations=[AggregationSpec(method="count")],
        )
        sql, _ = build_aggregate_sql(body, "t", "o")
        assert f"date_trunc('{interval}'" in sql
        assert "date_bin(" not in sql


def test_sum_emits_safe_numeric_cast_with_regex_guard():
    """
    The aggregate SQL must NOT do a blanket ::numeric cast — JSONB columns
    frequently mix types (one row stores an RPM number, another stores
    "true" for a running flag) and a naked cast blows up the whole query
    on the first non-numeric value. The CASE/regex guard skips non-numeric
    rows silently.
    """
    body = AggregateRequest(
        group_by="department",
        aggregations=[AggregationSpec(field="amount", method="sum")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    # Regex-guarded numeric cast inside a CASE
    assert "CASE WHEN data->>'amount' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$'" in sql
    assert "(data->>'amount')::numeric ELSE NULL END" in sql
    assert "SUM(" in sql


def test_numeric_filter_includes_regex_guard():
    body = AggregateRequest(
        filters='{"amount": {"$gte": 100}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    # Both the regex match AND the numeric comparison must be present
    assert "data->>'amount' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$'" in sql
    assert "(data->>'amount')::numeric >= :flt0" in sql


def test_multiple_aggregations_emit_separate_aliases():
    body = AggregateRequest(
        group_by="dept",
        aggregations=[
            AggregationSpec(method="count"),
            AggregationSpec(field="amount", method="sum"),
            AggregationSpec(field="amount", method="avg"),
        ],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "COUNT(*) AS agg_0" in sql
    assert "SUM(CASE WHEN data->>'amount' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' THEN (data->>'amount')::numeric ELSE NULL END) AS agg_1" in sql
    assert "AVG(CASE WHEN data->>'amount' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' THEN (data->>'amount')::numeric ELSE NULL END) AS agg_2" in sql


def test_count_distinct_uses_count_distinct():
    body = AggregateRequest(
        group_by="dept",
        aggregations=[AggregationSpec(field="user_id", method="count_distinct")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "COUNT(DISTINCT data->>'user_id')" in sql


def test_filters_eq_simple_form():
    body = AggregateRequest(
        filters='{"status": "active"}',
        group_by="dept",
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    assert "data->>'status' = :flt0" in sql
    assert params["flt0"] == "active"


def test_filters_operator_form():
    body = AggregateRequest(
        filters='{"amount": {"$gte": 100}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    assert "(data->>'amount')::numeric >= :flt0" in sql
    assert params["flt0"] == 100.0
    # Filter value is also regex-guarded so non-numeric rows are skipped
    assert "data->>'amount' ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$'" in sql


def test_timezone_wraps_date_trunc_with_at_time_zone_round_trip():
    """When the request includes a timezone, day/week/month buckets must
    align to the user's calendar, not UTC. The SQL builder does this by
    converting to the zone, truncating, then converting back."""
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="created_at", interval="day"),
        aggregations=[AggregationSpec(method="count")],
        timezone="America/El_Salvador",
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    # Round-trip: AT TIME ZONE on input AND on output. The bucket expr
    # appears in both SELECT (for to_char) and GROUP BY, so each round-trip
    # contributes 2 occurrences — total 4.
    assert "AT TIME ZONE 'America/El_Salvador'" in sql
    assert sql.count("AT TIME ZONE 'America/El_Salvador'") == 4
    assert "date_trunc('day'" in sql


def test_timezone_does_not_change_sub_hour_date_bin_buckets():
    """date_bin is time-anchored — buckets every 5 minutes don't move
    based on the user's calendar. Leave them in UTC."""
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="created_at", interval="5_minutes"),
        aggregations=[AggregationSpec(method="count")],
        timezone="America/El_Salvador",
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "date_bin(" in sql
    assert "AT TIME ZONE" not in sql


def test_invalid_timezone_rejected():
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="created_at", interval="day"),
        aggregations=[AggregationSpec(method="count")],
        timezone="'; DROP TABLE users; --",
    )
    with pytest.raises(HTTPException) as exc:
        build_aggregate_sql(body, "t", "o")
    assert exc.value.status_code == 400
    assert "Invalid timezone" in exc.value.detail


def test_filters_iso_date_uses_timestamptz_cast():
    """xAxisRange presets emit `time { $gte: '2026-04-25T...' }`. The filter
    handler casts the column to timestamptz and binds the value as a real
    Python datetime (asyncpg rejects str when SQL infers timestamptz)."""
    from datetime import datetime
    body = AggregateRequest(
        filters='{"time": {"$gte": "2026-04-25T21:27:51.553Z"}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    # Column-side cast still present; regex-guarded so a malformed row
    # doesn't blow up the query.
    assert "NULLIF(data->>'time', '')::timestamptz >= :flt0" in sql
    assert "data->>'time' ~ '^[[:digit:]]{4}-[[:digit:]]{2}-[[:digit:]]{2}'" in sql
    # Bind value is a real datetime, not a string.
    assert isinstance(params["flt0"], datetime)
    # Must NOT take the numeric path
    assert "::numeric" not in sql.split("flt0")[0].rsplit("WHERE", 1)[-1]


def test_filters_iso_date_lt_and_lte_also_use_timestamptz():
    from datetime import datetime
    body = AggregateRequest(
        filters='{"created_at": {"$lt": "2026-01-15"}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    assert "NULLIF(data->>'created_at', '')::timestamptz < :flt0" in sql
    assert isinstance(params["flt0"], datetime)


def test_filters_non_date_string_gt_falls_back_to_string_compare():
    """A non-numeric, non-ISO-date string under $gt falls back to lexicographic
    string comparison — no crash, no false numeric coercion."""
    body = AggregateRequest(
        filters='{"name": {"$gt": "alice"}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    assert "data->>'name' > :flt0" in sql
    assert params["flt0"] == "alice"
    # Did not take the timestamptz or numeric path
    assert "::timestamptz" not in sql
    assert "::numeric" not in sql


def test_filters_in_operator_emits_placeholders():
    body = AggregateRequest(
        filters='{"status": {"$in": ["active", "pending", "review"]}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    assert "data->>'status' IN (:flt0_0, :flt0_1, :flt0_2)" in sql
    assert params["flt0_0"] == "active"
    assert params["flt0_1"] == "pending"
    assert params["flt0_2"] == "review"


def test_filters_not_in_operator_emits_negation_with_null_safety():
    body = AggregateRequest(
        filters='{"status": {"$not_in": ["cancelled", "refunded"]}}',
        aggregations=[AggregationSpec(method="count")],
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    # NOT IN must include OR ... IS NULL or it silently drops rows where
    # the field is absent (Postgres NULL semantics).
    assert "data->>'status' NOT IN (:flt0_0, :flt0_1)" in sql
    assert "data->>'status' IS NULL" in sql
    assert params["flt0_0"] == "cancelled"
    assert params["flt0_1"] == "refunded"


def test_sort_by_agg_index():
    body = AggregateRequest(
        group_by="dept",
        aggregations=[AggregationSpec(method="count"), AggregationSpec(field="amount", method="sum")],
        sort_by="agg_1",
        sort_dir="desc",
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "ORDER BY agg_1 DESC NULLS LAST" in sql


def test_sort_by_group():
    body = AggregateRequest(
        time_bucket=TimeBucketSpec(field="created_at", interval="month"),
        aggregations=[AggregationSpec(method="count")],
        sort_by="group",
        sort_dir="asc",
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "ORDER BY grp ASC" in sql


def test_sort_by_unknown_index_is_ignored():
    # agg_99 is out of range; the builder ignores the explicit sort and emits
    # no ORDER BY (the user asked for nonsensical ordering, they get the
    # natural row order). Importantly: agg_99 must NOT leak into the SQL.
    body = AggregateRequest(
        group_by="dept",
        aggregations=[AggregationSpec(method="count")],
        sort_by="agg_99",
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "agg_99" not in sql
    # No ORDER BY clause was emitted (default ordering only kicks in when
    # sort_by is unset entirely)
    assert "ORDER BY" not in sql


def test_limit_is_clamped_to_max_5000():
    body = AggregateRequest(
        group_by="dept",
        aggregations=[AggregationSpec(method="count")],
        limit=100000,
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "LIMIT 5000" in sql


def test_limit_zero_falls_back_to_default_200():
    # 0 is falsy in Python; the builder treats it as "use default 200".
    body = AggregateRequest(
        group_by="dept",
        aggregations=[AggregationSpec(method="count")],
        limit=0,
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "LIMIT 200" in sql


def test_limit_negative_is_clamped_to_min_1():
    body = AggregateRequest(
        group_by="dept",
        aggregations=[AggregationSpec(method="count")],
        limit=-5,
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "LIMIT 1" in sql


def test_multi_series_uses_series_column_for_groupby():
    body = AggregateRequest(
        group_by="sensor",
        time_bucket=TimeBucketSpec(field="time", interval="hour"),
        aggregations=[AggregationSpec(field="value", method="avg")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "data->>'sensor' AS series" in sql
    # In multi-series mode, the original group_by accessor is NOT also the `grp`
    assert "data->>'sensor' AS grp" not in sql


def test_multi_series_filter_pushdown_still_works():
    body = AggregateRequest(
        group_by="metric_type",
        time_bucket=TimeBucketSpec(field="created_at", interval="month"),
        aggregations=[AggregationSpec(method="count")],
        filters='{"metric_type": {"$in": ["rpm", "running", "temp"]}}',
    )
    sql, params = build_aggregate_sql(body, "t", "o")
    assert "data->>'metric_type' IN (:flt0_0, :flt0_1, :flt0_2)" in sql
    assert params["flt0_0"] == "rpm"
    assert params["flt0_1"] == "running"
    assert params["flt0_2"] == "temp"


def test_sort_by_series_works():
    body = AggregateRequest(
        group_by="region",
        time_bucket=TimeBucketSpec(field="created_at", interval="day"),
        aggregations=[AggregationSpec(method="count")],
        sort_by="series",
        sort_dir="asc",
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "ORDER BY series ASC" in sql


def test_field_whitelist_blocks_injection_in_group_by():
    body = AggregateRequest(
        group_by="status; DROP TABLE",
        aggregations=[AggregationSpec(method="count")],
    )
    with pytest.raises(HTTPException):
        build_aggregate_sql(body, "t", "o")


def test_field_whitelist_blocks_injection_in_aggregation_field():
    body = AggregateRequest(
        aggregations=[AggregationSpec(field="amount; DROP", method="sum")],
    )
    with pytest.raises(HTTPException):
        build_aggregate_sql(body, "t", "o")


def test_tenant_isolation_in_where_clause():
    body = AggregateRequest(aggregations=[AggregationSpec(method="count")])
    sql, params = build_aggregate_sql(body, "tenant-casw", "ot-loans")
    assert "tenant_id = :tid" in sql
    assert "object_type_id = :otid" in sql
    assert params["tid"] == "tenant-casw"
    assert params["otid"] == "ot-loans"


# ── Constants are sane ────────────────────────────────────────────────────


def test_agg_methods_constant():
    assert {"count", "sum", "avg", "min", "max", "count_distinct"} == _AGG_METHODS


def test_buckets_constant():
    expected = {
        # Sub-hour (date_bin)
        "second", "5_seconds", "15_seconds", "30_seconds",
        "minute", "5_minutes", "15_minutes", "30_minutes",
        # Calendar (date_trunc)
        "hour", "day", "week", "month", "quarter", "year",
    }
    assert expected == _BUCKETS
