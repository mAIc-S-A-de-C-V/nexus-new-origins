"""
Sepsis Cases Event Log API
Standalone service (port 8023) — no shared DB, no auth, no dependencies on the rest of Nexus.
Data: 4TU.nl doi:10.4121/uuid:915d2bfb-7e84-49ad-a286-dc35f063a460
"""
import asyncio
import math
from collections import defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from loader import DATA_STORE, load_data_sync


# ── Lifespan ──────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await asyncio.to_thread(load_data_sync)
    yield


app = FastAPI(
    title="Sepsis Dataset API",
    description="Real hospital event log for testing Nexus platform end-to-end",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────────────────────────────────────
# /health + /info
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/health", tags=["meta"])
def health():
    return {
        "status": "ok",
        "cases": len(DATA_STORE.get("cases", {})),
        "events": len(DATA_STORE.get("events", [])),
        "service": "sepsis-service",
    }


@app.get("/info", tags=["meta"])
def info():
    return {
        "name": "Sepsis Cases Event Log",
        "source": "https://data.4tu.nl/articles/dataset/Sepsis_Cases_Event_Log/12707639",
        "doi": "10.4121/uuid:915d2bfb-7e84-49ad-a286-dc35f063a460",
        "description": (
            "Real hospital event log of ~1050 sepsis patient cases with ~15 000 events "
            "recorded across 16 activities from a Dutch hospital (2013–2015). "
            "Timestamps are anonymised."
        ),
        "fields": {
            "Case": [
                "case_id", "age", "gender", "diagnosis",
                "infection_suspected", "hypotension", "hypoxia", "oliguria",
                "sirs_2_or_more", "start_time", "end_time", "duration_hours",
                "outcome", "has_icu_admission", "has_ward_admission", "num_events",
            ],
            "Event": [
                "event_id", "case_id", "activity", "timestamp", "org_group",
                "lifecycle", "diagnostic_blood", "diagnostic_ecg",
                "sirs_heart_rate", "sirs_leucos", "sirs_temperature",
                "infection_suspected", "hypotension", "hypoxia",
            ],
        },
        "endpoints": {
            "GET /health": "Liveness + loaded record counts",
            "GET /info": "This document",
            "GET /benchmark": "10 QA questions with ground-truth answers",
            "GET /cases": "Paginated case list with filters",
            "GET /cases/{id}": "Single case detail",
            "GET /cases/{id}/trace": "Ordered event trace for one case",
            "GET /events": "All events with filters",
            "GET /events/activities": "16 activities with event counts",
            "GET /events/resources": "Hospital units (org:group) with counts",
            "GET /stats": "Aggregate statistics",
            "GET /timeline": "Time-bucketed event counts (?bucket=hour|day|week)",
            "GET /flow": "Activity → activity transition matrix",
            "WS  /ws/stream": "Real-time event stream (replays real events at speed)",
        },
    }


@app.get("/benchmark", tags=["meta"])
def benchmark():
    """Ground-truth answers for QA / eval testing."""
    return {"items": DATA_STORE.get("benchmark", [])}


# ─────────────────────────────────────────────────────────────────────────────
# /cases
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/cases", tags=["cases"])
def list_cases(
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    outcome: Optional[str] = None,
    gender: Optional[str] = None,
    has_icu: Optional[bool] = None,
    min_age: Optional[int] = None,
    max_age: Optional[int] = None,
    min_duration: Optional[float] = None,
    max_duration: Optional[float] = None,
    sort_by: str = Query("case_id", enum=["case_id", "duration_hours", "age", "num_events"]),
    sort_dir: str = Query("asc", enum=["asc", "desc"]),
):
    items = DATA_STORE.get("cases_list", [])

    # Filters
    if outcome:
        items = [c for c in items if c["outcome"] == outcome]
    if gender:
        items = [c for c in items if c.get("gender", "").lower() == gender.lower()]
    if has_icu is not None:
        items = [c for c in items if c["has_icu_admission"] == has_icu]
    if min_age is not None:
        items = [c for c in items if c["age"] is not None and c["age"] >= min_age]
    if max_age is not None:
        items = [c for c in items if c["age"] is not None and c["age"] <= max_age]
    if min_duration is not None:
        items = [c for c in items if c["duration_hours"] is not None and c["duration_hours"] >= min_duration]
    if max_duration is not None:
        items = [c for c in items if c["duration_hours"] is not None and c["duration_hours"] <= max_duration]

    # Sort
    reverse = sort_dir == "desc"
    items = sorted(
        items,
        key=lambda c: (c.get(sort_by) is None, c.get(sort_by) or 0),
        reverse=reverse,
    )

    total = len(items)
    page = items[offset: offset + limit]

    # Strip internal _ts field
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [{k: v for k, v in c.items() if k != "_ts"} for c in page],
    }


@app.get("/cases/{case_id}", tags=["cases"])
def get_case(case_id: str):
    c = DATA_STORE.get("cases", {}).get(case_id)
    if c is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")
    return {k: v for k, v in c.items() if k != "_ts"}


@app.get("/cases/{case_id}/trace", tags=["cases"])
def get_trace(case_id: str):
    if case_id not in DATA_STORE.get("cases", {}):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Case '{case_id}' not found")
    evts = DATA_STORE.get("events_by_case", {}).get(case_id, [])
    return {
        "case_id": case_id,
        "num_events": len(evts),
        "events": [{k: v for k, v in e.items() if k != "_ts"} for e in evts],
    }


# ─────────────────────────────────────────────────────────────────────────────
# /events
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/events", tags=["events"])
def list_events(
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    activity: Optional[str] = None,
    org_group: Optional[str] = None,
    case_id: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
):
    items = DATA_STORE.get("events", [])

    if activity:
        items = [e for e in items if e["activity"] == activity]
    if org_group:
        items = [e for e in items if e.get("org_group") == org_group]
    if case_id:
        items = [e for e in items if e["case_id"] == case_id]
    if from_date:
        fd = _parse_date(from_date)
        if fd:
            items = [e for e in items if e["_ts"] and e["_ts"] >= fd]
    if to_date:
        td = _parse_date(to_date)
        if td:
            items = [e for e in items if e["_ts"] and e["_ts"] <= td]

    total = len(items)
    page = items[offset: offset + limit]
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [{k: v for k, v in e.items() if k != "_ts"} for e in page],
    }


@app.get("/events/activities", tags=["events"])
def list_activities():
    counts = DATA_STORE.get("act_counts", {})
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    return {
        "total": len(ranked),
        "items": [{"activity": a, "count": c} for a, c in ranked],
    }


@app.get("/events/resources", tags=["events"])
def list_resources():
    counts = DATA_STORE.get("org_counts", {})
    ranked = sorted(counts.items(), key=lambda x: x[1], reverse=True)
    return {
        "total": len(ranked),
        "items": [{"org_group": g, "count": c} for g, c in ranked],
    }


# ─────────────────────────────────────────────────────────────────────────────
# /stats
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/stats", tags=["analytics"])
def stats():
    cases = DATA_STORE.get("cases_list", [])
    events = DATA_STORE.get("events", [])
    durations = DATA_STORE.get("durations", [])
    ages = DATA_STORE.get("ages", [])

    avg_dur = _mean(durations)
    median_dur = _median(durations)
    avg_age = _mean(ages)
    median_age = _median(ages)

    return {
        "total_cases": len(cases),
        "total_events": len(events),
        "distinct_activities": len(DATA_STORE.get("act_counts", {})),
        "distinct_org_groups": len(DATA_STORE.get("org_counts", {})),
        "icu_admissions": DATA_STORE.get("icu_count", 0),
        "icu_rate_pct": round(DATA_STORE.get("icu_count", 0) / len(cases) * 100, 1) if cases else 0,
        "avg_duration_hours": avg_dur,
        "median_duration_hours": median_dur,
        "min_duration_hours": round(min(durations), 2) if durations else None,
        "max_duration_hours": round(max(durations), 2) if durations else None,
        "avg_age": avg_age,
        "median_age": median_age,
        "min_age": min(ages) if ages else None,
        "max_age": max(ages) if ages else None,
        "gender_distribution": DATA_STORE.get("gender_dist", {}),
        "outcome_distribution": DATA_STORE.get("outcome_dist", {}),
        "avg_events_per_case": round(len(events) / len(cases), 1) if cases else 0,
    }


# ─────────────────────────────────────────────────────────────────────────────
# /timeline
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/timeline", tags=["analytics"])
def timeline(
    bucket: str = Query("day", enum=["hour", "day", "week"]),
    activity: Optional[str] = None,
):
    events = DATA_STORE.get("events", [])
    if activity:
        events = [e for e in events if e["activity"] == activity]

    buckets: dict[str, int] = defaultdict(int)
    for e in events:
        ts = e["_ts"]
        if ts is None:
            continue
        if bucket == "hour":
            key = ts.strftime("%Y-%m-%dT%H:00")
        elif bucket == "week":
            # ISO week
            key = ts.strftime("%Y-W%W")
        else:
            key = ts.strftime("%Y-%m-%d")
        buckets[key] += 1

    sorted_buckets = sorted(buckets.items())
    return {
        "bucket": bucket,
        "activity_filter": activity,
        "items": [{"bucket": k, "count": v} for k, v in sorted_buckets],
    }


# ─────────────────────────────────────────────────────────────────────────────
# /flow  (activity transition matrix)
# ─────────────────────────────────────────────────────────────────────────────
@app.get("/flow", tags=["analytics"])
def flow():
    """Returns activity → activity transition counts (process flow / directly-follows graph)."""
    transitions: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for evts in DATA_STORE.get("events_by_case", {}).values():
        for i in range(len(evts) - 1):
            src = evts[i]["activity"] or "?"
            tgt = evts[i + 1]["activity"] or "?"
            transitions[src][tgt] += 1

    # Flatten to list for easy consumption
    edges = []
    for src, targets in transitions.items():
        for tgt, count in targets.items():
            edges.append({"from": src, "to": tgt, "count": count})

    edges.sort(key=lambda x: x["count"], reverse=True)
    return {"total_transitions": sum(e["count"] for e in edges), "edges": edges}


# ─────────────────────────────────────────────────────────────────────────────
# WebSocket: /ws/stream
# ─────────────────────────────────────────────────────────────────────────────
@app.websocket("/ws/stream")
async def ws_stream(websocket: WebSocket):
    """
    Replay all real events in timestamp order at a rate of ~5 events/sec.
    Loops when exhausted.  Clients receive JSON objects matching the event schema.
    """
    await websocket.accept()
    events = sorted(
        DATA_STORE.get("events", []),
        key=lambda e: e["_ts"] or datetime.min.replace(tzinfo=timezone.utc),
    )
    if not events:
        await websocket.close()
        return

    import json
    idx = 0
    try:
        while True:
            e = events[idx % len(events)]
            payload = {k: v for k, v in e.items() if k != "_ts"}
            await websocket.send_text(json.dumps(payload))
            idx += 1
            await asyncio.sleep(0.2)  # 5 events/sec
    except WebSocketDisconnect:
        pass


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _parse_date(s: str):
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _mean(values: list[float]) -> Optional[float]:
    if not values:
        return None
    return round(sum(values) / len(values), 2)


def _median(values: list[float]) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    n = len(s)
    mid = n // 2
    if n % 2 == 0:
        return round((s[mid - 1] + s[mid]) / 2, 2)
    return round(s[mid], 2)
