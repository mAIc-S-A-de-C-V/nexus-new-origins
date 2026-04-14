"""
JSON Schema match evaluator.
Checks whether output conforms to an expected JSON schema.
Config: { schema: dict } — JSON Schema object
Score: 1.0 if all required keys present and types match, partial otherwise.
"""
import json
from .base import EvalResult


def _check_type(value: object, type_name: str) -> bool:
    type_map = {
        "string": str,
        "number": (int, float),
        "integer": int,
        "boolean": bool,
        "array": list,
        "object": dict,
        "null": type(None),
    }
    expected_type = type_map.get(type_name)
    if expected_type is None:
        return True
    return isinstance(value, expected_type)


def _validate(data: object, schema: dict) -> tuple[int, int, list[str]]:
    """Returns (passed_checks, total_checks, errors)."""
    passed = 0
    total = 0
    errors = []

    if not isinstance(schema, dict):
        return 0, 0, []

    schema_type = schema.get("type")
    if schema_type:
        total += 1
        if _check_type(data, schema_type):
            passed += 1
        else:
            errors.append(f"Expected type {schema_type}, got {type(data).__name__}")

    properties = schema.get("properties", {})
    required = schema.get("required", [])

    if properties and isinstance(data, dict):
        for key, sub_schema in properties.items():
            total += 1
            if key in data:
                passed += 1
                sub_p, sub_t, sub_e = _validate(data[key], sub_schema)
                passed += sub_p
                total += sub_t
                errors.extend([f"{key}.{e}" for e in sub_e])
            elif key in required:
                errors.append(f"Missing required key: {key}")
            else:
                passed += 1  # optional key absent — still ok

    return passed, total, errors


async def evaluate(output: object, expected: dict, config: dict) -> EvalResult:
    schema = config.get("schema") or expected.get("schema")
    if not schema:
        return EvalResult(score=1.0, passed=True, details={"message": "No schema provided"})

    if isinstance(output, str):
        try:
            output = json.loads(output)
        except (json.JSONDecodeError, ValueError):
            pass

    passed_checks, total_checks, errors = _validate(output, schema)
    score = (passed_checks / total_checks) if total_checks > 0 else 1.0
    passed = len(errors) == 0

    return EvalResult(
        score=round(score, 4),
        passed=passed,
        details={"errors": errors, "passed_checks": passed_checks, "total_checks": total_checks},
    )
