"""
Per-model price table (USD per 1M tokens, input / output).

Single source of truth used by agent_service to compute cost per run and
admin_service to compute tenant-level usage. Sync these prices manually when
new models ship — no provider API exposes them.
"""

# Input price, output price (USD per 1M tokens)
MODEL_PRICES_PER_M: dict[str, tuple[float, float]] = {
    # Anthropic
    "claude-opus-4-7":            (5.00, 25.00),
    "claude-opus-4.7":            (5.00, 25.00),
    "claude-opus-4-7[1m]":        (5.00, 25.00),
    "claude-sonnet-4-6":          (3.00, 15.00),
    "claude-sonnet-4.6":          (3.00, 15.00),
    "claude-haiku-4-5":           (1.00,  5.00),
    "claude-haiku-4-5-20251001":  (1.00,  5.00),
    # AWS Bedrock
    "amazon-nova-premier":        (2.50, 12.50),
    "amazon-nova-pro":            (0.80,  3.20),
    "amazon-nova-lite":           (0.06,  0.24),
    "amazon-nova-micro":          (0.035, 0.14),
    # Open / OSS
    "deepseek-v3-2":              (0.62,  1.85),
    "mistral-large-3":            (2.00,  6.00),
    "mistral-small-3":            (0.20,  0.60),
    "llama-4-scout-fp8":          (0.20,  0.60),
    "llama-4-maverick":           (0.27,  0.85),
    "openai/gpt-oss-120b":        (0.27,  0.85),
}

# Conservative fallback (Sonnet) for models we don't recognize.
DEFAULT_PRICE: tuple[float, float] = (3.00, 15.00)


def price_for(model: str | None) -> tuple[float, float]:
    if not model:
        return DEFAULT_PRICE
    return MODEL_PRICES_PER_M.get(model, DEFAULT_PRICE)


def compute_cost_usd(model: str | None, input_tokens: int, output_tokens: int,
                     cache_creation_tokens: int = 0, cache_read_tokens: int = 0) -> float:
    """Compute USD cost for a run.

    Cache-creation is billed at 1.25x input price, cache-reads at 0.10x — these
    are Anthropic's published multipliers and a reasonable approximation for
    other providers that don't publish a cache price.
    """
    in_price, out_price = price_for(model)
    base_in = (input_tokens / 1_000_000) * in_price
    base_out = (output_tokens / 1_000_000) * out_price
    cache_in = (cache_creation_tokens / 1_000_000) * in_price * 1.25
    cache_hit = (cache_read_tokens / 1_000_000) * in_price * 0.10
    return base_in + base_out + cache_in + cache_hit
