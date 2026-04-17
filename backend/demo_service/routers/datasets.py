"""
REST API endpoints that serve demo data as if they were real external systems.

Each dataset has:
  GET  /datasets/{name}          → metadata (description, fields, total count)
  GET  /datasets/{name}/records  → paginated records (limit, offset, sort, filter)
  GET  /datasets/{name}/schema   → field names + types for connector schema inference

These endpoints are designed to be consumed by Nexus REST_API connectors.
Point a connector at http://demo-service:8024/datasets/{name}/records and it works.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

from generators import (
    generate_bpic2012, generate_bpic2017, generate_bpic2019,
    generate_bpic2011, generate_bpic2014_incidents, generate_bpic2014_changes,
    generate_traffic_fines, generate_bpic2015, generate_sepsis,
    generate_smart_factory, generate_bpic2020_domestic,
    generate_bpic2020_international, generate_bpic2020_prepaid,
    generate_bpic2020_permits, generate_bpic2020_payment_requests,
)

router = APIRouter()

# ── Dataset registry ──────────────────────────────────────────────────────

DATASET_CATALOG: dict[str, dict] = {
    # ── Finance ──
    "bpic2012-loan-applications": {
        "name": "BPIC 2012 — Loan Applications",
        "industry": "Finance / Banking",
        "description": "Dutch bank loan application process — 13K cases, 262K events. "
                       "Activities include submission, validation, offer handling, and approval/decline.",
        "source": "https://data.4tu.nl/articles/dataset/BPI_Challenge_2012/12689204",
        "generator": generate_bpic2012,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2017-loan-applications": {
        "name": "BPIC 2017 — Loan Applications (Enhanced)",
        "industry": "Finance / Banking",
        "description": "Same Dutch bank, richer data — 31K cases, 1.2M events. Includes credit scores, "
                       "loan goals, application types, and multi-offer lifecycle.",
        "source": "https://data.4tu.nl/repository/uuid:5f3067df-f10b-45da-b98b-86ae4c7a310b",
        "generator": generate_bpic2017,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },

    # ── Procurement ──
    "bpic2019-purchase-orders": {
        "name": "BPIC 2019 — SAP Purchase Orders",
        "industry": "Procurement / ERP",
        "description": "SAP procure-to-pay process — 251K cases, 1.6M events. Covers PO creation, "
                       "goods receipt, invoice handling, and payment. Includes vendor, spend area, and document type.",
        "source": "https://data.4tu.nl/articles/dataset/BPI_Challenge_2019/12715853",
        "generator": generate_bpic2019,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },

    # ── Healthcare ──
    "bpic2011-hospital": {
        "name": "BPIC 2011 — Hospital Gynaecology",
        "industry": "Healthcare",
        "description": "Dutch Academic Hospital patient journeys — 1.1K cases, 150K events. "
                       "Gynaecology department with 624 unique activities including diagnostics, "
                       "treatments, and administrative tasks.",
        "source": "https://data.4tu.nl/articles/dataset/Hospital_log/12691105",
        "generator": generate_bpic2011,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "sepsis-icu": {
        "name": "Sepsis Cases — ICU Pathways",
        "industry": "Healthcare",
        "description": "ICU sepsis patient pathways — 1K cases, 15K events, 39 clinical attributes. "
                       "Includes lab values (CRP, Leucocytes, Lactic Acid), SIRS criteria, and outcomes.",
        "source": "https://data.4tu.nl/articles/dataset/Sepsis_Cases_-_Event_Log/12707639",
        "generator": generate_sepsis,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },

    # ── ITSM ──
    "bpic2014-incidents": {
        "name": "BPIC 2014 — IT Incidents (Rabobank)",
        "industry": "IT Service Management",
        "description": "Rabobank ITIL incident management — 46K incidents, 466K events. "
                       "Covers incident lifecycle with assignment groups, escalation, and resolution.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2014/5065469",
        "generator": generate_bpic2014_incidents,
        "case_id_field": "incident_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2014-changes": {
        "name": "BPIC 2014 — IT Changes (Rabobank)",
        "industry": "IT Service Management",
        "description": "Rabobank ITIL change management — linked to incidents via CI Name. "
                       "Includes change types (Normal/Standard/Emergency) and risk assessments.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2014/5065469",
        "generator": generate_bpic2014_changes,
        "case_id_field": "change_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },

    # ── Government ──
    "traffic-fines": {
        "name": "Road Traffic Fine Management",
        "industry": "Government / Compliance",
        "description": "Italian road traffic fine management — 150K cases, 561K events. "
                       "Clean structured process: fine creation, notification, penalty, payment, "
                       "credit collection, and appeals.",
        "source": "https://data.4tu.nl/articles/dataset/Road_Traffic_Fine_Management_Process/12683249",
        "generator": generate_traffic_fines,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2015-permits-m1": {
        "name": "BPIC 2015 — Building Permits (Municipality 1)",
        "industry": "Government / Compliance",
        "description": "Building permit applications — Municipality 1 of 5 Dutch municipalities. "
                       "Long sequential regulatory process spanning months to years.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2015/5065424",
        "generator": lambda n=800: generate_bpic2015(municipality=1, n_cases=n),
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2015-permits-m2": {
        "name": "BPIC 2015 — Building Permits (Municipality 2)",
        "industry": "Government / Compliance",
        "description": "Building permit applications — Municipality 2. "
                       "Compare processing speed and compliance against other municipalities.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2015/5065424",
        "generator": lambda n=800: generate_bpic2015(municipality=2, n_cases=n),
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2015-permits-m3": {
        "name": "BPIC 2015 — Building Permits (Municipality 3)",
        "industry": "Government / Compliance",
        "description": "Building permit applications — Municipality 3.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2015/5065424",
        "generator": lambda n=800: generate_bpic2015(municipality=3, n_cases=n),
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2015-permits-m4": {
        "name": "BPIC 2015 — Building Permits (Municipality 4)",
        "industry": "Government / Compliance",
        "description": "Building permit applications — Municipality 4.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2015/5065424",
        "generator": lambda n=800: generate_bpic2015(municipality=4, n_cases=n),
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2015-permits-m5": {
        "name": "BPIC 2015 — Building Permits (Municipality 5)",
        "industry": "Government / Compliance",
        "description": "Building permit applications — Municipality 5 (slowest processing).",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2015/5065424",
        "generator": lambda n=800: generate_bpic2015(municipality=5, n_cases=n),
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },

    # ── Manufacturing ──
    "smart-factory-iot": {
        "name": "Smart Factory IoT Event Log",
        "industry": "Manufacturing / IoT",
        "description": "IoT-enriched manufacturing event log — production orders with sensor data. "
                       "Includes temperature, vibration, power consumption, QA scores, and defect types.",
        "source": "https://figshare.com/articles/dataset/20130794",
        "generator": generate_smart_factory,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },

    # ── Travel ──
    "bpic2020-domestic": {
        "name": "BPIC 2020 — Domestic Travel Declarations",
        "industry": "Travel & Expenses",
        "description": "University domestic travel expense declarations — 10.5K cases. "
                       "Multi-level approval chain with rejection and resubmission loops.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2020/5065541",
        "generator": generate_bpic2020_domestic,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2020-international": {
        "name": "BPIC 2020 — International Travel Declarations",
        "industry": "Travel & Expenses",
        "description": "University international travel declarations — 6.4K cases. "
                       "Longer approval chains, higher amounts, director-level sign-off.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2020/5065541",
        "generator": generate_bpic2020_international,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2020-prepaid": {
        "name": "BPIC 2020 — Prepaid Travel Costs",
        "industry": "Travel & Expenses",
        "description": "University prepaid travel costs — 2K cases. "
                       "Simpler flow: submit → approve → register → payment.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2020/5065541",
        "generator": generate_bpic2020_prepaid,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2020-permits": {
        "name": "BPIC 2020 — Travel Permits",
        "industry": "Travel & Expenses",
        "description": "University travel permits — 7K cases. "
                       "Links to domestic/international declarations via permit number.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2020/5065541",
        "generator": generate_bpic2020_permits,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
    "bpic2020-payments": {
        "name": "BPIC 2020 — Payment Requests",
        "industry": "Travel & Expenses",
        "description": "University payment requests — 6.9K cases. "
                       "Standalone reimbursement requests with budget owner approval.",
        "source": "https://data.4tu.nl/collections/BPI_Challenge_2020/5065541",
        "generator": generate_bpic2020_payment_requests,
        "case_id_field": "case_id",
        "activity_field": "activity",
        "timestamp_field": "timestamp",
    },
}


# ── Cached data generation ────────────────────────────────────────────────

@lru_cache(maxsize=32)
def _get_data(dataset_key: str) -> list[dict]:
    entry = DATASET_CATALOG.get(dataset_key)
    if not entry:
        return []
    return entry["generator"]()


def _infer_type(value) -> str:
    if value is None:
        return "string"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "float"
    s = str(value)
    if "T" in s and s.endswith("Z"):
        return "datetime"
    return "string"


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.get("/")
async def list_datasets():
    """List all available demo datasets with metadata."""
    result = []
    for key, meta in DATASET_CATALOG.items():
        data = _get_data(key)
        result.append({
            "id": key,
            "name": meta["name"],
            "industry": meta["industry"],
            "description": meta["description"],
            "source": meta["source"],
            "total_records": len(data),
            "case_id_field": meta["case_id_field"],
            "activity_field": meta["activity_field"],
            "timestamp_field": meta["timestamp_field"],
            "endpoint": f"/datasets/{key}/records",
        })
    return {"datasets": result, "total": len(result)}


@router.get("/{dataset_id}")
async def get_dataset_info(dataset_id: str):
    """Get metadata for a specific dataset."""
    meta = DATASET_CATALOG.get(dataset_id)
    if not meta:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found. "
                            f"Available: {', '.join(DATASET_CATALOG.keys())}")
    data = _get_data(dataset_id)
    fields = list(data[0].keys()) if data else []
    return {
        "id": dataset_id,
        "name": meta["name"],
        "industry": meta["industry"],
        "description": meta["description"],
        "source": meta["source"],
        "total_records": len(data),
        "fields": fields,
        "case_id_field": meta["case_id_field"],
        "activity_field": meta["activity_field"],
        "timestamp_field": meta["timestamp_field"],
    }


@router.get("/{dataset_id}/schema")
async def get_dataset_schema(dataset_id: str):
    """Return field names, types, and sample values — for connector schema inference."""
    meta = DATASET_CATALOG.get(dataset_id)
    if not meta:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")
    data = _get_data(dataset_id)
    if not data:
        return {"fields": [], "sample_rows": [], "total": 0}

    # Infer types from first 10 rows
    fields_info = []
    keys = list(data[0].keys())
    for key in keys:
        samples = [row.get(key) for row in data[:10] if row.get(key) is not None]
        field_type = _infer_type(samples[0]) if samples else "string"
        fields_info.append({
            "name": key,
            "type": field_type,
            "samples": [str(s) for s in samples[:3]],
            "null_count": sum(1 for row in data[:100] if row.get(key) is None),
        })

    return {
        "fields": fields_info,
        "sample_rows": data[:5],
        "total": len(data),
    }


@router.get("/{dataset_id}/records")
async def get_dataset_records(
    dataset_id: str,
    limit: int = Query(100, ge=1, le=5000),
    offset: int = Query(0, ge=0),
    sort_field: Optional[str] = Query(None),
    sort_dir: Optional[str] = Query("asc", regex="^(asc|desc)$"),
    case_id: Optional[str] = Query(None, description="Filter by case ID (exact match)"),
    activity: Optional[str] = Query(None, description="Filter by activity name (contains)"),
    filter_field: Optional[str] = Query(None, description="Generic filter field name"),
    filter_value: Optional[str] = Query(None, description="Generic filter value (exact match)"),
    filter_op: Optional[str] = Query("eq", description="Filter operator: eq, neq, contains, gt, lt"),
):
    """
    Paginated records endpoint — designed to be consumed by Nexus REST_API connectors.

    Supports:
    - Pagination: limit + offset
    - Sorting: sort_field + sort_dir
    - Filtering: case_id, activity, or generic filter_field/filter_value/filter_op
    """
    meta = DATASET_CATALOG.get(dataset_id)
    if not meta:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")

    data = _get_data(dataset_id)

    # Apply filters
    filtered = data
    if case_id:
        filtered = [r for r in filtered if str(r.get(meta["case_id_field"], "")) == case_id]
    if activity:
        filtered = [r for r in filtered
                    if activity.lower() in str(r.get(meta["activity_field"], "")).lower()]
    if filter_field and filter_value is not None:
        def _match(row: dict) -> bool:
            val = row.get(filter_field)
            if val is None:
                return filter_op == "is_empty"
            sval = str(val)
            if filter_op == "eq":
                return sval == filter_value
            if filter_op == "neq":
                return sval != filter_value
            if filter_op == "contains":
                return filter_value.lower() in sval.lower()
            if filter_op == "gt":
                try: return float(val) > float(filter_value)
                except: return sval > filter_value
            if filter_op == "lt":
                try: return float(val) < float(filter_value)
                except: return sval < filter_value
            return True
        filtered = [r for r in filtered if _match(r)]

    # Sort
    if sort_field:
        reverse = sort_dir == "desc"
        try:
            filtered.sort(key=lambda r: (r.get(sort_field) is None, r.get(sort_field, "")),
                         reverse=reverse)
        except TypeError:
            pass  # mixed types

    total = len(filtered)
    page = filtered[offset:offset + limit]

    return {
        "records": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
        "dataset": meta["name"],
    }


@router.get("/{dataset_id}/cases")
async def get_dataset_cases(
    dataset_id: str,
    limit: int = Query(50, ge=1, le=1000),
    offset: int = Query(0, ge=0),
):
    """
    Returns one row per case with aggregated case-level attributes.
    Useful for case-centric analysis.
    """
    meta = DATASET_CATALOG.get(dataset_id)
    if not meta:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")

    data = _get_data(dataset_id)
    case_field = meta["case_id_field"]
    ts_field = meta["timestamp_field"]
    act_field = meta["activity_field"]

    # Group by case
    cases: dict[str, list[dict]] = {}
    for row in data:
        cid = str(row.get(case_field, ""))
        cases.setdefault(cid, []).append(row)

    # Build case summaries
    summaries = []
    for cid, events in cases.items():
        events.sort(key=lambda r: r.get(ts_field, ""))
        first = events[0]
        last = events[-1]

        # Carry forward case-level attributes (non-event fields)
        case_attrs = {}
        for k, v in first.items():
            if k not in (act_field, ts_field, "lifecycle", "resource", "org_group"):
                case_attrs[k] = v

        case_attrs.update({
            case_field: cid,
            "event_count": len(events),
            "first_activity": first.get(act_field),
            "last_activity": last.get(act_field),
            "start_time": first.get(ts_field),
            "end_time": last.get(ts_field),
            "unique_activities": len(set(e.get(act_field, "") for e in events)),
        })
        summaries.append(case_attrs)

    total = len(summaries)
    page = summaries[offset:offset + limit]

    return {
        "cases": page,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + limit < total,
    }


@router.get("/{dataset_id}/stats")
async def get_dataset_stats(dataset_id: str):
    """Quick summary statistics for a dataset."""
    meta = DATASET_CATALOG.get(dataset_id)
    if not meta:
        raise HTTPException(404, f"Dataset '{dataset_id}' not found")

    data = _get_data(dataset_id)
    case_field = meta["case_id_field"]
    act_field = meta["activity_field"]
    ts_field = meta["timestamp_field"]

    case_ids = set(r.get(case_field) for r in data)
    activities = set(r.get(act_field) for r in data)

    timestamps = sorted(r.get(ts_field, "") for r in data if r.get(ts_field))

    return {
        "dataset": meta["name"],
        "total_events": len(data),
        "total_cases": len(case_ids),
        "unique_activities": len(activities),
        "activity_list": sorted(activities),
        "date_range": {
            "start": timestamps[0] if timestamps else None,
            "end": timestamps[-1] if timestamps else None,
        },
        "fields": list(data[0].keys()) if data else [],
    }
