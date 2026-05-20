"""
LLM-driven title + recommendation rewriting. Gated by
`insight_engine_config.llm_titles_enabled`. Sends top-N insights as a single
batched prompt to Claude and overwrites `title`, `description`, and
`recommendation` on each.

The prompt uses double-braced JSON examples to survive Python f-string
interpolation — without them, the example {…} blocks would be parsed as
format spec placeholders.
"""
import json
import logging
import os
from typing import Any

log = logging.getLogger(__name__)

try:
    import anthropic  # type: ignore
except Exception:  # pragma: no cover
    anthropic = None


MODEL_DEFAULT = os.environ.get("INSIGHT_LLM_MODEL", "claude-haiku-4-5-20251001")
BATCH_SIZE = 25
MAX_TOKENS = 4000


def _summarize_finding(f: dict) -> dict:
    """Minimal payload sent to the LLM — strip noise so the prompt stays small."""
    return {
        "id": f.get("id") or f.get("_idx"),
        "family": f.get("family"),
        "object_type_id": f.get("object_type_id"),
        "feature": f.get("feature"),
        "outcome": f.get("outcome"),
        "n": f.get("n"),
        "effect_size": f.get("effect_size"),
        "effect_metric": f.get("effect_metric"),
        "direction": f.get("direction"),
        "p_adjusted": f.get("p_adjusted"),
        "stability_score": f.get("stability_score"),
        "evidence_summary": {
            k: v for k, v in (f.get("evidence") or {}).items()
            if k in ("group_stats", "with_pattern_avg", "without_pattern_avg",
                      "support_count", "lift", "confidence", "cluster_mean",
                      "rest_mean", "top_tokens", "signature")
        },
    }


def _build_prompt(findings: list[dict]) -> str:
    """Build the prompt. JSON example below uses doubled braces to escape
    inside the f-string. Output schema is a JSON array, one object per input
    finding, keyed by `id`."""
    payload = [_summarize_finding({**f, "_idx": i}) for i, f in enumerate(findings)]
    payload_json = json.dumps(payload, default=str, ensure_ascii=False, indent=2)
    return f"""You are a data analyst summarizing automated statistical findings for an operations dashboard.

For each finding below, rewrite three fields:
  - title         : one sentence, concrete, no hedging. Mention the object type, the feature, and the outcome.
  - description   : 1–2 sentences. State the effect plainly, include the numbers, and call out caveats (small sample, low stability).
  - recommendation: 1–2 sentences. What should the operator do? Investigate, change a process, ignore? If unsure, say so.

Findings (JSON array):
{payload_json}

Respond ONLY with a JSON array, one object per finding, in the same order, with this exact shape:

[
  {{
    "id": "<the id field from the input>",
    "title": "...",
    "description": "...",
    "recommendation": "..."
  }}
]

Do not include any text before or after the JSON array.
"""


async def rewrite_findings(findings: list[dict], cfg: dict) -> None:
    """Mutates findings in place, replacing title/description/recommendation
    for the top BATCH_SIZE × N items. Best-effort: failures leave originals."""
    if not findings:
        return
    if not cfg.get("llm_titles_enabled"):
        return
    if anthropic is None:
        log.info("anthropic SDK not installed; skipping LLM rewriter")
        return
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        log.info("ANTHROPIC_API_KEY not set; skipping LLM rewriter")
        return

    client = anthropic.Anthropic(api_key=api_key)

    # Stable index for round-tripping
    for i, f in enumerate(findings):
        f.setdefault("_idx", i)

    for start in range(0, len(findings), BATCH_SIZE):
        batch = findings[start:start + BATCH_SIZE]
        prompt = _build_prompt(batch)
        try:
            resp = client.messages.create(
                model=MODEL_DEFAULT,
                max_tokens=MAX_TOKENS,
                messages=[{"role": "user", "content": prompt}],
            )
            text = "".join(b.text for b in resp.content if hasattr(b, "text"))
        except Exception as exc:
            log.warning("Claude call failed: %s", exc)
            continue
        try:
            # Strip code fences if present
            t = text.strip()
            if t.startswith("```"):
                t = t.split("\n", 1)[1].rsplit("```", 1)[0]
            out = json.loads(t)
        except Exception as exc:
            log.warning("Failed to parse LLM JSON: %s; raw=%s", exc, text[:200])
            continue
        by_id = {item.get("id"): item for item in out if isinstance(item, dict)}
        for f in batch:
            item = by_id.get(f.get("id")) or by_id.get(f.get("_idx"))
            if not item:
                continue
            if item.get("title"):
                f["title"] = item["title"][:240]
            if item.get("description"):
                f["description"] = item["description"][:600]
            if item.get("recommendation"):
                f["recommendation"] = item["recommendation"][:600]
