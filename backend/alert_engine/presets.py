"""
Standard alert presets — seeded per tenant on service startup. All presets are
created `enabled=false` so they don't fire blind on day 1; the operator enables
them per object type from the Alert Rules UI.

Idempotent: uses the (tenant_id, name) unique index added in database.py.
Re-running the seeder is safe and will not overwrite operator edits.
"""
import json
import logging
from sqlalchemy import text

from database import PgSession

log = logging.getLogger(__name__)


# Each preset is a fully-formed alert_rules row template. object_type_id is
# left blank — operators bind a preset to a specific object type when they
# enable it from the UI.
PRESETS = [
    {
        "name": "Preset · Cycle-time spike",
        "rule_type": "metric_deviation",
        "config": {
            "metric": "cycle_hours_avg",
            "baseline_window_days": 28,
            "recent_window_days": 7,
            "min_zscore": 2.5,
            "direction": "both",
            "seasonality": "dow",
            "min_baseline_samples": 14,
        },
        "cooldown_minutes": 360,
    },
    {
        "name": "Preset · Throughput drop",
        "rule_type": "metric_deviation",
        "config": {
            "metric": "case_count",
            "baseline_window_days": 28,
            "recent_window_days": 7,
            "min_zscore": 2.5,
            "direction": "below",
            "seasonality": "dow",
            "min_baseline_samples": 14,
        },
        "cooldown_minutes": 180,
    },
    {
        "name": "Preset · Rework rate climbing",
        "rule_type": "metric_deviation",
        "config": {
            "metric": "rework_pct",
            "baseline_window_days": 28,
            "recent_window_days": 7,
            "min_zscore": 2.0,
            "direction": "above",
            "seasonality": "none",
            "min_baseline_samples": 14,
        },
        "cooldown_minutes": 720,
    },
    {
        "name": "Preset · Volume anomaly (legacy)",
        "rule_type": "case_volume_anomaly",
        "config": {
            "window_hours": 24,
            "min_drop_pct": 50,
        },
        "cooldown_minutes": 360,
    },
]


async def _list_tenant_ids(pg) -> list[str]:
    """Read tenants from admin_service's shared table. If the table does not
    exist yet (cold DB), return ['tenant-001'] as a fallback."""
    try:
        rows = await pg.execute(text(
            "SELECT id FROM tenants WHERE status = 'active'"
        ))
        ids = [r[0] for r in rows.fetchall()]
        if ids:
            return ids
    except Exception as exc:  # table may not exist on a brand-new DB
        log.info("preset seeder: tenants table unavailable (%s); using default", exc)
    return ["tenant-001"]


async def seed_presets():
    """Insert presets for every active tenant. Conflicts on (tenant_id, name)
    are silently ignored, preserving any operator edits to existing rows."""
    async with PgSession() as pg:
        tenant_ids = await _list_tenant_ids(pg)
        for tid in tenant_ids:
            for preset in PRESETS:
                await pg.execute(
                    text(
                        "INSERT INTO alert_rules "
                        "(tenant_id, name, rule_type, object_type_id, config, "
                        " cooldown_minutes, enabled) "
                        "VALUES (:tid, :name, :rtype, NULL, CAST(:cfg AS jsonb), "
                        "        :cool, FALSE) "
                        "ON CONFLICT (tenant_id, name) DO NOTHING"
                    ),
                    {
                        "tid": tid,
                        "name": preset["name"],
                        "rtype": preset["rule_type"],
                        "cfg": json.dumps(preset["config"]),
                        "cool": preset["cooldown_minutes"],
                    },
                )
        await pg.commit()
        log.info("seeded presets for %d tenant(s)", len(tenant_ids))
