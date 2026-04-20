"""
Fire-and-forget LLM token usage tracker.

Usage:
    from shared.token_tracker import track_token_usage
    response = client.messages.create(...)
    track_token_usage(
        tenant_id="tenant-001",
        service="agent_service",
        model=response.model,
        input_tokens=response.usage.input_tokens,
        output_tokens=response.usage.output_tokens,
    )

Never blocks the caller. Failures are silently logged.
"""
import asyncio
import logging
import os
import threading

ADMIN_SERVICE_URL = os.environ.get("ADMIN_SERVICE_URL", "http://admin-service:8022")
_log = logging.getLogger("token_tracker")


async def _post_usage(tenant_id: str, service: str, model: str,
                      input_tokens: int, output_tokens: int, user_id: str | None):
    import httpx
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(
                f"{ADMIN_SERVICE_URL}/admin/token-usage",
                json={
                    "tenant_id": tenant_id,
                    "service": service,
                    "model": model,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "user_id": user_id,
                },
                headers={"x-internal": "nexus-internal"},
            )
    except Exception:
        _log.debug("Token usage POST failed (non-blocking)", exc_info=True)


def track_token_usage(
    tenant_id: str,
    service: str,
    model: str = "unknown",
    input_tokens: int = 0,
    output_tokens: int = 0,
    user_id: str | None = None,
) -> None:
    """Fire-and-forget token usage report. Works from both sync and async contexts."""
    if input_tokens == 0 and output_tokens == 0:
        return
    try:
        loop = asyncio.get_running_loop()
        # We're inside an async context — schedule as a task
        loop.create_task(_post_usage(tenant_id, service, model, input_tokens, output_tokens, user_id))
    except RuntimeError:
        # No running event loop — fire a background thread
        def _bg():
            asyncio.run(_post_usage(tenant_id, service, model, input_tokens, output_tokens, user_id))
        threading.Thread(target=_bg, daemon=True).start()
