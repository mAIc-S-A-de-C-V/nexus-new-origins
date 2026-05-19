"""Tests for the expression AST + SQL emitter."""
import pytest
from fastapi import HTTPException

from expressions import (
    BinaryOp,
    Expr,
    FieldRef,
    FuncCall,
    LiteralExpr,
    SqlEmitContext,
    UnaryOp,
    emit_sql,
    referenced_fields,
)


def _resolver(name: str) -> str:
    """Mimic the records.py resolver: 'foo' -> data->>'foo'."""
    if "." in name:
        alias, field = name.split(".", 1)
        return f"{alias}.data->>'{field}'"
    return f"data->>'{name}'"


def _ctx(prefix: str = "expr") -> tuple[SqlEmitContext, dict]:
    binds: dict = {}
    return SqlEmitContext(binds, _resolver, bind_prefix=prefix), binds


# ── Field references ──────────────────────────────────────────────────────


def test_field_ref_emits_jsonb_accessor():
    ctx, binds = _ctx()
    sql = emit_sql(FieldRef(name="monthly_salary"), ctx)
    assert sql == "data->>'monthly_salary'"
    assert binds == {}


def test_aliased_field_ref():
    ctx, _ = _ctx()
    sql = emit_sql(FieldRef(name="emp.full_name"), ctx)
    assert sql == "emp.data->>'full_name'"


def test_field_ref_rejects_injection():
    with pytest.raises(HTTPException):
        FieldRef(name="x'; DROP TABLE")
    with pytest.raises(HTTPException):
        FieldRef(name="has space")
    with pytest.raises(HTTPException):
        FieldRef(name="too.many.dots")
    with pytest.raises(HTTPException):
        FieldRef(name="")


# ── Literals ──────────────────────────────────────────────────────────────


def test_literal_int_uses_bind_param():
    ctx, binds = _ctx()
    sql = emit_sql(LiteralExpr(value=30), ctx)
    assert sql == ":expr0"
    assert binds == {"expr0": 30}


def test_literal_string_uses_bind_param():
    ctx, binds = _ctx()
    sql = emit_sql(LiteralExpr(value="open"), ctx)
    assert sql.startswith(":")
    assert "open" in binds.values()


def test_literal_null_inlines():
    ctx, binds = _ctx()
    sql = emit_sql(LiteralExpr(value=None), ctx)
    assert sql == "NULL"
    assert binds == {}


# ── Arithmetic ────────────────────────────────────────────────────────────


def test_arithmetic_wraps_both_sides_in_numeric_cast():
    expr = BinaryOp(
        op="div",
        left=FieldRef(name="monthly_salary"),
        right=LiteralExpr(value=30),
    )
    ctx, binds = _ctx()
    sql = emit_sql(expr, ctx)
    # Both sides get CASE-guarded numeric casts; the operator is '/'.
    assert "::numeric" in sql
    assert "/" in sql
    assert "data->>'monthly_salary'" in sql
    assert binds == {"expr0": 30}


def test_nested_arithmetic_for_daily_cost():
    """(monthly_salary / 30) * (allocation_pct / 100) — the canonical example."""
    expr = BinaryOp(
        op="mul",
        left=BinaryOp(
            op="div",
            left=FieldRef(name="monthly_salary"),
            right=LiteralExpr(value=30),
        ),
        right=BinaryOp(
            op="div",
            left=FieldRef(name="allocation_pct"),
            right=LiteralExpr(value=100),
        ),
    )
    ctx, binds = _ctx()
    sql = emit_sql(expr, ctx)
    assert sql.count("*") >= 1
    assert sql.count("/") >= 2
    assert binds == {"expr0": 30, "expr1": 100}


def test_arithmetic_rejects_unknown_op():
    with pytest.raises(HTTPException):
        BinaryOp(op="exponent", left=LiteralExpr(value=1), right=LiteralExpr(value=2))


# ── Comparison & logical ──────────────────────────────────────────────────


def test_comparison_does_not_cast_numeric():
    """Comparisons happen on the raw accessor — the caller decides typing."""
    expr = BinaryOp(
        op="gte",
        left=FieldRef(name="status"),
        right=LiteralExpr(value="active"),
    )
    ctx, _ = _ctx()
    sql = emit_sql(expr, ctx)
    assert "::numeric" not in sql
    assert ">=" in sql


def test_logical_and():
    expr = BinaryOp(
        op="and",
        left=BinaryOp(op="eq", left=FieldRef(name="status"), right=LiteralExpr(value="active")),
        right=BinaryOp(op="gt", left=FieldRef(name="amount"), right=LiteralExpr(value=0)),
    )
    ctx, _ = _ctx()
    sql = emit_sql(expr, ctx)
    assert " AND " in sql


# ── Unary ─────────────────────────────────────────────────────────────────


def test_unary_neg_casts_to_numeric():
    ctx, _ = _ctx()
    sql = emit_sql(UnaryOp(op="neg", arg=FieldRef(name="x")), ctx)
    assert "-" in sql
    assert "::numeric" in sql


def test_unary_not_wraps_bool():
    ctx, _ = _ctx()
    sql = emit_sql(
        UnaryOp(op="not", arg=BinaryOp(op="eq", left=FieldRef(name="x"), right=LiteralExpr(value=1))),
        ctx,
    )
    assert sql.startswith("(NOT ")


def test_unary_rejects_unknown_op():
    with pytest.raises(HTTPException):
        UnaryOp(op="abs", arg=LiteralExpr(value=1))


# ── Functions ─────────────────────────────────────────────────────────────


def test_concat_coalesces_each_arg():
    expr = FuncCall(
        func="concat",
        args=[
            FieldRef(name="first_name"),
            LiteralExpr(value=" "),
            FieldRef(name="last_name"),
        ],
    )
    ctx, _ = _ctx()
    sql = emit_sql(expr, ctx)
    assert sql.count("COALESCE") == 3
    assert " || " in sql


def test_lower_upper():
    ctx, _ = _ctx()
    assert "LOWER(" in emit_sql(FuncCall(func="lower", args=[FieldRef(name="email")]), ctx)
    ctx, _ = _ctx()
    assert "UPPER(" in emit_sql(FuncCall(func="upper", args=[FieldRef(name="email")]), ctx)


def test_coalesce_variadic():
    expr = FuncCall(
        func="coalesce",
        args=[FieldRef(name="a"), FieldRef(name="b"), LiteralExpr(value="default")],
    )
    ctx, binds = _ctx()
    sql = emit_sql(expr, ctx)
    assert sql.startswith("COALESCE(")
    assert "default" in binds.values()


def test_date_diff_requires_literal_unit():
    # First arg must be a literal unit string from the whitelist.
    with pytest.raises(HTTPException):
        FuncCall(
            func="date_diff",
            args=[
                FieldRef(name="unit_field"),  # not a literal — should reject
                FieldRef(name="start_date"),
                FieldRef(name="end_date"),
            ],
        )
    with pytest.raises(HTTPException):
        FuncCall(
            func="date_diff",
            args=[
                LiteralExpr(value="fortnight"),  # not in whitelist
                FieldRef(name="a"),
                FieldRef(name="b"),
            ],
        )


def test_date_diff_emits_extract_epoch():
    expr = FuncCall(
        func="date_diff",
        args=[LiteralExpr(value="day"), FieldRef(name="start_date"), FieldRef(name="end_date")],
    )
    ctx, _ = _ctx()
    sql = emit_sql(expr, ctx)
    assert "EXTRACT(EPOCH" in sql
    assert "/ 86400" in sql


def test_date_trunc_inlines_unit():
    expr = FuncCall(
        func="date_trunc",
        args=[LiteralExpr(value="month"), FieldRef(name="created_at")],
    )
    ctx, _ = _ctx()
    sql = emit_sql(expr, ctx)
    assert "date_trunc('month'" in sql
    assert "::timestamptz" in sql


def test_now_takes_no_args():
    ctx, _ = _ctx()
    assert emit_sql(FuncCall(func="now"), ctx) == "NOW()"
    with pytest.raises(HTTPException):
        FuncCall(func="now", args=[LiteralExpr(value=1)])


def test_if_is_case_when():
    expr = FuncCall(
        func="if",
        args=[
            BinaryOp(op="gt", left=FieldRef(name="x"), right=LiteralExpr(value=0)),
            LiteralExpr(value="positive"),
            LiteralExpr(value="non-positive"),
        ],
    )
    ctx, _ = _ctx()
    sql = emit_sql(expr, ctx)
    assert "CASE WHEN" in sql
    assert "ELSE" in sql


def test_unknown_function_rejected():
    with pytest.raises(HTTPException):
        FuncCall(func="rm_rf", args=[])


def test_function_arity_enforced():
    with pytest.raises(HTTPException):
        FuncCall(func="lower", args=[])  # expects 1
    with pytest.raises(HTTPException):
        FuncCall(func="if", args=[LiteralExpr(value=True)])  # expects 3


# ── referenced_fields ─────────────────────────────────────────────────────


def test_referenced_fields_collects_all_refs():
    # ((salary / 30) * (allocation_pct / 100)) referencing both
    expr = BinaryOp(
        op="mul",
        left=BinaryOp(op="div", left=FieldRef(name="emp.monthly_salary"), right=LiteralExpr(value=30)),
        right=BinaryOp(op="div", left=FieldRef(name="allocation_pct"), right=LiteralExpr(value=100)),
    )
    assert referenced_fields(expr) == {"emp.monthly_salary", "allocation_pct"}


def test_referenced_fields_inside_function_call():
    expr = FuncCall(
        func="concat",
        args=[FieldRef(name="first_name"), FieldRef(name="last_name")],
    )
    assert referenced_fields(expr) == {"first_name", "last_name"}


# ── Round-trip via Pydantic model construction (wire format) ──────────────


def test_wire_format_dict_round_trip():
    """A JSON-like dict goes through Pydantic validation cleanly."""
    from pydantic import TypeAdapter

    wire = {
        "type": "op",
        "op": "mul",
        "left": {
            "type": "op",
            "op": "div",
            "left": {"type": "field", "name": "monthly_salary"},
            "right": {"type": "lit", "value": 30},
        },
        "right": {
            "type": "op",
            "op": "div",
            "left": {"type": "field", "name": "allocation_pct"},
            "right": {"type": "lit", "value": 100},
        },
    }
    parsed = TypeAdapter(Expr).validate_python(wire)
    ctx, _ = _ctx()
    sql = emit_sql(parsed, ctx)
    assert "monthly_salary" in sql
    assert "allocation_pct" in sql


# ── v2 numeric helpers ─────────────────────────────────────────────────────


def test_round_one_arg_emits_ROUND():
    ctx, _ = _ctx()
    sql = emit_sql(FuncCall(func="round", args=[FieldRef(name="amount")]), ctx)
    assert "ROUND(" in sql
    assert "::numeric" in sql


def test_round_two_args_emits_digits():
    ctx, _ = _ctx()
    sql = emit_sql(FuncCall(func="round", args=[FieldRef(name="amount"), LiteralExpr(value=2)]), ctx)
    assert "ROUND(" in sql
    assert "::int" in sql


def test_abs_floor_ceil():
    for fn, sqlfn in [("abs", "ABS"), ("floor", "FLOOR"), ("ceil", "CEIL")]:
        ctx, _ = _ctx()
        sql = emit_sql(FuncCall(func=fn, args=[FieldRef(name="x")]), ctx)
        assert sqlfn in sql


def test_pow_emits_POWER():
    ctx, _ = _ctx()
    sql = emit_sql(FuncCall(func="pow", args=[FieldRef(name="base"), LiteralExpr(value=2)]), ctx)
    assert "POWER(" in sql


def test_length_emits_CHAR_LENGTH():
    ctx, _ = _ctx()
    sql = emit_sql(FuncCall(func="length", args=[FieldRef(name="name")]), ctx)
    assert "CHAR_LENGTH(" in sql


def test_arity_enforced_for_numeric_helpers():
    with pytest.raises(HTTPException):
        FuncCall(func="abs", args=[])
    with pytest.raises(HTTPException):
        FuncCall(func="pow", args=[LiteralExpr(value=1)])  # expects 2
    with pytest.raises(HTTPException):
        FuncCall(func="length", args=[])
