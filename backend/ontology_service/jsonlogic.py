"""
JSONLogic-style expression evaluator.

A small subset of jsonlogic.com's grammar — enough to express the rules our
workflow engine needs without pulling in a third-party dep that we'd then
need to security-audit.

Rules are nested dicts where the single key is an operator and the value is
either a single argument or a list of arguments. Args are recursively
evaluated. Atoms (numbers, strings, bools, null) pass through unchanged.

Example: total = unit_price × quantity, then check >= 10000
    {">=": [
        {"*": [{"var": "unit_price"}, {"var": "quantity"}]},
        10000
    ]}

Supported ops:
  Logic:        and, or, not, !, !!, if, ==, ===, !=, !==, >, >=, <, <=
  Arithmetic:   +, -, *, /, %, min, max
  Membership:   in            (also accepts "in_" since "in" is a Python kw in some contexts)
  String:       cat (concat), substr, contains, starts_with, ends_with
  Coercion:     to_number, to_string, to_bool
  Lookup:       var (dot-path; default value as 2nd arg, e.g. {"var": ["a.b", 0]})
  Length:       length / count  (works on str, list, dict, None→0)
  Missing:      missing (returns list of missing keys), missing_some
"""

from __future__ import annotations

from typing import Any, Sequence


class JSONLogicError(ValueError):
    pass


def _is_rule(node: Any) -> bool:
    """A rule is a dict with exactly one key whose value is the args."""
    return isinstance(node, dict) and len(node) == 1


def _truthy(v: Any) -> bool:
    if v is None or v is False or v == 0 or v == "":
        return False
    if isinstance(v, (list, tuple, dict)) and len(v) == 0:
        return False
    return True


def _to_number(v: Any) -> float:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _resolve_var(path: Any, data: dict, default: Any = None) -> Any:
    """`var` op: dot-pathed lookup into data with optional default.

    {"var": "a.b.c"}  → data["a"]["b"]["c"]   (or default if any step missing)
    {"var": ["a.b", 0]}                          ↑ default = 0
    {"var": ""}      → data itself
    """
    if path == "" or path is None or path == []:
        return data
    if isinstance(path, list):
        actual_path = path[0] if path else ""
        actual_default = path[1] if len(path) > 1 else default
    else:
        actual_path = path
        actual_default = default
    if actual_path == "" or actual_path is None:
        return data
    cursor: Any = data
    for part in str(actual_path).split("."):
        if isinstance(cursor, dict):
            cursor = cursor.get(part)
        elif isinstance(cursor, list):
            try:
                cursor = cursor[int(part)]
            except (ValueError, IndexError):
                return actual_default
        else:
            return actual_default
        if cursor is None:
            return actual_default
    return cursor


def _arg_list(value: Any) -> list:
    """Normalize an op's value into a list. Single arg ops accept a bare value."""
    if isinstance(value, list):
        return value
    return [value]


def evaluate(rule: Any, data: dict | None = None) -> Any:
    """Evaluate a JSONLogic rule against `data`.

    Atoms (non-rule values) return as-is; nested rules are evaluated
    recursively. Unknown ops raise JSONLogicError so callers fail loudly
    rather than silently returning a wrong result.
    """
    if data is None:
        data = {}

    # Lists are arrays of expressions; evaluate each element.
    if isinstance(rule, list):
        return [evaluate(item, data) for item in rule]

    if not _is_rule(rule):
        return rule

    op, raw_args = next(iter(rule.items()))
    args = _arg_list(raw_args)

    # Lazy ops — evaluate only what's needed. Most others want all args evaluated up front.
    if op == "if":
        # if : [cond1, then1, cond2, then2, ..., else]
        i = 0
        while i + 1 < len(args):
            cond = evaluate(args[i], data)
            if _truthy(cond):
                return evaluate(args[i + 1], data)
            i += 2
        return evaluate(args[i], data) if i < len(args) else None

    if op == "and":
        result: Any = True
        for a in args:
            result = evaluate(a, data)
            if not _truthy(result):
                return result
        return result

    if op == "or":
        result = False
        for a in args:
            result = evaluate(a, data)
            if _truthy(result):
                return result
        return result

    # Eager: evaluate all args first.
    ev = [evaluate(a, data) for a in args]

    if op == "var":
        # var arg patterns: "a.b" | ["a.b", default] | ""
        path = ev[0] if ev else ""
        default = ev[1] if len(ev) > 1 else None
        return _resolve_var(path, data, default)

    if op in ("==", "===", "eq"):
        return all(ev[0] == x for x in ev[1:]) if len(ev) >= 2 else False
    if op in ("!=", "!==", "ne", "neq"):
        return ev[0] != ev[1]
    if op == ">":
        return all(ev[i] > ev[i + 1] for i in range(len(ev) - 1))
    if op == ">=":
        return all(ev[i] >= ev[i + 1] for i in range(len(ev) - 1))
    if op == "<":
        return all(ev[i] < ev[i + 1] for i in range(len(ev) - 1))
    if op == "<=":
        return all(ev[i] <= ev[i + 1] for i in range(len(ev) - 1))

    if op in ("not", "!"):
        return not _truthy(ev[0]) if ev else True
    if op == "!!":
        return _truthy(ev[0]) if ev else False

    if op == "+":
        return sum(_to_number(x) for x in ev)
    if op == "-":
        if len(ev) == 1:
            return -_to_number(ev[0])
        result = _to_number(ev[0])
        for x in ev[1:]:
            result -= _to_number(x)
        return result
    if op == "*":
        result = 1.0
        for x in ev:
            result *= _to_number(x)
        return result
    if op == "/":
        if len(ev) < 2:
            raise JSONLogicError("/ needs at least 2 args")
        result = _to_number(ev[0])
        for x in ev[1:]:
            d = _to_number(x)
            if d == 0:
                return None  # mirror jsonlogic.com behavior — null on /0
            result /= d
        return result
    if op == "%":
        if len(ev) != 2:
            raise JSONLogicError("% needs exactly 2 args")
        d = _to_number(ev[1])
        return _to_number(ev[0]) % d if d != 0 else None
    if op == "min":
        nums = [_to_number(x) for x in ev]
        return min(nums) if nums else None
    if op == "max":
        nums = [_to_number(x) for x in ev]
        return max(nums) if nums else None

    if op in ("in", "in_"):
        # {"in": [needle, haystack]} — string substring or list membership
        if len(ev) != 2:
            raise JSONLogicError("in needs exactly 2 args")
        needle, haystack = ev
        if isinstance(haystack, str):
            return needle in haystack if needle is not None else False
        if isinstance(haystack, (list, tuple, set, dict)):
            return needle in haystack
        return False

    if op in ("contains",):
        # {"contains": [haystack, needle]} — opposite arg order from "in" so it
        # reads more naturally in workflow builder UIs.
        if len(ev) != 2:
            raise JSONLogicError("contains needs exactly 2 args")
        hay, needle = ev
        if hay is None:
            return False
        return str(needle).lower() in str(hay).lower()

    if op == "starts_with":
        if len(ev) != 2:
            raise JSONLogicError("starts_with needs exactly 2 args")
        return str(ev[0] or "").lower().startswith(str(ev[1] or "").lower())
    if op == "ends_with":
        if len(ev) != 2:
            raise JSONLogicError("ends_with needs exactly 2 args")
        return str(ev[0] or "").lower().endswith(str(ev[1] or "").lower())

    if op == "cat":
        return "".join(str(x) if x is not None else "" for x in ev)
    if op == "substr":
        s = str(ev[0] or "")
        start = int(_to_number(ev[1])) if len(ev) > 1 else 0
        if len(ev) > 2:
            length = int(_to_number(ev[2]))
            return s[start:start + length] if length >= 0 else s[start:length]
        return s[start:]

    if op == "to_number":
        return _to_number(ev[0]) if ev else 0.0
    if op == "to_string":
        return "" if not ev or ev[0] is None else str(ev[0])
    if op == "to_bool":
        return _truthy(ev[0]) if ev else False

    if op in ("length", "count"):
        v = ev[0] if ev else None
        if v is None:
            return 0
        if isinstance(v, (str, list, tuple, dict, set)):
            return len(v)
        return 0

    if op == "missing":
        # Return list of paths from `args` that resolve to None/missing in `data`.
        keys = ev[0] if (ev and isinstance(ev[0], list)) else ev
        missing = []
        for k in keys:
            v = _resolve_var(k, data)
            if v is None or v == "":
                missing.append(k)
        return missing

    if op == "missing_some":
        if len(ev) < 2:
            raise JSONLogicError("missing_some needs [min_required, [keys]]")
        min_required = int(_to_number(ev[0]))
        keys = ev[1] if isinstance(ev[1], list) else [ev[1]]
        present = sum(1 for k in keys if _resolve_var(k, data) not in (None, ""))
        if present >= min_required:
            return []
        return [k for k in keys if _resolve_var(k, data) in (None, "")]

    raise JSONLogicError(f"Unknown JSONLogic op: {op!r}")


def evaluate_bool(rule: Any, data: dict | None = None) -> bool:
    """Convenience wrapper — eval and coerce to truthy bool. Empty/null rule = True."""
    if rule is None or rule == {} or rule == []:
        return True
    return _truthy(evaluate(rule, data or {}))
