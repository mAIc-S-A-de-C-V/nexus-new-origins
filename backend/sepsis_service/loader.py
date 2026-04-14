"""
Download, parse, and index the Sepsis Cases Event Log XES file from 4TU.nl.
Uses only stdlib (xml.etree, urllib, gzip, zipfile) — no heavy dependencies.
"""
import gzip
import io
import os
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

# ── Download config ────────────────────────────────────────────────────────────
XES_URL = (
    "https://data.4tu.nl/ndownloader/items/"
    "33632f3c-5c48-40cf-8d8f-2db57f5a6ce7/versions/1"
)
CACHE_PATH = "/app/data/sepsis.xes"

# ── Global in-memory store ─────────────────────────────────────────────────────
DATA_STORE: dict = {}


# ── Helpers ───────────────────────────────────────────────────────────────────
def _safe_int(v):
    try:
        return int(v)
    except Exception:
        return None


def _safe_float(v):
    try:
        return float(v)
    except Exception:
        return None


def _safe_bool(v):
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return str(v).strip().lower() in ("true", "1", "yes")


def _parse_ts(s: str | None):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _read_attrs(element, ns: str) -> dict:
    """Read key/value attributes from XES element children."""
    attrs: dict = {}
    for child in element:
        tag = child.tag.replace(ns, "")
        if tag in ("string", "int", "float", "boolean", "date"):
            key = child.get("key")
            val = child.get("value")
            if key is not None:
                attrs[key] = val
    return attrs


# ── XES Parser ────────────────────────────────────────────────────────────────
def _parse_xes(path: str) -> tuple[list[dict], list[dict]]:
    tree = ET.parse(path)
    root = tree.getroot()

    # Detect namespace
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    cases: list[dict] = []
    events: list[dict] = []
    evt_counter = 0

    for trace in root.findall(f"{ns}trace"):
        # ── Trace-level attributes (case ID, patient demographics if present) ──
        trace_attrs = _read_attrs(trace, ns)
        case_id = trace_attrs.get("concept:name", f"case_{len(cases) + 1}")

        # ── Parse events ──────────────────────────────────────────────────────
        trace_events: list[dict] = []
        first_clinical: dict = {}

        for event_el in trace.findall(f"{ns}event"):
            ea = _read_attrs(event_el, ns)
            evt_counter += 1

            ts = _parse_ts(ea.get("time:timestamp"))
            evt = {
                "event_id": f"evt_{evt_counter}",
                "case_id": case_id,
                "activity": ea.get("concept:name"),
                "timestamp": ts.isoformat() if ts else None,
                "_ts": ts,
                "org_group": ea.get("org:group"),
                "lifecycle": ea.get("lifecycle:transition", "complete"),
                # Clinical measurements sometimes appear on events
                "diagnostic_artastrup": _safe_bool(ea.get("DiagnosticArtAstrup")),
                "diagnostic_blood": _safe_bool(ea.get("DiagnosticBlood")),
                "diagnostic_ecg": _safe_bool(ea.get("DiagnosticECG")),
                "diagnostic_ic": _safe_bool(ea.get("DiagnosticIC")),
                "diagnostic_lactic_acid": _safe_bool(ea.get("DiagnosticLacticAcid")),
                "diagnostic_xray": _safe_bool(ea.get("DiagnosticXthorax")),
                "sirs_heart_rate": _safe_bool(ea.get("SIRSCritHeartRate")),
                "sirs_leucos": _safe_bool(ea.get("SIRSCritLeucos")),
                "sirs_tachypnea": _safe_bool(ea.get("SIRSCritTachypnea")),
                "sirs_temperature": _safe_bool(ea.get("SIRSCritTemperature")),
                "sirs_2_or_more": _safe_bool(ea.get("SIRSCriteria2OrMore")),
                "infection_suspected": _safe_bool(ea.get("InfectionSuspected")),
                "hypotension": _safe_bool(ea.get("Hypotension")),
                "hypoxia": _safe_bool(ea.get("Hypoxie")),
                "oliguria": _safe_bool(ea.get("Oligurie")),
                "dysrhythmia": _safe_bool(ea.get("DysrhythmiaPresent")),
            }
            trace_events.append(evt)
            events.append(evt)

            # Capture first-event patient attributes
            if not first_clinical:
                first_clinical = ea

        # ── Sort by timestamp ──────────────────────────────────────────────────
        trace_events.sort(
            key=lambda e: e["_ts"] or datetime.min.replace(tzinfo=timezone.utc)
        )

        timestamps = [e["_ts"] for e in trace_events if e["_ts"]]
        start = min(timestamps) if timestamps else None
        end = max(timestamps) if timestamps else None
        duration_h = (
            round((end - start).total_seconds() / 3600, 2)
            if start and end
            else None
        )

        activity_list = [e["activity"] for e in trace_events]
        release = next(
            (a for a in reversed(activity_list) if a and a.startswith("Release")),
            None,
        )

        # Merge trace-level + first-event patient demographics
        merged = {**first_clinical, **trace_attrs}

        cases.append(
            {
                "case_id": case_id,
                "age": _safe_int(merged.get("Age")),
                "gender": merged.get("gender") or merged.get("Gender"),
                "diagnosis": merged.get("Diagnose"),
                "infection_suspected": _safe_bool(merged.get("InfectionSuspected")),
                "hypotension": _safe_bool(merged.get("Hypotension")),
                "hypoxia": _safe_bool(merged.get("Hypoxie")),
                "oliguria": _safe_bool(merged.get("Oligurie")),
                "sirs_2_or_more": _safe_bool(merged.get("SIRSCriteria2OrMore")),
                "start_time": start.isoformat() if start else None,
                "end_time": end.isoformat() if end else None,
                "duration_hours": duration_h,
                "outcome": release or "No Release Recorded",
                "has_icu_admission": any(
                    a == "Admission IC" for a in activity_list
                ),
                "has_ward_admission": any(
                    a == "Admission NC" for a in activity_list
                ),
                "num_events": len(trace_events),
            }
        )

    return cases, events


# ── Download + Load ───────────────────────────────────────────────────────────
def load_data_sync() -> None:
    global DATA_STORE

    # ── Download if not cached ─────────────────────────────────────────────────
    if not os.path.exists(CACHE_PATH):
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        print(f"[sepsis] Downloading dataset from 4TU.nl …")
        req = urllib.request.Request(
            XES_URL, headers={"User-Agent": "nexus-sepsis-service/1.0"}
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read()
        print(f"[sepsis] Downloaded {len(raw):,} bytes")

        # The download is a ZIP containing "Sepsis Cases - Event Log.xes.gz"
        xes_bytes: bytes | None = None
        try:
            with zipfile.ZipFile(io.BytesIO(raw)) as z:
                names = z.namelist()
                print(f"[sepsis] ZIP contents: {names}")
                xes_name = next(
                    (n for n in names if n.lower().endswith(".xes.gz")),
                    None,
                ) or next(
                    (n for n in names if n.lower().endswith(".xes")), None
                )
                if xes_name is None:
                    raise ValueError(f"No XES file in zip. Found: {names}")
                data = z.read(xes_name)
                xes_bytes = gzip.decompress(data) if xes_name.endswith(".gz") else data
        except zipfile.BadZipFile:
            # Maybe the download itself is the .xes.gz
            try:
                xes_bytes = gzip.decompress(raw)
            except Exception:
                xes_bytes = raw

        with open(CACHE_PATH, "wb") as f:
            f.write(xes_bytes)  # type: ignore[arg-type]
        print(f"[sepsis] Saved {len(xes_bytes):,} bytes → {CACHE_PATH}")

    # ── Parse ──────────────────────────────────────────────────────────────────
    print("[sepsis] Parsing XES …")
    cases_list, events_list = _parse_xes(CACHE_PATH)
    print(f"[sepsis] Parsed {len(cases_list)} cases, {len(events_list)} events")

    # ── Index ──────────────────────────────────────────────────────────────────
    cases_by_id = {c["case_id"]: c for c in cases_list}

    events_by_case: dict[str, list] = defaultdict(list)
    for e in events_list:
        events_by_case[e["case_id"]].append(e)

    # Sort each trace by timestamp
    for cid, evts in events_by_case.items():
        evts.sort(
            key=lambda e: e["_ts"] or datetime.min.replace(tzinfo=timezone.utc)
        )

    # Activity counts
    act_counts: dict[str, int] = defaultdict(int)
    org_counts: dict[str, int] = defaultdict(int)
    for e in events_list:
        if e["activity"]:
            act_counts[e["activity"]] += 1
        if e["org_group"]:
            org_counts[e["org_group"]] += 1

    # Outcome distribution
    outcome_dist: dict[str, int] = defaultdict(int)
    icu_count = 0
    gender_dist: dict[str, int] = defaultdict(int)
    ages = []
    durations = []
    for c in cases_list:
        outcome_dist[c["outcome"]] += 1
        if c["has_icu_admission"]:
            icu_count += 1
        if c["gender"]:
            gender_dist[c["gender"]] += 1
        if c["age"] is not None:
            ages.append(c["age"])
        if c["duration_hours"] is not None:
            durations.append(c["duration_hours"])

    # Pre-compute benchmark answers
    benchmark = _build_benchmark(
        cases_list, events_list, act_counts, icu_count, gender_dist, ages, durations, outcome_dist
    )

    DATA_STORE.update(
        {
            "cases": cases_by_id,
            "cases_list": cases_list,
            "events": events_list,
            "events_by_case": dict(events_by_case),
            "act_counts": dict(act_counts),
            "org_counts": dict(org_counts),
            "outcome_dist": dict(outcome_dist),
            "icu_count": icu_count,
            "gender_dist": dict(gender_dist),
            "ages": ages,
            "durations": durations,
            "benchmark": benchmark,
        }
    )


def _build_benchmark(cases, events, act_counts, icu_count, gender_dist, ages, durations, outcome_dist):
    avg_dur = round(sum(durations) / len(durations), 2) if durations else None
    max_dur = round(max(durations), 2) if durations else None
    min_dur = round(min(durations), 2) if durations else None
    most_common_act = max(act_counts, key=act_counts.get) if act_counts else None
    most_common_outcome = max(outcome_dist, key=outcome_dist.get) if outcome_dist else None

    return [
        {
            "id": "B1",
            "question": "How many cases are in the dataset?",
            "answer": len(cases),
            "hint": "GET /stats → total_cases",
        },
        {
            "id": "B2",
            "question": "How many events are in the dataset?",
            "answer": len(events),
            "hint": "GET /stats → total_events",
        },
        {
            "id": "B3",
            "question": "How many distinct activities exist?",
            "answer": len(act_counts),
            "hint": "GET /events/activities → count",
        },
        {
            "id": "B4",
            "question": "How many cases resulted in an ICU admission?",
            "answer": icu_count,
            "hint": "GET /stats → icu_admissions",
        },
        {
            "id": "B5",
            "question": "What is the most frequent activity?",
            "answer": most_common_act,
            "hint": "GET /events/activities → sort by count desc",
        },
        {
            "id": "B6",
            "question": "What is the average case duration in hours?",
            "answer": avg_dur,
            "hint": "GET /stats → avg_duration_hours",
        },
        {
            "id": "B7",
            "question": "What is the longest case duration in hours?",
            "answer": max_dur,
            "hint": "GET /stats → max_duration_hours",
        },
        {
            "id": "B8",
            "question": "What is the most common case outcome?",
            "answer": most_common_outcome,
            "hint": "GET /stats → outcome_distribution",
        },
        {
            "id": "B9",
            "question": "What activity does every case start with?",
            "answer": "ER Registration",
            "hint": "GET /cases/{id}/trace → first event activity",
        },
        {
            "id": "B10",
            "question": "How many cases have no recorded release activity?",
            "answer": outcome_dist.get("No Release Recorded", 0),
            "hint": "GET /stats → outcome_distribution['No Release Recorded']",
        },
    ]
