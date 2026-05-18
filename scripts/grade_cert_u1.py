"""
Auto-grader for Course U1 (Nexus 101) — both lab and practical exam.

Lab mode (default):
    python3 scripts/grade_cert_u1.py \
        --tenant tenant-learn-jose \
        --vendor <vendor-id> \
        --history <action-history-id> \
        --candidate jose

Exam mode:
    python3 scripts/grade_cert_u1.py --exam \
        --tenant tenant-learn-exam-jose \
        --po <po-id> \
        --vendor-name "ACME Supply Co." \
        --candidate jose

The grader queries the candidate's tenant via the Ontology API and compares the
observed state against either:
  - Lab: minimal state checks (3 object types, a note added).
  - Exam: the fixture written by `seed_tenant_learn.py --candidate <x> --exam`.

Exits 0 on pass, 1 on fail. Prints a per-task report.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

ONTOLOGY_API = os.environ.get("ONTOLOGY_API", "http://localhost:8004")
EXAM_FIXTURE_DIR = "/tmp"


# ── HTTP helper ──────────────────────────────────────────────────────────────

def req(method: str, url: str, *, tenant: str, body: Any = None, timeout: int = 30) -> Any:
    h = {"Content-Type": "application/json", "x-tenant-id": tenant}
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        body_txt = e.read().decode("utf-8", "replace")[:300]
        raise RuntimeError(f"{method} {url} → {e.code}: {body_txt}") from e


# ── Report rendering ─────────────────────────────────────────────────────────

class Report:
    def __init__(self, candidate: str, mode: str) -> None:
        self.candidate = candidate
        self.mode = mode
        self.results: list[tuple[str, bool, str]] = []

    def check(self, label: str, ok: bool, detail: str = "") -> None:
        self.results.append((label, ok, detail))

    def render(self, pass_threshold: int) -> bool:
        print()
        print(f"=== U1 {self.mode} grade — {self.candidate} ===")
        passed = 0
        for label, ok, detail in self.results:
            mark = "PASS" if ok else "FAIL"
            print(f"  [{mark}] {label}" + (f"  ({detail})" if detail else ""))
            if ok:
                passed += 1
        total = len(self.results)
        overall = passed >= pass_threshold
        print()
        print(f"  Score: {passed}/{total}  (need {pass_threshold} to pass)")
        print(f"  Result: {'PASS' if overall else 'FAIL'}")
        return overall


# ── Shared queries ───────────────────────────────────────────────────────────

def list_object_types(tenant: str) -> list[dict]:
    return req("GET", f"{ONTOLOGY_API}/object-types", tenant=tenant) or []


def get_vendor(tenant: str, vendor_ot_id: str, vendor_id: str) -> dict | None:
    try:
        return req("GET",
                   f"{ONTOLOGY_API}/object-types/{vendor_ot_id}/records/{vendor_id}",
                   tenant=tenant)
    except RuntimeError:
        return None


def list_action_history(tenant: str, action_name: str = "addNote") -> list[dict]:
    """Return recent action executions for the named action."""
    try:
        return req("GET",
                   f"{ONTOLOGY_API}/actions/{action_name}/executions",
                   tenant=tenant) or []
    except RuntimeError:
        return []


# ── Lab grading ──────────────────────────────────────────────────────────────

def grade_lab(args: argparse.Namespace) -> bool:
    r = Report(args.candidate, mode="LAB")

    # 1. Tenant exists & responds
    try:
        ots = list_object_types(args.tenant)
        r.check("tenant reachable", True, f"{len(ots)} object types")
    except RuntimeError as e:
        r.check("tenant reachable", False, str(e))
        return r.render(pass_threshold=3)

    # 2. Three expected object types present
    names = {ot.get("name") for ot in ots}
    have_all = {"Vendor", "PurchaseOrder", "LineItem"}.issubset(names)
    r.check("Vendor + PurchaseOrder + LineItem object types exist", have_all,
            f"found: {sorted(names)}")

    # 3. Vendor record exists and matches submitted ID
    vendor_ot = next((ot for ot in ots if ot.get("name") == "Vendor"), None)
    vendor = get_vendor(args.tenant, vendor_ot["id"], args.vendor) if vendor_ot else None
    r.check("submitted vendor exists",
            vendor is not None,
            f"id={args.vendor}")

    # 4. Action history entry for addNote on that vendor, with the right text
    recent = list_action_history(args.tenant, "addNote")
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    matching = [
        ex for ex in recent
        if ex.get("inputs", {}).get("vendor_id") == args.vendor
        and str(ex.get("inputs", {}).get("text", "")).startswith(f"cert-u1-{args.candidate}")
    ]
    r.check("addNote with text cert-u1-<candidate> on submitted vendor",
            len(matching) > 0,
            f"{len(matching)} matching execution(s)")

    # 5. History entry ID submitted matches a real execution
    if args.history:
        matched_id = any(ex.get("id") == args.history for ex in matching)
        r.check("submitted history-entry ID matches", matched_id,
                f"id={args.history}")

    return r.render(pass_threshold=4)


# ── Exam grading ─────────────────────────────────────────────────────────────

def load_exam_fixture(tenant: str) -> dict:
    path = f"{EXAM_FIXTURE_DIR}/{tenant}.exam-fixture.json"
    try:
        with open(path) as f:
            return json.load(f)
    except FileNotFoundError:
        sys.exit(f"Exam fixture not found at {path}. "
                 f"Re-run seed_tenant_learn.py --candidate <name> --exam")


def grade_exam(args: argparse.Namespace) -> bool:
    r = Report(args.candidate, mode="EXAM")
    fixture = load_exam_fixture(args.tenant)

    # 1. Tenant ID match
    r.check("tenant ID matches assigned exam tenant",
            args.tenant == fixture["tenant"],
            f"got {args.tenant}, fixture {fixture['tenant']}")

    # 2. PO ID matches canonical 3rd-most-recent
    r.check("third-most-recent PO ID correct",
            args.po == fixture["po_id"],
            f"got {args.po}, expected {fixture['po_id']}")

    # 3. Vendor name matches
    r.check("vendor name matches",
            args.vendor_name.strip() == fixture["vendor_name"],
            f"got '{args.vendor_name}', expected '{fixture['vendor_name']}'")

    # 4. addNote with exactly 'exam-u1' on correct vendor in last 30 min
    recent = list_action_history(args.tenant, "addNote")
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
    matching = []
    for ex in recent:
        if ex.get("inputs", {}).get("vendor_id") != fixture["vendor_id"]:
            continue
        if ex.get("inputs", {}).get("text") != "exam-u1":
            continue
        ts_raw = ex.get("created_at") or ex.get("executed_at") or ""
        try:
            ts = datetime.fromisoformat(ts_raw.replace("Z", "+00:00"))
            if ts < cutoff:
                continue
        except (ValueError, TypeError):
            continue
        matching.append(ex)

    r.check("addNote 'exam-u1' on correct vendor in last 30 min",
            len(matching) > 0,
            f"{len(matching)} matching execution(s)")

    return r.render(pass_threshold=3)


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", required=True, help="Candidate's tenant ID")
    ap.add_argument("--candidate", required=True, help="Candidate name/handle")
    ap.add_argument("--exam", action="store_true", help="Grade as exam (uses /tmp fixture)")

    # Lab args
    ap.add_argument("--vendor", help="(lab) Submitted vendor object ID")
    ap.add_argument("--history", help="(lab) Submitted action-history entry ID")

    # Exam args
    ap.add_argument("--po", help="(exam) Submitted PO object ID")
    ap.add_argument("--vendor-name", help="(exam) Submitted vendor name")

    args = ap.parse_args()

    if args.exam:
        for f in ("po", "vendor_name"):
            if not getattr(args, f):
                ap.error(f"--{f.replace('_', '-')} required in exam mode")
        ok = grade_exam(args)
    else:
        if not args.vendor:
            ap.error("--vendor required in lab mode")
        ok = grade_lab(args)

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
