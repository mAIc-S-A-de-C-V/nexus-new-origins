"""
Health checker — tests freshness of lineage nodes by checking last activity timestamps.
"""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

CONNECTOR_API = os.environ.get("CONNECTOR_SERVICE_URL", "http://connector-service:8001")
PIPELINE_API  = os.environ.get("PIPELINE_SERVICE_URL",  "http://pipeline-service:8002")
AGENT_API     = os.environ.get("AGENT_SERVICE_URL",     "http://agent-service:8013")

STALE_HOURS = {
    "connector": 25,   # should sync at least daily
    "pipeline":  25,
    "agent":     72,   # agents run less frequently
}


def _parse_dt(val: Optional[str]) -> Optional[datetime]:
    if not val:
        return None
    try:
        dt = datetime.fromisoformat(val.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _freshness(last_activity: Optional[str], stale_hours: int) -> dict:
    if not last_activity:
        return {"status": "unknown", "last_activity": None, "stale": False}
    dt = _parse_dt(last_activity)
    if not dt:
        return {"status": "unknown", "last_activity": last_activity, "stale": False}
    age = datetime.now(timezone.utc) - dt
    stale = age > timedelta(hours=stale_hours)
    return {
        "status": "stale" if stale else "fresh",
        "last_activity": last_activity,
        "age_hours": round(age.total_seconds() / 3600, 1),
        "stale": stale,
    }


async def check_health(nodes: list[dict]) -> list[dict]:
    """Annotate nodes with freshness status."""
    result = []
    for node in nodes:
        node_type = node["type"]
        meta = node.get("meta", {})
        health: dict = {"status": "ok", "stale": False}

        if node_type == "connector":
            health = _freshness(meta.get("last_sync"), STALE_HOURS["connector"])
        elif node_type == "pipeline":
            last = meta.get("last_run_at")
            health = _freshness(last, STALE_HOURS["pipeline"])
        elif node_type == "agent":
            # Agent health = enabled status
            enabled = meta.get("enabled", True)
            health = {
                "status": "ok" if enabled else "disabled",
                "stale": False,
                "enabled": enabled,
            }
        elif node_type == "object_type":
            count = meta.get("record_count", 0)
            health = {
                "status": "ok" if count > 0 else "empty",
                "stale": False,
                "record_count": count,
            }

        result.append({**node, "health": health})
    return result
