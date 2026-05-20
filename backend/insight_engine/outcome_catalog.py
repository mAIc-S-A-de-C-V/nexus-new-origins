"""
Enumerates candidate **outcomes** per object type. Outcomes are what we test
features against. Default outcomes are derived from the event log
(cycle_hours, rework_pct, sla_breach_flag, terminal_reached, cost) plus any
numeric property of the OT that isn't denylisted.
"""
from dataclasses import dataclass, asdict
from clients.ontology import list_object_types
from clients.events import case_spans


@dataclass
class OutcomeMeta:
    object_type_id: str
    name: str
    kind: str            # 'numeric' | 'categorical' | 'time_to_event' | 'terminal_reached'
    derivation: str      # 'event_log' | 'record_property' | 'composite'
    notes: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


# Default derived outcomes computed off the event log per case.
DERIVED_OUTCOMES = [
    OutcomeMeta(object_type_id="", name="cycle_hours", kind="numeric", derivation="event_log",
                notes="MAX(timestamp) - MIN(timestamp) per case"),
    OutcomeMeta(object_type_id="", name="event_count", kind="numeric", derivation="event_log",
                notes="number of events per case"),
    OutcomeMeta(object_type_id="", name="rework_flag", kind="categorical", derivation="event_log",
                notes="case had an activity repeat"),
    OutcomeMeta(object_type_id="", name="case_complete", kind="categorical", derivation="event_log",
                notes="case reached a terminal activity"),
    OutcomeMeta(object_type_id="", name="total_cost", kind="numeric", derivation="event_log",
                notes="SUM(cost) across events"),
]


async def build_outcome_catalog(tenant_id: str, user_outcome_denylist: list[str]) -> list[OutcomeMeta]:
    deny = set(user_outcome_denylist or [])
    out: list[OutcomeMeta] = []
    object_types = await list_object_types(tenant_id)
    for ot in object_types:
        # Only attach derived outcomes if there are events for this OT.
        spans = await case_spans(tenant_id, ot["id"], days=180)
        if spans:
            for d in DERIVED_OUTCOMES:
                if d.name in deny:
                    continue
                out.append(OutcomeMeta(
                    object_type_id=ot["id"], name=d.name, kind=d.kind,
                    derivation=d.derivation, notes=d.notes,
                ))
        # Also expose numeric record properties as candidate outcomes (not just features).
        for prop in (ot.get("properties") or []):
            name = prop.get("name")
            if not name or name in deny:
                continue
            sem = prop.get("semantic_type")
            ptype = prop.get("type") or prop.get("data_type")
            if sem in ("IDENTIFIER", "EMAIL"):
                continue
            if ptype in ("number", "integer", "float", "double") or sem in ("CURRENCY", "PERCENTAGE"):
                out.append(OutcomeMeta(
                    object_type_id=ot["id"], name=name, kind="numeric",
                    derivation="record_property",
                ))
    return out
