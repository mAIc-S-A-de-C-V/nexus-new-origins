"""
HTTP client into alert_engine for promoting an insight to a correlation_alert
rule and for pushing the nightly summary notification.
"""
import os
import logging
import httpx

ALERT_ENGINE_URL = os.environ.get("ALERT_ENGINE_URL", "http://alert-engine-service:8010")
log = logging.getLogger(__name__)


async def create_correlation_alert_rule(tenant_id: str, insight_id: str,
                                         insight_title: str,
                                         threshold: float = 0.3,
                                         cooldown_minutes: int = 1440) -> dict | None:
    """Create a correlation_alert rule in alert_engine. Returns the new rule
    or None on failure. Idempotent at the API level — alert_engine's unique
    (tenant_id, name) index guarantees re-promotion is safe."""
    payload = {
        "name": f"Insight · {insight_title[:80]}",
        "rule_type": "correlation_alert",
        "config": {"insight_id": insight_id, "threshold": threshold},
        "cooldown_minutes": cooldown_minutes,
        "enabled": True,
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{ALERT_ENGINE_URL}/alerts/rules",
                params={"tenant_id": tenant_id},
                json=payload,
            )
            if resp.status_code >= 400:
                log.warning("promote-to-alert failed: %s %s", resp.status_code, resp.text)
                return None
            return resp.json()
    except Exception as exc:
        log.warning("promote-to-alert HTTP error: %s", exc)
        return None


async def push_summary_notification(tenant_id: str, title: str,
                                     message: str, details: dict) -> None:
    """Used by Phase 16. Calls the alert_engine's internal notifications API
    to publish a system-level message that lands in the NotificationDrawer."""
    payload = {"title": title, "message": message, "details": details}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{ALERT_ENGINE_URL}/alerts/notifications/system",
                params={"tenant_id": tenant_id},
                json=payload,
            )
    except Exception as exc:
        log.info("nightly summary push skipped: %s", exc)
