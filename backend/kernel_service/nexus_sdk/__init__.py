"""Nexus SDK — injected into every kernel session so user code can talk to
the rest of the platform without handling HTTP, auth, or tenant headers.

Available at module level inside every notebook cell as `nexus`.
"""
from __future__ import annotations

import os
from typing import Any, Optional

import httpx
import pandas as pd


ANALYTICS_URL = os.environ.get("ANALYTICS_URL", "http://analytics-service:8015")
ONTOLOGY_URL = os.environ.get("ONTOLOGY_URL", "http://ontology-service:8004")


def _tenant_id() -> str:
    return os.environ.get("TENANT_ID", "tenant-001")


def _headers() -> dict:
    token = os.environ.get("AUTH_TOKEN", "")
    h = {"x-tenant-id": _tenant_id()}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def object_types() -> list[dict]:
    """List all object types available to the current tenant."""
    with httpx.Client(timeout=30) as c:
        r = c.get(f"{ANALYTICS_URL}/explore/object-types", headers=_headers())
        r.raise_for_status()
        return r.json()


def fields(object_type_id: str) -> dict:
    """Return `{fields: [...], record_count: N}` for an object type."""
    with httpx.Client(timeout=30) as c:
        r = c.get(
            f"{ANALYTICS_URL}/explore/object-types/{object_type_id}/fields",
            headers=_headers(),
        )
        r.raise_for_status()
        return r.json()


def query(
    object_type_id: str,
    filters: Optional[list[dict]] = None,
    aggregate: Optional[dict] = None,
    group_by: Optional[str] = None,
    order_by: Optional[dict] = None,
    limit: int = 500,
    offset: int = 0,
    select_fields: Optional[list[str]] = None,
) -> pd.DataFrame:
    """Run an analytics query and return the results as a pandas DataFrame.

    filters: [{field, op, value}]  (op: eq, neq, contains, starts_with, gt, gte, lt, lte, is_null, is_not_null)
    aggregate: {function, field}   (function: COUNT | SUM | AVG | MIN | MAX)
    order_by:  {field, direction}  (direction: asc | desc)
    """
    body = {
        "object_type_id": object_type_id,
        "filters": filters or [],
        "limit": int(limit),
        "offset": int(offset),
        "select_fields": select_fields or [],
    }
    if aggregate:
        body["aggregate"] = aggregate
    if group_by:
        body["group_by"] = group_by
    if order_by:
        body["order_by"] = order_by

    with httpx.Client(timeout=60) as c:
        r = c.post(f"{ANALYTICS_URL}/explore/query", json=body, headers=_headers())
        r.raise_for_status()
        payload = r.json()

    rows = payload.get("rows") or payload.get("records") or payload
    if not isinstance(rows, list):
        rows = [rows]
    return pd.DataFrame(rows)


def records(object_type_id: str, limit: int = 500, offset: int = 0) -> pd.DataFrame:
    """Fetch raw records for an object type as a DataFrame."""
    with httpx.Client(timeout=60) as c:
        r = c.get(
            f"{ONTOLOGY_URL}/object-types/{object_type_id}/records",
            params={"limit": int(limit), "offset": int(offset)},
            headers=_headers(),
        )
        r.raise_for_status()
        data = r.json()

    raw = data.get("records") or data.get("rows") or []
    flat = []
    for rec in raw:
        if isinstance(rec, dict) and "data" in rec and isinstance(rec["data"], dict):
            flat.append({"id": rec.get("id"), **rec["data"]})
        else:
            flat.append(rec)
    return pd.DataFrame(flat)


__all__ = ["query", "records", "object_types", "fields"]
