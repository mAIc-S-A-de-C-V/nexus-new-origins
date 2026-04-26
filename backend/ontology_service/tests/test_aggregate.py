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


def test_group_by_and_time_bucket_are_mutually_exclusive():
    body = AggregateRequest(
        group_by="status",
        time_bucket=TimeBucketSpec(field="created_at", interval="day"),
        aggregations=[AggregationSpec(method="count")],
    )
    with pytest.raises(HTTPException) as exc:
        build_aggregate_sql(body, "tenant-1", "ot-1")
    assert exc.value.status_code == 400
    assert "group_by or time_bucket" in exc.value.detail


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


def test_sum_emits_numeric_cast_with_nullif():
    body = AggregateRequest(
        group_by="department",
        aggregations=[AggregationSpec(field="amount", method="sum")],
    )
    sql, _ = build_aggregate_sql(body, "t", "o")
    assert "SUM(NULLIF(data->>'amount', '')::numeric)" in sql


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
    assert "SUM(NULLIF(data->>'amount', '')::numeric) AS agg_1" in sql
    assert "AVG(NULLIF(data->>'amount', '')::numeric) AS agg_2" in sql


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
    assert {"hour", "day", "week", "month", "quarter", "year"} == _BUCKETS
