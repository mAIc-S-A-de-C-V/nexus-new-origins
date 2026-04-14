"""
ROUGE-L evaluator — longest common subsequence text similarity.
No external dependencies. Pure Python implementation.
Config: { field: str (optional), min_score: float (default 0.5) }
"""
from .base import EvalResult


def _lcs_length(a: list, b: list) -> int:
    """Compute LCS length using dynamic programming."""
    m, n = len(a), len(b)
    if m == 0 or n == 0:
        return 0
    # Use two rows to save memory
    prev = [0] * (n + 1)
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if a[i - 1] == b[j - 1]:
                curr[j] = prev[j - 1] + 1
            else:
                curr[j] = max(curr[j - 1], prev[j])
        prev, curr = curr, [0] * (n + 1)
    return prev[n]


def rouge_l(reference: str, hypothesis: str) -> float:
    """Compute ROUGE-L F1 score between reference and hypothesis."""
    ref_tokens = reference.lower().split()
    hyp_tokens = hypothesis.lower().split()

    if not ref_tokens or not hyp_tokens:
        return 0.0

    lcs = _lcs_length(ref_tokens, hyp_tokens)
    precision = lcs / len(hyp_tokens)
    recall = lcs / len(ref_tokens)

    if precision + recall == 0:
        return 0.0

    f1 = (2 * precision * recall) / (precision + recall)
    return round(f1, 4)


async def evaluate(output: object, expected: dict, config: dict) -> EvalResult:
    field = config.get("field")
    min_score = float(config.get("min_score", 0.5))
    reference = expected.get("text") or expected.get("reference") or ""

    actual = output
    if field and isinstance(output, dict):
        actual = output.get(field, "")

    actual_str = str(actual) if actual is not None else ""
    score = rouge_l(str(reference), actual_str)
    passed = score >= min_score

    return EvalResult(
        score=score,
        passed=passed,
        details={
            "rouge_l": score,
            "min_score": min_score,
            "reference_length": len(str(reference).split()),
            "hypothesis_length": len(actual_str.split()),
        },
    )
