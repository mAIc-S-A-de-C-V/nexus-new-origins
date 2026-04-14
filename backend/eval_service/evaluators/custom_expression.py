"""
Custom expression evaluator.
Evaluates a user-defined Python expression in a sandboxed context.
Config: { expression: str }  — e.g. "len(output.get('records', [])) > 0"

Available variables in expression:
  output   — the raw output from the target
  expected — the expected_outputs dict from the test case

Returns 1.0 if expression is truthy, 0.0 otherwise.
"""
import re
from .base import EvalResult

# Block dangerous builtins
_BLOCKED = re.compile(
    r'\b(import|exec|eval|open|__import__|os|sys|subprocess|globals|locals|getattr|setattr|delattr|vars|dir)\b'
)

_SAFE_BUILTINS = {
    "len": len,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "set": set,
    "type": type,
    "isinstance": isinstance,
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
    "sum": sum,
    "any": any,
    "all": all,
    "sorted": sorted,
    "enumerate": enumerate,
    "zip": zip,
    "range": range,
    "print": print,
    "True": True,
    "False": False,
    "None": None,
}


async def evaluate(output: object, expected: dict, config: dict) -> EvalResult:
    expression = config.get("expression") or expected.get("expression", "")

    if not expression:
        return EvalResult(score=1.0, passed=True, details={"message": "No expression provided"})

    if _BLOCKED.search(expression):
        return EvalResult(
            score=0.0,
            passed=False,
            details={"error": "Expression contains blocked keywords"},
        )

    try:
        ctx = {"output": output, "expected": expected, "__builtins__": _SAFE_BUILTINS}
        result = eval(expression, ctx)  # noqa: S307
        passed = bool(result)
        return EvalResult(
            score=1.0 if passed else 0.0,
            passed=passed,
            details={"expression": expression, "result": str(result)},
        )
    except Exception as e:
        return EvalResult(
            score=0.0,
            passed=False,
            details={"expression": expression, "error": str(e)},
        )
