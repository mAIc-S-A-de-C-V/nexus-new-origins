"""
Expression language for widget-level computed fields, join references, and
filter predicates.

Wire format is a small JSON AST so the LLM can emit it without parsing a
custom grammar and the frontend can render it back as readable text.

Every emitted SQL fragment goes through `_safe_field` for identifier
whitelisting; numeric/string literals are bind-parameterized; function
names come from a whitelist. There is no point in the pipeline where a
user-supplied string lands directly in SQL.

Grammar (Pydantic-validated):

    Expr =
        FieldRef    { "type": "field", "name": "monthly_salary" }
                    name may be "alias.field" when joins are in play.
      | Literal     { "type": "lit",   "value": 30 | "open" | true | null }
      | BinaryOp    { "type": "op",    "op": "add|sub|mul|div|...",
                      "left": Expr, "right": Expr }
      | UnaryOp     { "type": "unary", "op": "neg|not", "arg": Expr }
      | FuncCall    { "type": "func",  "func": "<whitelisted name>",
                      "args": [Expr] }

Supported operators:
  Arithmetic:  add, sub, mul, div, mod
  Comparison:  eq, neq, lt, lte, gt, gte
  Logical:     and, or
  Unary:       neg (numeric), not (boolean)

Supported functions:
  String:      concat(...), lower(x), upper(x), coalesce(...)
  Date:        date_diff(unit, a, b), date_trunc(unit, ts), now()
  Cast:        to_number(x), to_date(x), to_text(x)
  Conditional: if(cond, then, else)
"""
from __future__ import annotations

import re
from typing import Annotated, Any, Literal, Optional, Union

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator


# ── Identifier whitelist (shared with records.py) ─────────────────────────

_FIELD_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
# Joined references look like "alias.field". Same constraints on each part.
_ALIAS_REF_RE = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]{0,31}\.[A-Za-z_][A-Za-z0-9_]{0,62}$"
)


def _safe_field_ref(name: str) -> str:
    """Validate a field reference. Accepts bare 'field' or 'alias.field'."""
    if not name:
        raise HTTPException(status_code=400, detail="Empty field reference")
    if _FIELD_NAME_RE.match(name):
        return name
    if _ALIAS_REF_RE.match(name):
        return name
    raise HTTPException(status_code=400, detail=f"Invalid field reference: {name!r}")


# ── AST nodes ──────────────────────────────────────────────────────────────

# Binary ops fall into three semantic groups. The grouping drives the SQL
# emitter's type assumptions.
_ARITHMETIC_OPS = {"add", "sub", "mul", "div", "mod"}
_COMPARISON_OPS = {"eq", "neq", "lt", "lte", "gt", "gte"}
_LOGICAL_OPS = {"and", "or"}
_BINARY_OPS = _ARITHMETIC_OPS | _COMPARISON_OPS | _LOGICAL_OPS

_SQL_BINOP = {
    "add": "+", "sub": "-", "mul": "*", "div": "/", "mod": "%",
    "eq": "=", "neq": "!=", "lt": "<", "lte": "<=", "gt": ">", "gte": ">=",
    "and": "AND", "or": "OR",
}

_UNARY_OPS = {"neg", "not"}

_FUNCTIONS = {
    "concat", "lower", "upper", "coalesce",
    "date_diff", "date_trunc", "now",
    "to_number", "to_date", "to_text",
    "if",
    # Numeric helpers — added in the v2 expression set.
    "round", "abs", "floor", "ceil", "pow", "length",
}

# Date units allowed in date_diff / date_trunc. Matches Postgres' built-in
# unit set so we don't have to translate.
_DATE_UNITS = {
    "microseconds", "milliseconds", "second", "minute", "hour",
    "day", "week", "month", "quarter", "year",
}


class FieldRef(BaseModel):
    type: Literal["field"] = "field"
    name: str

    @model_validator(mode="after")
    def _validate(self) -> "FieldRef":
        _safe_field_ref(self.name)
        return self


class LiteralExpr(BaseModel):
    type: Literal["lit"] = "lit"
    value: Union[int, float, str, bool, None] = None


class BinaryOp(BaseModel):
    type: Literal["op"] = "op"
    op: str
    left: "Expr"
    right: "Expr"

    @model_validator(mode="after")
    def _validate(self) -> "BinaryOp":
        if self.op not in _BINARY_OPS:
            raise HTTPException(status_code=400, detail=f"Unknown binary op: {self.op!r}")
        return self


class UnaryOp(BaseModel):
    type: Literal["unary"] = "unary"
    op: str
    arg: "Expr"

    @model_validator(mode="after")
    def _validate(self) -> "UnaryOp":
        if self.op not in _UNARY_OPS:
            raise HTTPException(status_code=400, detail=f"Unknown unary op: {self.op!r}")
        return self


class FuncCall(BaseModel):
    type: Literal["func"] = "func"
    func: str
    args: list["Expr"] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate(self) -> "FuncCall":
        if self.func not in _FUNCTIONS:
            raise HTTPException(status_code=400, detail=f"Unknown function: {self.func!r}")
        # Arity checks for fixed-arity functions
        arity = _func_arity(self.func)
        if arity is not None and len(self.args) != arity:
            raise HTTPException(
                status_code=400,
                detail=f"Function {self.func!r} expects {arity} arg(s), got {len(self.args)}",
            )
        if self.func == "date_diff":
            # First arg must be a literal date unit string.
            first = self.args[0] if self.args else None
            if not isinstance(first, LiteralExpr) or not isinstance(first.value, str) or first.value not in _DATE_UNITS:
                raise HTTPException(
                    status_code=400,
                    detail=f"date_diff first arg must be a literal unit: {sorted(_DATE_UNITS)}",
                )
        if self.func == "date_trunc":
            first = self.args[0] if self.args else None
            if not isinstance(first, LiteralExpr) or not isinstance(first.value, str) or first.value not in _DATE_UNITS:
                raise HTTPException(
                    status_code=400,
                    detail=f"date_trunc first arg must be a literal unit: {sorted(_DATE_UNITS)}",
                )
        return self


def _func_arity(name: str) -> Optional[int]:
    """Fixed arities per function; None means variadic (1+)."""
    return {
        "concat": None,
        "lower": 1, "upper": 1,
        "coalesce": None,
        "date_diff": 3, "date_trunc": 2, "now": 0,
        "to_number": 1, "to_date": 1, "to_text": 1,
        "if": 3,
        # round(x) or round(x, digits) — handled specially below for variadic.
        "round": None,
        "abs": 1, "floor": 1, "ceil": 1,
        "pow": 2,
        "length": 1,
    }.get(name)


Expr = Annotated[
    Union[FieldRef, LiteralExpr, BinaryOp, UnaryOp, FuncCall],
    Field(discriminator="type"),
]

# Resolve forward refs in the recursive types above.
BinaryOp.model_rebuild()
UnaryOp.model_rebuild()
FuncCall.model_rebuild()


# ── SQL emitter ────────────────────────────────────────────────────────────


class SqlEmitContext:
    """Mutable context that accumulates bind params and resolves field refs.

    `field_resolver` takes a (possibly aliased) field name and returns the
    SQL accessor expression for it — e.g. "data->>'monthly_salary'" for a
    base-table field or "emp.data->>'monthly_salary'" for a joined field.
    The caller owns whatever join aliasing scheme is in play.
    """

    def __init__(
        self,
        bind_params: dict[str, Any],
        field_resolver,
        bind_prefix: str = "expr",
    ):
        self.bind_params = bind_params
        self.field_resolver = field_resolver
        self._counter = 0
        self._prefix = bind_prefix

    def next_bind(self, value: Any) -> str:
        name = f"{self._prefix}{self._counter}"
        self._counter += 1
        self.bind_params[name] = value
        return f":{name}"


def emit_sql(expr: Expr, ctx: SqlEmitContext) -> str:
    """Translate an expression AST to a SQL fragment.

    The emitted SQL is wrapped in parens so it composes safely as part of a
    larger expression.
    """
    if isinstance(expr, FieldRef):
        return ctx.field_resolver(expr.name)

    if isinstance(expr, LiteralExpr):
        if expr.value is None:
            return "NULL"
        # Literals always go through bind params — never inline-rendered.
        return ctx.next_bind(expr.value)

    if isinstance(expr, BinaryOp):
        left = emit_sql(expr.left, ctx)
        right = emit_sql(expr.right, ctx)
        sql_op = _SQL_BINOP[expr.op]
        if expr.op in _ARITHMETIC_OPS:
            # Cast both sides to numeric so JSONB text fields work transparently
            # in arithmetic. CASE-guarded so non-numeric rows produce NULL
            # instead of crashing the whole query.
            return f"({_as_numeric(left)} {sql_op} {_as_numeric(right)})"
        return f"({left} {sql_op} {right})"

    if isinstance(expr, UnaryOp):
        arg = emit_sql(expr.arg, ctx)
        if expr.op == "neg":
            return f"(-{_as_numeric(arg)})"
        if expr.op == "not":
            return f"(NOT {arg})"
        raise HTTPException(status_code=400, detail=f"Unexpected unary op: {expr.op!r}")

    if isinstance(expr, FuncCall):
        return _emit_func(expr, ctx)

    raise HTTPException(status_code=500, detail=f"Unhandled expression type: {type(expr).__name__}")


def _as_numeric(sql: str) -> str:
    """Wrap a SQL expression in a regex-guarded numeric cast.

    JSONB text fields can hold non-numeric values; a blanket ::numeric blows
    up the whole query on the first bad row. CASE-WHEN-regex forces per-row
    evaluation, NULL for junk.
    """
    return (
        f"(CASE WHEN ({sql}) ~ '^-?[[:digit:]]+([.][[:digit:]]+)?$' "
        f"THEN ({sql})::numeric ELSE NULL END)"
    )


def _emit_func(call: FuncCall, ctx: SqlEmitContext) -> str:
    f = call.func
    if f == "now":
        return "NOW()"
    args = [emit_sql(a, ctx) for a in call.args]
    if f == "concat":
        # COALESCE each side to '' so a NULL doesn't poison the whole concat.
        return "(" + " || ".join(f"COALESCE({a}, '')" for a in args) + ")"
    if f == "lower":
        return f"LOWER({args[0]})"
    if f == "upper":
        return f"UPPER({args[0]})"
    if f == "coalesce":
        return f"COALESCE({', '.join(args)})"
    if f == "date_diff":
        # args[0] is the unit literal — already validated and bound. We
        # need it inline as a SQL unit name, not a bind. Re-emit from the AST.
        unit = call.args[0].value  # type: ignore[union-attr]
        return (
            f"EXTRACT(EPOCH FROM ({args[2]} - {args[1]})) "
            f"/ {_unit_seconds(unit)}"  # type: ignore[arg-type]
        )
    if f == "date_trunc":
        unit = call.args[0].value  # type: ignore[union-attr]
        return f"date_trunc('{unit}', {args[1]}::timestamptz)"
    if f == "to_number":
        return _as_numeric(args[0])
    if f == "to_date":
        return f"({args[0]})::timestamptz"
    if f == "to_text":
        return f"({args[0]})::text"
    if f == "if":
        return f"(CASE WHEN {args[0]} THEN {args[1]} ELSE {args[2]} END)"
    if f == "round":
        # round(x) or round(x, digits). The first arg is the value, the
        # second (optional) is the precision.
        if len(args) == 1:
            return f"ROUND({_as_numeric(args[0])})"
        if len(args) == 2:
            return f"ROUND({_as_numeric(args[0])}, {_as_numeric(args[1])}::int)"
        raise HTTPException(status_code=400, detail="round() takes 1 or 2 args")
    if f == "abs":
        return f"ABS({_as_numeric(args[0])})"
    if f == "floor":
        return f"FLOOR({_as_numeric(args[0])})"
    if f == "ceil":
        return f"CEIL({_as_numeric(args[0])})"
    if f == "pow":
        return f"POWER({_as_numeric(args[0])}, {_as_numeric(args[1])})"
    if f == "length":
        # Works for strings (returns char count) and arrays (returns 0 here —
        # JSONB arrays would need jsonb_array_length, callers should use the
        # native ontology API for array-shaped fields). For plain text values
        # CHAR_LENGTH is what every analyst expects from LEN().
        return f"CHAR_LENGTH({args[0]}::text)"
    raise HTTPException(status_code=500, detail=f"Function not implemented: {f!r}")


def _unit_seconds(unit: str) -> int:
    """Approximate seconds per unit for date_diff. Months/years use 30/365 days."""
    return {
        "microseconds": 0,  # avoid div-by-zero; not really meaningful here
        "milliseconds": 0,
        "second": 1,
        "minute": 60,
        "hour": 3600,
        "day": 86400,
        "week": 7 * 86400,
        "month": 30 * 86400,
        "quarter": 90 * 86400,
        "year": 365 * 86400,
    }.get(unit, 1)


# ── Helper: collect referenced field names ─────────────────────────────────


def referenced_fields(expr: Expr) -> set[str]:
    """Walk the AST and return every field name it touches.

    Used by the join resolver to validate that all referenced aliases were
    declared in the request, and by PII inference to know which input
    fields' classifications flow into the computed output.
    """
    out: set[str] = set()
    _collect_fields(expr, out)
    return out


def _collect_fields(expr: Expr, out: set[str]) -> None:
    if isinstance(expr, FieldRef):
        out.add(expr.name)
    elif isinstance(expr, BinaryOp):
        _collect_fields(expr.left, out)
        _collect_fields(expr.right, out)
    elif isinstance(expr, UnaryOp):
        _collect_fields(expr.arg, out)
    elif isinstance(expr, FuncCall):
        for a in expr.args:
            _collect_fields(a, out)
