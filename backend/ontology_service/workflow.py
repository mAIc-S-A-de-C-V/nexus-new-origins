"""
Workflow engine for ActionExecutionRow — multi-stage approval with parallel
groups, conditional next routing, JSONLogic entry conditions, SLA timers,
real user accounts as assignees, and option subset selection.

The engine is pure logic over Python dicts. Persistence and HTTP live in
routers/actions.py and routers/workflow.py — those callers fetch the row,
hand the engine its current state + the decision being made, and write the
returned new state back.

State shape on ActionExecutionRow:
  current_stage:    "<stage_name>" | "completed" | "rejected" | None
  stage_state: {
    <stage_name>: {
      "entered_at":  ISO timestamp,
      "sla_at":      ISO timestamp | null,
      "status":      "active" | "approved" | "rejected" | "timed_out",
      "decisions":   [...],          # for option_review/option_select
      "branches":    {child_stage_name: {...}}  # only for parallel_group
    }
  }
  stage_history: append-only audit [{stage, actor_user_id, actor_email, at, decision, note, ...}]

Stage definition shape (lives on ActionDefinitionRow.workflow_stages):
  {
    "name":          "manager_review",
    "type":          "approval" | "option_review" | "option_select" | "parallel_group",
    "when":          <JSONLogic>          # optional — skip stage if false
    "assignee":      {kind, value}        # see resolve_assignee
    "options_field": "options"            # only for option_review/option_select
    "min_approve":   1                    # option_review: min surviving for advance
    "min_select":    1                    # option_select: minimum picks required
    "max_select":    1                    # option_select: maximum picks allowed
    "on_approve":    "next_stage" | "completed"
    "on_reject":     "next_stage" | "rejected"
    "on_timeout":    {action: "approve"|"reject"|"reassign", to?: assignee}
    "sla_seconds":   86400                # null = no SLA
    "notify_on_enter": [<assignee-spec>...]  # optional extra notify list
    "notify_on_exit":  [<assignee-spec>...]
    "branches":      [<stage_name>...]    # parallel_group: all must complete
  }
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jsonlogic import evaluate_bool

logger = logging.getLogger(__name__)

# ── Stage type sentinels ─────────────────────────────────────────────────────

TYPE_APPROVAL = "approval"
TYPE_OPTION_REVIEW = "option_review"
TYPE_OPTION_SELECT = "option_select"
TYPE_PARALLEL = "parallel_group"

VALID_TYPES = {TYPE_APPROVAL, TYPE_OPTION_REVIEW, TYPE_OPTION_SELECT, TYPE_PARALLEL}

TERMINAL_COMPLETED = "completed"
TERMINAL_REJECTED = "rejected"

DECISION_APPROVE = "approve"
DECISION_REJECT = "reject"
DECISION_SELECT_OPTIONS = "select_options"   # option_select
DECISION_REVIEW_OPTIONS = "review_options"   # option_review (approve subset)


# ── Helpers ──────────────────────────────────────────────────────────────────

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _stages_by_name(stages: list[dict]) -> dict[str, dict]:
    return {s["name"]: s for s in (stages or []) if isinstance(s, dict) and s.get("name")}


def _eval_when(stage: dict, payload: dict) -> bool:
    """Stage entry is gated by `when` JSONLogic. Missing/empty rule = always enter."""
    return evaluate_bool(stage.get("when"), payload)


def _sla_at(stage: dict, now: datetime) -> Optional[str]:
    s = stage.get("sla_seconds")
    if not s:
        return None
    try:
        return (now + timedelta(seconds=int(s))).isoformat()
    except (TypeError, ValueError):
        return None


# ── Assignee resolution ──────────────────────────────────────────────────────
# Assignee specs:
#   {"kind": "user_id",     "value": "<uuid>"}
#   {"kind": "user_email",  "value": "vp@maic.ai"}
#   {"kind": "from_payload","field": "requester_user_id"}
#   {"kind": "role",        "value": "admin"}      # picks any user with role
#
# The engine only normalizes the spec. Actual user record lookup
# (id ↔ email ↔ name) is done at the router layer via auth_service.

def normalize_assignee_spec(raw: Any) -> Optional[dict]:
    if not raw or not isinstance(raw, dict):
        return None
    kind = raw.get("kind")
    if kind not in ("user_id", "user_email", "from_payload", "role"):
        return None
    out = {"kind": kind}
    for k in ("value", "field"):
        if raw.get(k) is not None:
            out[k] = raw[k]
    return out


def resolve_assignee_spec(spec: dict, payload: dict) -> dict:
    """Resolve a {kind, value/field} spec against a payload. Returns
    {user_id?, user_email?, role?} — partially populated; the router does
    the user-record lookup to fill missing pieces.
    """
    if not spec:
        return {}
    kind = spec.get("kind")
    if kind == "user_id":
        return {"user_id": str(spec.get("value") or "")}
    if kind == "user_email":
        return {"user_email": str(spec.get("value") or "").lower()}
    if kind == "role":
        return {"role": str(spec.get("value") or "")}
    if kind == "from_payload":
        from jsonlogic import _resolve_var as _rv  # type: ignore[attr-defined]
        v = _rv(spec.get("field") or "", payload, default=None)
        if not v:
            return {}
        v_str = str(v)
        if "@" in v_str:
            return {"user_email": v_str.lower()}
        return {"user_id": v_str}
    return {}


# ── Stage selection on propose ───────────────────────────────────────────────

def find_first_active_stage(stages: list[dict], payload: dict) -> Optional[dict]:
    """Walk stages top-to-bottom and return the first whose `when` matches."""
    for s in stages or []:
        if not isinstance(s, dict) or s.get("type") not in VALID_TYPES:
            continue
        if _eval_when(s, payload):
            return s
    return None


def instantiate_for_proposal(
    stages: list[dict],
    payload: dict,
    *,
    requester_user_id: Optional[str],
    requester_email: Optional[str],
) -> dict:
    """Build the initial workflow state for a freshly-proposed action.

    Returns a dict with the columns the caller should write back onto
    ActionExecutionRow:
        current_stage, stage_state, stage_history,
        requester_user_id, requester_email,
        assigned_to_*  (resolved via the first stage's assignee spec)

    If no stage matches, current_stage = TERMINAL_COMPLETED so the row goes
    straight to executed (effectively no approval needed).
    """
    now = datetime.now(timezone.utc)

    # parallel_group sub-stages also get state entries; the head stage's
    # branches list points to their names.
    stages_map = _stages_by_name(stages)
    head = find_first_active_stage(stages, payload)
    if not head:
        return {
            "current_stage": TERMINAL_COMPLETED,
            "stage_state": {},
            "stage_history": [],
            "requester_user_id": requester_user_id,
            "requester_email": requester_email,
            "assignee_spec": None,
        }

    state: dict[str, dict] = {}
    _enter_stage(state, head, stages_map, payload, now)

    return {
        "current_stage": head["name"],
        "stage_state": state,
        "stage_history": [],
        "requester_user_id": requester_user_id,
        "requester_email": requester_email,
        "assignee_spec": normalize_assignee_spec(head.get("assignee")),
        "head_stage": head,
    }


def _enter_stage(
    state: dict,
    stage: dict,
    stages_map: dict,
    payload: dict,
    now: datetime,
) -> None:
    """Mutate `state` to record entry into `stage`."""
    state[stage["name"]] = {
        "entered_at": now.isoformat(),
        "sla_at": _sla_at(stage, now),
        "status": "active",
        "decisions": [],
        "branches": {},
    }
    # parallel_group: open all branches at once
    if stage.get("type") == TYPE_PARALLEL:
        for b in stage.get("branches", []) or []:
            sub = stages_map.get(b)
            if not sub:
                continue
            if not _eval_when(sub, payload):
                # auto-advance branch since its when fails
                state[stage["name"]]["branches"][b] = {"status": "skipped"}
                continue
            _enter_stage(state, sub, stages_map, payload, now)
            state[stage["name"]]["branches"][b] = {"status": "active"}


# ── Decision application ─────────────────────────────────────────────────────

def apply_decision(
    *,
    stages: list[dict],
    current_stage: Optional[str],
    stage_state: Optional[dict],
    stage_history: Optional[list],
    payload: dict,
    options: Optional[list],
    decision: str,
    decided_in_stage: str,
    actor_user_id: Optional[str],
    actor_email: Optional[str],
    note: Optional[str] = None,
    approved_option_ids: Optional[list[str]] = None,
    selected_option_ids: Optional[list[str]] = None,
    payload_diff: Optional[dict] = None,
) -> dict:
    """Apply a decision to the workflow state and return the new state.

    Returns dict ready to write back to the row:
        current_stage, stage_state, stage_history,
        options (possibly pruned), selected_option_ids,
        assignee_spec (next stage's, or None if terminal),
        terminal_status ("completed" | "rejected" | None),
        emitted_events: [...]   # (stage_entered, stage_exited, ...) for notification dispatch
    """
    if not stages:
        raise ValueError("apply_decision called on a non-workflow execution")
    if current_stage in (TERMINAL_COMPLETED, TERMINAL_REJECTED) or current_stage is None:
        raise ValueError(f"Cannot decide — execution already terminal ({current_stage})")
    if decided_in_stage != current_stage and not _is_branch_of(current_stage, decided_in_stage, stages):
        raise ValueError(
            f"Decision targets stage '{decided_in_stage}' but execution is at '{current_stage}'"
        )

    stages_map = _stages_by_name(stages)
    stage_def = stages_map.get(decided_in_stage)
    if not stage_def:
        raise ValueError(f"Stage '{decided_in_stage}' not in template")

    state = dict(stage_state or {})
    history = list(stage_history or [])
    options = list(options or [])
    now = datetime.now(timezone.utc)
    events: list[dict] = []

    decision_record: dict = {
        "stage": decided_in_stage,
        "actor_user_id": actor_user_id,
        "actor_email": actor_email,
        "at": now.isoformat(),
        "decision": decision,
        "note": note or "",
    }
    if approved_option_ids is not None:
        decision_record["approved_option_ids"] = list(approved_option_ids)
    if selected_option_ids is not None:
        decision_record["selected_option_ids"] = list(selected_option_ids)
    if payload_diff:
        decision_record["payload_diff"] = payload_diff
    history.append(decision_record)

    # Mark this stage as concluded with the appropriate status.
    stype = stage_def.get("type")
    branch_status = "approved"  # default optimistic
    pruned_options = options
    final_selected_ids: Optional[list[str]] = None

    if stype == TYPE_APPROVAL:
        if decision == DECISION_APPROVE:
            branch_status = "approved"
        elif decision == DECISION_REJECT:
            branch_status = "rejected"
        else:
            raise ValueError(f"approval stage takes 'approve' or 'reject', got {decision!r}")

    elif stype == TYPE_OPTION_REVIEW:
        if decision == DECISION_REJECT:
            branch_status = "rejected"
        elif decision == DECISION_REVIEW_OPTIONS:
            keep = set(map(str, approved_option_ids or []))
            pruned_options = [o for o in options if str(_option_id(o)) in keep]
            min_approve = int(stage_def.get("min_approve") or 1)
            if len(pruned_options) < min_approve:
                branch_status = "rejected"
            else:
                branch_status = "approved"
        else:
            raise ValueError(f"option_review takes 'review_options' or 'reject', got {decision!r}")

    elif stype == TYPE_OPTION_SELECT:
        if decision == DECISION_REJECT:
            branch_status = "rejected"
        elif decision == DECISION_SELECT_OPTIONS:
            picks = list(map(str, selected_option_ids or []))
            min_select = int(stage_def.get("min_select") or 1)
            max_select = int(stage_def.get("max_select") or 1)
            if not (min_select <= len(picks) <= max_select):
                raise ValueError(
                    f"option_select needs between {min_select} and {max_select} picks, got {len(picks)}"
                )
            valid_ids = {str(_option_id(o)) for o in options}
            for pid in picks:
                if pid not in valid_ids:
                    raise ValueError(f"selected option id {pid!r} is not in the option list")
            final_selected_ids = picks
            branch_status = "approved"
        else:
            raise ValueError(f"option_select takes 'select_options' or 'reject', got {decision!r}")

    elif stype == TYPE_PARALLEL:
        # parallel_group itself isn't decided directly — sub-stages are. The
        # caller resolved decided_in_stage = sub-stage; we land here only if
        # the user mistakenly targeted the group.
        raise ValueError("Cannot decide directly on a parallel_group stage")
    else:
        raise ValueError(f"Unknown stage type {stype!r}")

    state.setdefault(decided_in_stage, {})["status"] = branch_status
    state[decided_in_stage]["decisions"] = state[decided_in_stage].get("decisions", []) + [decision_record]

    events.append({
        "kind": "stage_completed",
        "stage": decided_in_stage,
        "outcome": branch_status,
        "actor_user_id": actor_user_id,
        "actor_email": actor_email,
    })

    # Determine the "effective" stage we just decided in — the one that drives
    # the next-stage routing. For a sub-stage of a parallel_group, that's the
    # parent group (only after all branches done).
    parent_group = _parallel_parent(decided_in_stage, stages)
    next_assignee_spec: Optional[dict] = None
    next_stage_name: Optional[str] = None
    terminal: Optional[str] = None

    if parent_group:
        # Mark this branch in the parent's branches dict.
        pgs = state.setdefault(parent_group["name"], {}).setdefault("branches", {})
        pgs[decided_in_stage] = {"status": branch_status}
        # If any branch rejected, the whole group rejects. Else require all approved.
        branches_state = pgs
        if any(b.get("status") == "rejected" for b in branches_state.values()):
            state[parent_group["name"]]["status"] = "rejected"
            target = parent_group.get("on_reject", TERMINAL_REJECTED)
            next_stage_name, terminal = _route_target(target)
        elif all(b.get("status") in ("approved", "skipped") for b in branches_state.values()) \
                and len(branches_state) == len(parent_group.get("branches") or []):
            state[parent_group["name"]]["status"] = "approved"
            target = parent_group.get("on_approve", TERMINAL_COMPLETED)
            next_stage_name, terminal = _route_target(target)
        else:
            # other branches still active — execution remains at parent group
            return _final_pack(
                current_stage=parent_group["name"],
                stage_state=state,
                stage_history=history,
                options=pruned_options if pruned_options is not options else options,
                selected_option_ids=final_selected_ids,
                assignee_spec=None,
                terminal_status=None,
                events=events,
            )
    else:
        # Single stage decided — route via its on_approve / on_reject.
        if branch_status == "approved":
            target = stage_def.get("on_approve", TERMINAL_COMPLETED)
        else:
            target = stage_def.get("on_reject", TERMINAL_REJECTED)
        next_stage_name, terminal = _route_target(target)

    # If next route is a stage name, make sure its `when` actually matches and
    # walk forward through any auto-skipped stages (when=false → next).
    payload_for_eval = {**payload}
    if pruned_options is not options:
        # later stages can predicate on the surviving options
        payload_for_eval["__surviving_options__"] = pruned_options
    while next_stage_name and not terminal:
        nxt = stages_map.get(next_stage_name)
        if not nxt:
            terminal = TERMINAL_COMPLETED
            break
        if not _eval_when(nxt, payload_for_eval):
            # auto-skip; treat as approve and follow on_approve
            target = nxt.get("on_approve", TERMINAL_COMPLETED)
            next_stage_name, terminal = _route_target(target)
            continue
        # enter it for real
        _enter_stage(state, nxt, stages_map, payload_for_eval, now)
        next_assignee_spec = normalize_assignee_spec(nxt.get("assignee"))
        events.append({"kind": "stage_entered", "stage": nxt["name"]})
        return _final_pack(
            current_stage=nxt["name"],
            stage_state=state,
            stage_history=history,
            options=pruned_options if pruned_options is not options else options,
            selected_option_ids=final_selected_ids,
            assignee_spec=next_assignee_spec,
            terminal_status=None,
            events=events,
        )

    # Terminal
    return _final_pack(
        current_stage=terminal or TERMINAL_COMPLETED,
        stage_state=state,
        stage_history=history,
        options=pruned_options if pruned_options is not options else options,
        selected_option_ids=final_selected_ids,
        assignee_spec=None,
        terminal_status=terminal or TERMINAL_COMPLETED,
        events=events,
    )


def _final_pack(**kwargs: Any) -> dict:
    return kwargs


def _option_id(opt: Any) -> str:
    """Identify an option in the payload — uses `id` if present, else a stable
    derived key (vendor+source_url) so the engine doesn't need callers to set ids."""
    if not isinstance(opt, dict):
        return str(opt)
    if opt.get("id"):
        return str(opt["id"])
    if opt.get("option_id"):
        return str(opt["option_id"])
    parts = [str(opt.get("vendor") or ""), str(opt.get("source_url") or ""), str(opt.get("unit_price") or "")]
    return "|".join(parts)


def _route_target(target: Any) -> tuple[Optional[str], Optional[str]]:
    """Normalize an on_approve/on_reject target. Returns (next_stage_name, terminal)."""
    if not target:
        return None, TERMINAL_COMPLETED
    if target in (TERMINAL_COMPLETED, TERMINAL_REJECTED):
        return None, target
    return str(target), None


def _is_branch_of(current_stage: str, decided_in_stage: str, stages: list[dict]) -> bool:
    """True iff decided_in_stage is a branch of a parallel_group whose name is current_stage."""
    parent = _parallel_parent(decided_in_stage, stages)
    return parent is not None and parent.get("name") == current_stage


def _parallel_parent(stage_name: str, stages: list[dict]) -> Optional[dict]:
    for s in stages or []:
        if s.get("type") == TYPE_PARALLEL and stage_name in (s.get("branches") or []):
            return s
    return None


# ── SLA tick ─────────────────────────────────────────────────────────────────

def find_timed_out_stages(state: dict, stages: list[dict], now: datetime) -> list[dict]:
    """Return [{stage_name, on_timeout}] for every active sub-state past its sla_at."""
    if not state:
        return []
    stages_map = _stages_by_name(stages)
    out = []
    for name, st in state.items():
        if not isinstance(st, dict):
            continue
        if st.get("status") != "active":
            continue
        sla = st.get("sla_at")
        if not sla:
            continue
        try:
            if datetime.fromisoformat(sla.replace("Z", "+00:00")) <= now:
                stage_def = stages_map.get(name) or {}
                on_to = stage_def.get("on_timeout") or {"action": "reject"}
                out.append({"stage_name": name, "on_timeout": on_to})
        except (ValueError, AttributeError):
            continue
    return out
