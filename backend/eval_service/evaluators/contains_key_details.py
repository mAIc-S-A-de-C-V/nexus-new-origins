"""
Contains-key-details evaluator — Claude-backed.
Asks Claude: does this output contain all the required key facts?
Config: { key_details: list[str] }  OR  expected.key_details: list[str]
Returns: score 0–1, list of missing details.
"""
import os
import json
import anthropic
from .base import EvalResult

_client = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))


async def evaluate(output: object, expected: dict, config: dict) -> EvalResult:
    key_details = config.get("key_details") or expected.get("key_details", [])

    if not key_details:
        return EvalResult(score=1.0, passed=True, details={"message": "No key details specified"})

    output_str = json.dumps(output, ensure_ascii=False, default=str) if isinstance(output, dict) else str(output)

    prompt = f"""Does the following output contain ALL of the required key details?

Output:
{output_str}

Required key details:
{chr(10).join(f"- {d}" for d in key_details)}

Respond with ONLY valid JSON, no markdown:
{{"contains_all": true or false, "missing": ["list of missing detail strings"], "score": 0.0 to 1.0, "notes": "brief explanation"}}

Score 1.0 = all details present, 0.0 = none present, partial credit for partial presence."""

    try:
        response = await _client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        result = json.loads(raw)
    except Exception as e:
        return EvalResult(
            score=0.0,
            passed=False,
            details={"error": str(e), "key_details": key_details},
        )

    score = float(result.get("score", 0.0))
    contains_all = bool(result.get("contains_all", False))
    missing = result.get("missing", [])

    return EvalResult(
        score=round(min(max(score, 0.0), 1.0), 4),
        passed=contains_all,
        details={
            "contains_all": contains_all,
            "missing": missing,
            "notes": result.get("notes", ""),
            "key_details_checked": key_details,
        },
    )
