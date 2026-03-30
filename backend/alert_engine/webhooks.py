"""
Webhook delivery with HMAC-SHA256 signing.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy import text
from database import PgSession

log = logging.getLogger(__name__)


def _sign(secret: str, payload: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


async def deliver_to_webhooks(tenant_id: str, notification: dict):
    """Fetch all enabled webhooks for the tenant and POST the notification."""
    async with PgSession() as pg:
        rows = await pg.execute(
            text(
                "SELECT url, secret FROM alert_webhooks "
                "WHERE tenant_id = :tid AND enabled = TRUE"
            ),
            {"tid": tenant_id},
        )
        webhooks = [dict(r._mapping) for r in rows.fetchall()]

    if not webhooks:
        return

    payload = json.dumps({
        "event": "alert.fired",
        "fired_at": datetime.now(timezone.utc).isoformat(),
        "notification": notification,
    }).encode()

    async with httpx.AsyncClient(timeout=10) as client:
        for wh in webhooks:
            sig = _sign(wh["secret"], payload)
            try:
                resp = await client.post(
                    wh["url"],
                    content=payload,
                    headers={
                        "Content-Type": "application/json",
                        "X-Nexus-Signature": sig,
                    },
                )
                log.info("Webhook %s → %s", wh["url"], resp.status_code)
            except Exception as exc:
                log.error("Webhook delivery failed for %s: %s", wh["url"], exc)
