"""
End-to-end runner: snapshot → catalogs → plan → execute families → stability →
rank → write. Records progress in insight_runs.

Hard timeout via `max_runtime_minutes`. Per-family time budget enforced inside
each family using `deadline_ts`. The orchestrator never raises into the caller
— it always closes out the run row with a status.
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import text

import psutil

from database import PgSession, get_or_create_config
from snapshot import snapshot_records, snapshot_events, drop_snapshots
from feature_catalog import build_feature_catalog
from outcome_catalog import build_outcome_catalog
from planner import plan_tests
from families import all_families, enabled_families
from writer import apply_gates, write_insights, soft_delete_old_insights
from ranker import apply_ranking
from holdout_pass import replication_pass
from novelty import annotate_novelty
from llm_writer import rewrite_findings

log = logging.getLogger(__name__)


async def _open_run(tenant_id: str, cfg: dict) -> str:
    async with PgSession() as pg:
        row = await pg.execute(text(
            "INSERT INTO insight_runs (tenant_id, status, config_snapshot) "
            "VALUES (:t, 'running', CAST(:c AS jsonb)) RETURNING id"
        ), {"t": tenant_id, "c": json.dumps({k: v for k, v in cfg.items()
                                              if not isinstance(v, datetime)})})
        await pg.commit()
        return row.fetchone()._mapping["id"]


async def _close_run(run_id: str, status: str, *, tests_planned: int = 0,
                     tests_run: int = 0, insights_kept: int = 0,
                     families_run: list = None, family_durations_ms: dict = None,
                     duration_ms: int = 0, peak_memory_mb: int = 0,
                     error: str | None = None) -> None:
    async with PgSession() as pg:
        await pg.execute(text(
            "UPDATE insight_runs SET "
            " status = :s, finished_at = NOW(), "
            " tests_planned = :tp, tests_run = :tr, insights_kept = :ik, "
            " families_run = CAST(:fr AS jsonb), "
            " family_durations_ms = CAST(:fd AS jsonb), "
            " duration_ms = :dur, peak_memory_mb = :pm, error = :err "
            "WHERE id = :r"
        ), {
            "s": status, "tp": tests_planned, "tr": tests_run, "ik": insights_kept,
            "fr": json.dumps(families_run or []),
            "fd": json.dumps(family_durations_ms or {}),
            "dur": duration_ms, "pm": peak_memory_mb,
            "err": (error or "")[:1000], "r": run_id,
        })
        await pg.commit()


def _peak_memory_mb() -> int:
    try:
        return int(psutil.Process().memory_info().rss / (1024 * 1024))
    except Exception:
        return 0


async def run(tenant_id: str, manual: bool = False) -> str:
    """Run nightly discovery for one tenant. Returns the run_id whether it
    succeeded, partially completed, or errored."""
    cfg = await get_or_create_config(tenant_id)
    if not cfg.get("enabled") and not manual:
        log.info("insight_engine disabled for tenant %s", tenant_id)
        run_id = await _open_run(tenant_id, cfg)
        await _close_run(run_id, "skipped", error="disabled by config")
        return run_id

    started = time.monotonic()
    deadline = started + 60 * float(cfg.get("max_runtime_minutes") or 60)
    max_memory_mb = int(cfg.get("max_memory_mb") or 3072)

    run_id = await _open_run(tenant_id, cfg)
    snap_tag = run_id
    families_run: list[str] = []
    family_durations: dict[str, int] = {}
    all_findings: list[dict] = []
    tests_planned = 0
    tests_run = 0

    try:
        await snapshot_records(snap_tag, tenant_id)
        await snapshot_events(snap_tag, tenant_id)

        features = await build_feature_catalog(
            tenant_id, cfg.get("feature_denylist") or [])
        outcomes = await build_outcome_catalog(
            tenant_id, cfg.get("outcome_denylist") or [])

        # Persist feature snapshot for observability
        async with PgSession() as pg:
            for f in features:
                await pg.execute(text(
                    "INSERT INTO insight_feature_snapshots "
                    "(tenant_id, run_id, object_type_id, feature_name, "
                    " cardinality, missing_rate, dtype, semantic_type) "
                    "VALUES (:t, :r, :ot, :nm, :c, :mr, :dt, :sem) "
                    "ON CONFLICT DO NOTHING"
                ), {"t": tenant_id, "r": run_id, "ot": f.object_type_id,
                    "nm": f.name, "c": f.cardinality, "mr": f.missing_rate,
                    "dt": f.dtype, "sem": f.semantic_type})
            await pg.commit()

        plan = plan_tests(features, outcomes, cfg)
        tests_planned = len(plan)
        log.info("planned %d tests across families: %s",
                 tests_planned, list({s.family for s in plan}))

        # Group plan by family for batched execution
        by_family: dict[str, list] = {}
        for spec in plan:
            by_family.setdefault(spec.family, []).append(spec)

        registry = all_families()
        # Shared ctx — families can leave caches (ot_cache) and side-channel data
        # (psm_overrides) for later families to pick up.
        shared_ctx = {
            "tenant_id": tenant_id, "run_id": run_id,
            "cfg": cfg, "deadline": deadline,
            "snapshot_tag": snap_tag,
            "ot_cache": {},
            "raw_findings_so_far": all_findings,  # mutable reference
            "psm_overrides": {},
        }
        for fam_name, specs in by_family.items():
            if time.monotonic() > deadline:
                log.warning("deadline reached before family %s", fam_name)
                break
            if _peak_memory_mb() > max_memory_mb:
                log.warning("memory cap reached before family %s", fam_name)
                break
            entry = registry.get(fam_name)
            if entry is None:
                continue
            families_run.append(fam_name)
            fam_start = time.monotonic()
            try:
                findings = await entry.fn(specs, shared_ctx)
                tests_run += len(specs)
                for f in (findings or []):
                    f["family"] = fam_name
                    all_findings.append(f)
            except Exception as exc:
                log.exception("family %s failed: %s", fam_name, exc)
            family_durations[fam_name] = int((time.monotonic() - fam_start) * 1000)

        # Apply PSM overrides onto earlier findings (propensity has stamped
        # causal_estimate annotations on raw findings by feature/outcome key).
        psm_overrides = shared_ctx.get("psm_overrides") or {}
        for f in all_findings:
            key = f"{f.get('object_type_id')}:{f.get('feature',{}).get('name')}:{f.get('outcome',{}).get('name')}"
            if key in psm_overrides:
                f["causal_estimate"] = {**(f.get("causal_estimate") or {}), **psm_overrides[key]}

        # Holdout replication + novelty scoring (Phase 11)
        try:
            await replication_pass(tenant_id, all_findings,
                                    cache=shared_ctx["ot_cache"],
                                    holdout_pct=float(cfg.get("holdout_pct") or 0.2))
        except Exception as exc:
            log.warning("holdout replication pass failed: %s", exc)
        try:
            await annotate_novelty(tenant_id, all_findings)
        except Exception as exc:
            log.warning("novelty annotation failed: %s", exc)

        kept, drops = apply_gates(all_findings, cfg)
        ranked = apply_ranking(kept)
        # Cap top-N per config
        keep_n = int(cfg.get("keep_top_n") or 100)
        ranked = ranked[:keep_n]
        # Phase 15: LLM-rewrite titles + recommendations for top findings.
        try:
            await rewrite_findings(ranked[:25], cfg)
        except Exception as exc:
            log.warning("LLM rewrite skipped: %s", exc)
        n_written = await write_insights(tenant_id, run_id, ranked, keep_top_n=keep_n)
        await soft_delete_old_insights(tenant_id, days=14)

        # Phase 16: push nightly summary into alert_engine's notification feed.
        try:
            from clients.alert_engine import push_summary_notification
            top3 = ranked[:3]
            if top3:
                summary_msg = "Top findings: " + " · ".join(
                    f["title"][:80] for f in top3 if f.get("title")
                )
                await push_summary_notification(
                    tenant_id=tenant_id,
                    title=f"Nightly insight run ({n_written} kept)",
                    message=summary_msg,
                    details={
                        "run_id": run_id,
                        "insights_kept": n_written,
                        "top_insight_ids": [f.get("id") for f in top3 if f.get("id")],
                        "top_titles": [f.get("title") for f in top3],
                    },
                )
        except Exception as exc:
            log.info("nightly summary push skipped: %s", exc)

        await _close_run(
            run_id, "ok",
            tests_planned=tests_planned, tests_run=tests_run,
            insights_kept=n_written,
            families_run=families_run, family_durations_ms=family_durations,
            duration_ms=int((time.monotonic() - started) * 1000),
            peak_memory_mb=_peak_memory_mb(),
        )
        log.info("run %s ok: tests=%d kept=%d drops=%s", run_id, tests_run, n_written, drops)
    except Exception as exc:
        log.exception("run %s failed", run_id)
        await _close_run(
            run_id, "failed",
            tests_planned=tests_planned, tests_run=tests_run,
            families_run=families_run, family_durations_ms=family_durations,
            duration_ms=int((time.monotonic() - started) * 1000),
            peak_memory_mb=_peak_memory_mb(),
            error=str(exc),
        )
    finally:
        try:
            await drop_snapshots(snap_tag)
        except Exception as exc:
            log.warning("snapshot cleanup failed: %s", exc)

    return run_id
