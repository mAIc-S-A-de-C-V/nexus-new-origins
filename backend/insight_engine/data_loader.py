"""
Per-OT data loader. Returns a pandas DataFrame for the requested object type
with feature columns from object_records and derived outcome columns from
case-aggregated events. Cached per (tenant_id, object_type_id) within a run
via the `cache` dict on ctx.
"""
import logging
import pandas as pd

from clients.ontology import fetch_records
from clients.events import case_spans, fetch_events_for_ot

log = logging.getLogger(__name__)


async def load_ot_dataframe(tenant_id: str, object_type_id: str,
                             cache: dict | None = None,
                             record_limit: int | None = None) -> pd.DataFrame:
    """Return DataFrame[rows = records, columns = feature props + derived
    outcomes]. Outcome columns:
       cycle_hours, event_count, rework_flag, case_complete, total_cost
    derived from events joined on source_id == case_id. Missing for records
    that have no events.

    Results are cached on the supplied dict to avoid double-fetches within a
    single run.
    """
    key = (tenant_id, object_type_id)
    if cache is not None and key in cache:
        return cache[key]

    records = await fetch_records(tenant_id, object_type_id, limit=record_limit)
    if not records:
        df = pd.DataFrame()
        if cache is not None:
            cache[key] = df
        return df

    flat = []
    for rec in records:
        row = {k: v for k, v in rec.items() if not k.startswith("_")}
        row["_record_id"] = rec.get("_record_id")
        row["_source_id"] = rec.get("_source_id")
        flat.append(row)
    df = pd.DataFrame(flat)

    # Derive outcomes from events. case_spans returns one row per case_id;
    # we attach by source_id == case_id (common pattern for HubSpot/Salesforce
    # sourced object types where the source's primary key is the case id).
    spans = await case_spans(tenant_id, object_type_id, days=365)
    if spans:
        spans_df = pd.DataFrame(spans)
        spans_df.rename(columns={
            "case_id": "_case_id",
            "hours": "cycle_hours",
            "n_events": "event_count",
        }, inplace=True)
        # rework_flag: any activity repeats
        def _rework(acts):
            if not acts:
                return 0
            return int(len(acts) != len(set(acts)))
        spans_df["rework_flag"] = spans_df["activities"].apply(_rework)
        spans_df["case_complete"] = spans_df["activities"].apply(
            lambda acts: int(bool(acts) and acts[-1].lower().startswith(("complet", "closed", "done", "won", "lost", "delivered")))
        )
        # total_cost is left for an event-level aggregation
        events = await fetch_events_for_ot(tenant_id, object_type_id, days=365)
        if events:
            ev_df = pd.DataFrame(events)
            cost_by_case = ev_df.groupby("case_id")["cost"].sum(min_count=1).reset_index()
            cost_by_case.rename(columns={"case_id": "_case_id", "cost": "total_cost"}, inplace=True)
            spans_df = spans_df.merge(cost_by_case, on="_case_id", how="left")
        else:
            spans_df["total_cost"] = None
        # join records ← spans on source_id == case_id
        if "_source_id" in df.columns:
            df = df.merge(spans_df[["_case_id", "cycle_hours", "event_count",
                                     "rework_flag", "case_complete", "total_cost"]],
                          left_on="_source_id", right_on="_case_id", how="left")
            df.drop(columns=["_case_id"], inplace=True, errors="ignore")

    if cache is not None:
        cache[key] = df
    return df
