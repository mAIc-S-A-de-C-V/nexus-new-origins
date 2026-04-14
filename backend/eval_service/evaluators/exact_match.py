"""
Exact match evaluator.
Compares the string representation of the output to the expected value.
Config: { case_sensitive: bool (default true), field: str (optional — drill into output dict) }
"""
from .base import EvalResult


async def evaluate(output: object, expected: dict, config: dict) -> EvalResult:
    field = config.get("field")
    case_sensitive = config.get("case_sensitive", True)

    # Resolve expected value: explicit config keys → field lookup → empty
    if "expected_value" in config:
        expected_value = config["expected_value"]
    elif field and field in expected:
        expected_value = expected[field]
    else:
        expected_value = expected.get("exact") or expected.get("value", "")

    actual = output
    if field and isinstance(output, dict):
        actual = output.get(field, "")

    actual_str = str(actual).strip() if actual is not None else ""
    expected_str = str(expected_value).strip()

    if not case_sensitive:
        actual_str = actual_str.lower()
        expected_str = expected_str.lower()

    passed = actual_str == expected_str
    return EvalResult(
        score=1.0 if passed else 0.0,
        passed=passed,
        details={"actual": actual_str, "expected": expected_str},
    )
