"""
Read-only access to the ontology service's tables (object_types, object_records,
ontology_links). insight_engine shares the postgres DB so we read directly via
SQL rather than going through HTTP — fewer hops in the nightly batch path.
"""
import json
from sqlalchemy import text

from database import PgSession


async def list_object_types(tenant_id: str) -> list[dict]:
    """Return [{id, name, display_name, properties: [...] }] for the tenant."""
    async with PgSession() as pg:
        rows = await pg.execute(
            text("SELECT id, name, display_name, data FROM object_types "
                 "WHERE tenant_id = :t ORDER BY display_name"),
            {"t": tenant_id},
        )
        out = []
        for r in rows.fetchall():
            data = r._mapping["data"]
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    data = {}
            props = (data or {}).get("properties") or []
            out.append({
                "id": r._mapping["id"],
                "name": r._mapping["name"],
                "display_name": r._mapping["display_name"],
                "properties": props,
            })
        return out


async def count_records(tenant_id: str, object_type_id: str) -> int:
    async with PgSession() as pg:
        row = await pg.execute(
            text("SELECT COUNT(*) AS c FROM object_records "
                 "WHERE tenant_id = :t AND object_type_id = :o"),
            {"t": tenant_id, "o": object_type_id},
        )
        return int(row.fetchone()._mapping["c"])


async def fetch_records(tenant_id: str, object_type_id: str,
                         limit: int | None = None) -> list[dict]:
    """Materialize JSONB `data` as plain dicts for analysis."""
    async with PgSession() as pg:
        sql = ("SELECT id, source_id, data FROM object_records "
               "WHERE tenant_id = :t AND object_type_id = :o")
        params = {"t": tenant_id, "o": object_type_id}
        if limit:
            sql += " LIMIT :lim"
            params["lim"] = int(limit)
        rows = await pg.execute(text(sql), params)
        out = []
        for r in rows.fetchall():
            d = r._mapping["data"] or {}
            if isinstance(d, str):
                try:
                    d = json.loads(d)
                except Exception:
                    d = {}
            d = dict(d)
            d["_record_id"] = r._mapping["id"]
            d["_source_id"] = r._mapping["source_id"]
            out.append(d)
        return out


async def get_link_graph(tenant_id: str) -> list[dict]:
    """Return ontology_links rows. Used by Phase 9 cross-OT discoverer and
    Phase 8 causal DAG seeding."""
    async with PgSession() as pg:
        rows = await pg.execute(
            text("SELECT id, source_object_type_id, target_object_type_id, data "
                 "FROM ontology_links WHERE tenant_id = :t"),
            {"t": tenant_id},
        )
        out = []
        for r in rows.fetchall():
            data = r._mapping["data"]
            if isinstance(data, str):
                try:
                    data = json.loads(data)
                except Exception:
                    data = {}
            out.append({
                "id": r._mapping["id"],
                "source_object_type_id": r._mapping["source_object_type_id"],
                "target_object_type_id": r._mapping["target_object_type_id"],
                "data": data or {},
            })
        return out
