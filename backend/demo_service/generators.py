"""
Deterministic data generators for each BPI Challenge / demo dataset.

All generators use a seeded RNG so data is stable across requests.
Each generator yields dicts that look like real event-log rows.
"""

import random
import hashlib
from datetime import datetime, timedelta
from typing import Generator

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _seed(name: str) -> random.Random:
    return random.Random(hashlib.md5(name.encode()).hexdigest())


def _ts(rng: random.Random, base: datetime, max_days: int) -> str:
    delta = timedelta(
        days=rng.randint(0, max_days),
        hours=rng.randint(0, 23),
        minutes=rng.randint(0, 59),
        seconds=rng.randint(0, 59),
    )
    return (base + delta).isoformat() + "Z"


def _pick(rng: random.Random, items: list, weights: list | None = None):
    if weights:
        return rng.choices(items, weights=weights, k=1)[0]
    return rng.choice(items)


# ═══════════════════════════════════════════════════════════════════════════
# 1. BPIC 2012 — Loan Application (Dutch Bank)
# ═══════════════════════════════════════════════════════════════════════════

BPIC2012_ACTIVITIES = [
    "A_SUBMITTED", "A_PARTLYSUBMITTED", "A_PREACCEPTED", "A_ACCEPTED",
    "A_FINALIZED", "A_CANCELLED", "A_DECLINED", "A_APPROVED",
    "W_Completeren aanvraag", "W_Nabellen offertes", "W_Valideren aanvraag",
    "W_Nabellen incomplete dossiers", "W_Beoordelen fraude",
    "W_Wijzigen contractgegevens", "O_CREATED", "O_SENT", "O_SENT_BACK",
    "O_ACCEPTED", "O_CANCELLED", "O_DECLINED",
]

BPIC2012_PATHS = [
    # Happy path (~20%)
    ["A_SUBMITTED", "A_PARTLYSUBMITTED", "A_PREACCEPTED", "W_Completeren aanvraag",
     "W_Valideren aanvraag", "A_ACCEPTED", "O_CREATED", "O_SENT", "O_ACCEPTED", "A_FINALIZED"],
    # Declined (~15%)
    ["A_SUBMITTED", "A_PARTLYSUBMITTED", "A_PREACCEPTED", "W_Completeren aanvraag",
     "W_Beoordelen fraude", "A_DECLINED"],
    # Cancelled (~10%)
    ["A_SUBMITTED", "A_PARTLYSUBMITTED", "A_CANCELLED"],
    # Rework loop (~25%)
    ["A_SUBMITTED", "A_PARTLYSUBMITTED", "A_PREACCEPTED", "W_Completeren aanvraag",
     "W_Nabellen incomplete dossiers", "W_Completeren aanvraag", "W_Valideren aanvraag",
     "A_ACCEPTED", "O_CREATED", "O_SENT", "O_ACCEPTED", "A_FINALIZED"],
    # Offer declined (~15%)
    ["A_SUBMITTED", "A_PARTLYSUBMITTED", "A_PREACCEPTED", "W_Completeren aanvraag",
     "W_Valideren aanvraag", "A_ACCEPTED", "O_CREATED", "O_SENT", "O_DECLINED"],
    # Extended rework (~15%)
    ["A_SUBMITTED", "A_PARTLYSUBMITTED", "A_PREACCEPTED", "W_Completeren aanvraag",
     "W_Nabellen offertes", "W_Nabellen incomplete dossiers", "W_Completeren aanvraag",
     "W_Wijzigen contractgegevens", "A_ACCEPTED", "O_CREATED", "O_SENT", "O_SENT_BACK",
     "O_SENT", "O_ACCEPTED", "A_FINALIZED"],
]

BPIC2012_PATH_WEIGHTS = [20, 15, 10, 25, 15, 15]

BPIC2012_RESOURCES = [f"R{i:05d}" for i in range(112001, 112090)]

def generate_bpic2012(n_cases: int = 3000) -> list[dict]:
    rng = _seed("bpic2012")
    base = datetime(2011, 10, 1)
    rows = []
    for i in range(n_cases):
        case_id = str(173688 + i)
        amount = rng.choice([5000, 7500, 10000, 15000, 20000, 25000, 30000, 35000, 50000, 75000])
        path = _pick(rng, BPIC2012_PATHS, BPIC2012_PATH_WEIGHTS)
        t = base + timedelta(days=rng.randint(0, 180))
        for activity in path:
            t += timedelta(hours=rng.randint(1, 72), minutes=rng.randint(0, 59))
            for lifecycle in (["SCHEDULE", "START", "COMPLETE"] if activity.startswith("W_") else ["COMPLETE"]):
                rows.append({
                    "case_id": case_id,
                    "activity": activity,
                    "timestamp": t.isoformat() + "Z",
                    "lifecycle": lifecycle,
                    "resource": _pick(rng, BPIC2012_RESOURCES),
                    "amount_requested": amount,
                    "reg_date": (base + timedelta(days=rng.randint(0, 60))).strftime("%Y-%m-%d"),
                })
                t += timedelta(seconds=rng.randint(30, 300))
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 2. BPIC 2017 — Loan Application V2 (Richer)
# ═══════════════════════════════════════════════════════════════════════════

BPIC2017_APP_TYPES = ["New credit", "Limit raise", "Existing customer"]
BPIC2017_LOAN_GOALS = ["Home improvement", "Car purchase", "Debt consolidation",
                       "Education", "Business investment", "Other"]
BPIC2017_ORIGINS = ["Application", "Offer", "Workflow"]

def generate_bpic2017(n_cases: int = 3000) -> list[dict]:
    rng = _seed("bpic2017")
    base = datetime(2016, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"Application_{746800 + i}"
        app_type = _pick(rng, BPIC2017_APP_TYPES, [50, 30, 20])
        goal = _pick(rng, BPIC2017_LOAN_GOALS, [25, 20, 15, 10, 15, 15])
        amount = rng.choice([5000, 10000, 15000, 20000, 30000, 50000, 75000, 100000])
        credit_score = rng.randint(400, 850)
        terms = rng.choice([12, 24, 36, 48, 60, 84, 120])
        accepted = credit_score > 580 and rng.random() > 0.3
        n_offers = rng.randint(1, 4) if accepted else rng.randint(0, 2)

        path = _pick(rng, BPIC2012_PATHS, BPIC2012_PATH_WEIGHTS)
        t = base + timedelta(days=rng.randint(0, 350))
        for activity in path:
            t += timedelta(hours=rng.randint(1, 48))
            origin = ("Offer" if activity.startswith("O_") else
                      "Workflow" if activity.startswith("W_") else "Application")
            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "resource": _pick(rng, BPIC2012_RESOURCES),
                "application_type": app_type,
                "loan_goal": goal,
                "requested_amount": amount,
                "credit_score": credit_score,
                "number_of_terms": terms,
                "accepted": accepted,
                "number_of_offers": n_offers,
                "event_origin": origin,
                "offer_id": f"Offer_{rng.randint(100000, 999999)}" if origin == "Offer" else None,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 3. BPIC 2019 — SAP Purchase Orders
# ═══════════════════════════════════════════════════════════════════════════

BPIC2019_ACTIVITIES = [
    "Create Purchase Order Item", "Record Goods Receipt",
    "Record Invoice Receipt", "Clear Invoice", "Record Payment",
    "Change Quantity", "Change Price", "Vendor creates invoice",
    "Vendor creates debit memo", "Cancel Goods Receipt",
    "Remove Payment Block", "Set Payment Block",
    "Change Approval for Purchase Order", "SRM: Created",
    "SRM: Change was Transmitted", "SRM: Awaiting Approval",
    "SRM: Document Completed", "SRM: In Transfer to Execution Syst.",
    "Delete Purchase Order Item",
]

BPIC2019_PATHS = [
    ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt",
     "Clear Invoice", "Record Payment"],
    ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt",
     "Set Payment Block", "Remove Payment Block", "Clear Invoice", "Record Payment"],
    ["Create Purchase Order Item", "Change Quantity", "Record Goods Receipt",
     "Vendor creates invoice", "Record Invoice Receipt", "Clear Invoice", "Record Payment"],
    ["Create Purchase Order Item", "SRM: Created", "SRM: Awaiting Approval",
     "SRM: Change was Transmitted", "Record Goods Receipt", "Record Invoice Receipt",
     "Clear Invoice", "Record Payment"],
    ["Create Purchase Order Item", "Record Goods Receipt", "Record Invoice Receipt",
     "Change Price", "Clear Invoice", "Record Payment"],
    ["Create Purchase Order Item", "Delete Purchase Order Item"],
]

BPIC2019_PATH_WEIGHTS = [30, 15, 15, 15, 15, 10]

BPIC2019_VENDORS = [f"V-{i:06d}" for i in range(1000, 1080)]
BPIC2019_ITEM_CATS = ["Standard", "Consignment", "Subcontracting", "Third-party", "Stock transfer"]
BPIC2019_DOC_TYPES = ["Standard PO", "Framework Order", "Scheduling Agreement", "Service PO"]
BPIC2019_COMPANIES = ["Company_1000", "Company_2000", "Company_3000", "Company_4000"]
BPIC2019_SPEND_AREAS = ["IT Infrastructure", "Office Supplies", "Raw Materials",
                         "Professional Services", "Logistics", "Maintenance",
                         "Marketing", "Facilities"]

def generate_bpic2019(n_cases: int = 5000) -> list[dict]:
    rng = _seed("bpic2019")
    base = datetime(2018, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"PO-{4500000 + i}"
        vendor = _pick(rng, BPIC2019_VENDORS)
        item_cat = _pick(rng, BPIC2019_ITEM_CATS, [50, 15, 10, 15, 10])
        doc_type = _pick(rng, BPIC2019_DOC_TYPES, [50, 25, 15, 10])
        company = _pick(rng, BPIC2019_COMPANIES)
        spend_area = _pick(rng, BPIC2019_SPEND_AREAS)
        net_worth = round(rng.uniform(50, 250000), 2)
        goods_receipt = rng.random() > 0.15

        path = _pick(rng, BPIC2019_PATHS, BPIC2019_PATH_WEIGHTS)
        t = base + timedelta(days=rng.randint(0, 360))
        for activity in path:
            t += timedelta(days=rng.randint(0, 14), hours=rng.randint(0, 23))
            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "resource": f"user_{rng.randint(1, 200):03d}",
                "purchasing_document": case_id,
                "vendor": vendor,
                "item_category": item_cat,
                "item_type": item_cat,
                "document_type": doc_type,
                "company": company,
                "spend_area": spend_area,
                "cumulative_net_worth_eur": net_worth,
                "goods_receipt": goods_receipt,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 4. BPIC 2011 — Hospital Gynaecology
# ═══════════════════════════════════════════════════════════════════════════

BPIC2011_ACTIVITIES = [
    "administratief tarief - Loss blood panel", "TEE", "Assumption laboratory",
    "bloedafname - Loss blood", "Histologisch onderzoek - Loss blood panel",
    "rontgen thorax", "administratief tarief", "Echografie",
    "administratief tarief verpleegdag kliniek", "CT abdomen",
    "MRI", "Behandeling operatiekamer", "Consult gynaecologie",
    "Intake eerste consult", "Laboratorium hematologie",
    "Pathologisch onderzoek", "Verpleging kliniek",
    "Ontslag", "Operatie gynaecologisch", "Chemotherapie",
    "Bestraling", "Controle consult", "Polikliniekbezoek",
    "Opname", "Spoedconsult", "IC opname",
]

BPIC2011_DIAGNOSES = [
    "M8010/3", "M8140/3", "M8380/3", "M8441/3", "M8461/3",
    "M8000/3", "M8070/3", "M9110/3", "M8480/3", "M8560/3",
]

BPIC2011_GROUPS = [
    "Gynaecologie", "Radiologie", "Pathologie", "Laboratorium",
    "Verpleging", "Chirurgie", "IC", "Oncologie",
]

def generate_bpic2011(n_cases: int = 1000) -> list[dict]:
    rng = _seed("bpic2011")
    base = datetime(2005, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = str(523000 + i)
        diagnosis = _pick(rng, BPIC2011_DIAGNOSES)
        diag_code = rng.randint(100, 999)
        spec_code = rng.choice([24, 61, 86, 85, 65])
        age = rng.randint(18, 92)
        treatment_code = rng.randint(1, 15)
        n_events = rng.randint(20, 200)

        t = base + timedelta(days=rng.randint(0, 2000))
        for _ in range(n_events):
            t += timedelta(hours=rng.randint(1, 72))
            activity = _pick(rng, BPIC2011_ACTIVITIES)
            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "org_group": _pick(rng, BPIC2011_GROUPS),
                "diagnosis": diagnosis,
                "diagnosis_code": diag_code,
                "treatment_code": treatment_code,
                "specialism_code": spec_code,
                "age": age,
                "activity_code": rng.randint(300000, 399999),
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 5. BPIC 2014 — Rabobank ITIL (Incidents)
# ═══════════════════════════════════════════════════════════════════════════

BPIC2014_ACTIVITIES = [
    "Accepted", "Completed", "Queued", "Assignment",
    "In Progress", "Awaiting User Info", "Closed",
    "Operator Update", "Reassignment", "Resolved",
    "Updated", "Escalated",
]

BPIC2014_GROUPS = [
    "S DBA Team", "S Linux Team", "S Windows Team",
    "S Network Team", "S Application Team", "S Middleware Team",
    "S ServiceDesk", "S Security Team", "S Storage Team",
    "N Batch Processing", "N Hosting Services",
]

BPIC2014_CHANGE_TYPES = ["Normal", "Standard", "Emergency"]
BPIC2014_RISK = ["Low", "Medium", "High", "Critical"]
BPIC2014_CI_NAMES = [f"CI_{rng_val:06d}" for rng_val in range(100, 160)]

def generate_bpic2014_incidents(n_cases: int = 3000) -> list[dict]:
    rng = _seed("bpic2014inc")
    base = datetime(2013, 1, 1)
    rows = []
    for i in range(n_cases):
        inc_id = f"IM{1000000 + i}"
        interaction_id = f"SD{2000000 + i}"
        n_events = rng.randint(3, 15)
        group = _pick(rng, BPIC2014_GROUPS)

        t = base + timedelta(days=rng.randint(0, 365))
        for j in range(n_events):
            if j == 0:
                act = "Accepted"
            elif j == n_events - 1:
                act = "Closed"
            else:
                act = _pick(rng, BPIC2014_ACTIVITIES)
            t += timedelta(hours=rng.randint(1, 48))
            if act == "Reassignment":
                group = _pick(rng, BPIC2014_GROUPS)
            rows.append({
                "incident_id": inc_id,
                "activity": act,
                "timestamp": t.isoformat() + "Z",
                "assignment_group": group,
                "interaction_id": interaction_id,
                "km_number": f"KM{rng.randint(100000, 999999)}" if rng.random() > 0.7 else None,
            })
    return rows


def generate_bpic2014_changes(n_cases: int = 1500) -> list[dict]:
    rng = _seed("bpic2014chg")
    base = datetime(2013, 1, 1)
    rows = []
    for i in range(n_cases):
        change_id = f"C{3000000 + i}"
        change_type = _pick(rng, BPIC2014_CHANGE_TYPES, [60, 30, 10])
        risk = _pick(rng, BPIC2014_RISK, [40, 35, 20, 5])
        ci = _pick(rng, BPIC2014_CI_NAMES)

        for status in ["New", "Scheduled", "Implementation", "Testing", "Closed"]:
            base_t = base + timedelta(days=rng.randint(0, 365))
            rows.append({
                "change_id": change_id,
                "activity": status,
                "timestamp": (base_t + timedelta(days=rng.randint(0, 30))).isoformat() + "Z",
                "change_type": change_type,
                "risk_assessment": risk,
                "ci_name": ci,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 6. Road Traffic Fines
# ═══════════════════════════════════════════════════════════════════════════

TRAFFIC_ACTIVITIES = [
    "Create Fine", "Send Fine", "Insert Fine Notification",
    "Add penalty", "Payment", "Send for Credit Collection",
    "Insert Date Appeal to Prefecture", "Send Appeal to Prefecture",
    "Receive Result Appeal from Prefecture", "Notify Result Appeal to Offender",
]

TRAFFIC_PATHS = [
    # Direct payment (53%)
    ["Create Fine", "Send Fine", "Payment"],
    # Penalty then payment (18%)
    ["Create Fine", "Send Fine", "Insert Fine Notification", "Add penalty", "Payment"],
    # Credit collection (12%)
    ["Create Fine", "Send Fine", "Insert Fine Notification", "Add penalty",
     "Add penalty", "Send for Credit Collection"],
    # Appeal accepted (4%)
    ["Create Fine", "Send Fine", "Insert Date Appeal to Prefecture",
     "Send Appeal to Prefecture", "Receive Result Appeal from Prefecture",
     "Notify Result Appeal to Offender"],
    # Appeal rejected then pay (5%)
    ["Create Fine", "Send Fine", "Insert Date Appeal to Prefecture",
     "Send Appeal to Prefecture", "Receive Result Appeal from Prefecture",
     "Notify Result Appeal to Offender", "Payment"],
    # Penalty cascade (8%)
    ["Create Fine", "Send Fine", "Insert Fine Notification", "Add penalty",
     "Insert Fine Notification", "Add penalty", "Add penalty", "Payment"],
]

TRAFFIC_PATH_WEIGHTS = [53, 18, 12, 4, 5, 8]

TRAFFIC_VEHICLE_CLASSES = ["A", "C", "M", "B", "E"]
TRAFFIC_ARTICLES = [
    "157/1", "157/5", "157/6", "158/1", "158/2",
    "141/1", "142/1", "146/3", "148/1", "155/1",
    "7/1", "7/2", "14/1", "80/1", "105/3",
]

def generate_traffic_fines(n_cases: int = 5000) -> list[dict]:
    rng = _seed("traffic")
    base = datetime(2000, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = str(100000 + i)
        amount = _pick(rng, [35, 50, 70, 100, 120, 150, 200, 300, 500])
        vehicle = _pick(rng, TRAFFIC_VEHICLE_CLASSES, [70, 10, 8, 7, 5])
        article = _pick(rng, TRAFFIC_ARTICLES)
        points = rng.choice([0, 0, 0, 1, 2, 3, 5])
        notif = _pick(rng, ["P", "M", "R"], [60, 30, 10])

        path = _pick(rng, TRAFFIC_PATHS, TRAFFIC_PATH_WEIGHTS)
        t = base + timedelta(days=rng.randint(0, 4500))
        total_paid = 0
        for activity in path:
            t += timedelta(days=rng.randint(1, 90), hours=rng.randint(0, 23))
            penalty_amount = 0
            payment_amount = 0
            if activity == "Add penalty":
                penalty_amount = round(amount * 0.5, 2)
                amount += penalty_amount
            if activity == "Payment":
                payment_amount = amount
                total_paid += payment_amount
            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "resource": str(rng.randint(500, 600)),
                "amount": amount,
                "total_payment_amount": total_paid if activity == "Payment" else 0,
                "vehicle_class": vehicle,
                "article": article,
                "points": points,
                "notification_type": notif,
                "dismissal": activity == "Notify Result Appeal to Offender" and rng.random() > 0.5,
                "payment_amount": payment_amount,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 7. BPIC 2015 — Building Permits (5 municipalities)
# ═══════════════════════════════════════════════════════════════════════════

BPIC2015_ACTIVITIES = [
    "01_HOOFD_010", "01_HOOFD_015", "01_HOOFD_020", "01_HOOFD_030",
    "01_HOOFD_040", "01_HOOFD_050", "01_HOOFD_065", "01_HOOFD_100",
    "01_HOOFD_110", "01_HOOFD_120", "01_HOOFD_130",
    "02_LHEE_010", "02_LHEE_020", "02_LHEE_030",
    "03_GBH_005", "03_GBH_010", "03_GBH_015",
    "04_BPT_005", "04_BPT_010", "04_BPT_020",
    "05_EIND_010", "05_EIND_020", "08_AWB_010", "08_AWB_020",
]

BPIC2015_ACTORS = ["Afd. Bouw en Milieu", "Afd. Publiekszaken", "Bezwaarcommissie",
                    "College B&W", "Secretaris", "Inspecteur"]

def generate_bpic2015(municipality: int = 1, n_cases: int = 200) -> list[dict]:
    rng = _seed(f"bpic2015_m{municipality}")
    base = datetime(2010, 1, 1)
    rows = []
    speed_factor = 1.0 + (municipality - 1) * 0.3  # M5 is slowest
    for i in range(n_cases):
        case_id = f"M{municipality}-{30000 + i}"
        fees = round(rng.uniform(100, 50000), 2)
        parts = rng.randint(1, 8)
        n_steps = rng.randint(5, 18)
        actor = _pick(rng, BPIC2015_ACTORS)

        activities = rng.sample(BPIC2015_ACTIVITIES, min(n_steps, len(BPIC2015_ACTIVITIES)))
        activities.sort()
        t = base + timedelta(days=rng.randint(0, 1400))
        for act in activities:
            t += timedelta(days=int(rng.randint(5, 60) * speed_factor))
            rows.append({
                "case_id": case_id,
                "activity": act,
                "timestamp": t.isoformat() + "Z",
                "resource": _pick(rng, BPIC2015_ACTORS),
                "responsible_actor": actor,
                "sum_fees": fees,
                "parts": parts,
                "municipality": f"Municipality_{municipality}",
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 8. Sepsis Cases — ICU
# ═══════════════════════════════════════════════════════════════════════════

SEPSIS_ACTIVITIES = [
    "ER Registration", "ER Triage", "ER Sepsis Triage",
    "Leucocytes", "CRP", "LacticAcid",
    "IV Liquid", "IV Antibiotics", "Admission NC", "Admission IC",
    "Release A", "Release B", "Release C", "Release D", "Release E",
    "Return ER",
]

SEPSIS_PATHS = [
    # Standard ER → Lab → Treatment → Release (40%)
    ["ER Registration", "ER Triage", "ER Sepsis Triage", "Leucocytes", "CRP",
     "LacticAcid", "IV Liquid", "IV Antibiotics", "Admission NC", "Release A"],
    # ICU admission (20%)
    ["ER Registration", "ER Triage", "ER Sepsis Triage", "Leucocytes", "CRP",
     "LacticAcid", "IV Liquid", "IV Antibiotics", "Admission IC",
     "Leucocytes", "CRP", "Release B"],
    # Quick release (15%)
    ["ER Registration", "ER Triage", "Leucocytes", "CRP", "IV Liquid", "Release C"],
    # Readmission (10%)
    ["ER Registration", "ER Triage", "ER Sepsis Triage", "Leucocytes", "CRP",
     "IV Antibiotics", "Admission NC", "Release D", "Return ER",
     "Leucocytes", "CRP", "Admission IC", "Release E"],
    # Lab-heavy (15%)
    ["ER Registration", "ER Triage", "ER Sepsis Triage",
     "Leucocytes", "CRP", "LacticAcid", "Leucocytes", "CRP",
     "IV Liquid", "IV Antibiotics", "Leucocytes", "CRP", "LacticAcid",
     "Admission NC", "Release A"],
]

SEPSIS_PATH_WEIGHTS = [40, 20, 15, 10, 15]

SEPSIS_DIAGNOSES = ["A", "B", "C", "D", "E", "F", "G", "Y", "Z"]
SEPSIS_GROUPS = ["ER", "General Ward", "IC", "Respiratory"]

def generate_sepsis(n_cases: int = 1000) -> list[dict]:
    rng = _seed("sepsis")
    base = datetime(2013, 11, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"SEP-{1000 + i}"
        age = rng.randint(20, 95)
        diagnosis = _pick(rng, SEPSIS_DIAGNOSES)
        infection_suspected = rng.random() > 0.25

        path = _pick(rng, SEPSIS_PATHS, SEPSIS_PATH_WEIGHTS)
        t = base + timedelta(days=rng.randint(0, 500))
        base_leuco = rng.uniform(3.0, 25.0)
        base_crp = rng.uniform(5, 350)
        base_lactic = rng.uniform(0.5, 6.0)

        for activity in path:
            t += timedelta(hours=rng.randint(1, 24))
            leuco = round(base_leuco + rng.uniform(-3, 3), 1) if activity == "Leucocytes" else None
            crp = round(base_crp + rng.uniform(-20, 20), 1) if activity == "CRP" else None
            lactic = round(base_lactic + rng.uniform(-0.5, 0.5), 2) if activity == "LacticAcid" else None

            group = ("ER" if "ER" in activity else
                     "IC" if "IC" in activity or "Admission IC" in activity else
                     "General Ward")
            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "org_group": group,
                "diagnosis": diagnosis,
                "age": age,
                "infection_suspected": infection_suspected,
                "leucocytes": leuco,
                "crp": crp,
                "lactic_acid": lactic,
                "sirs_criteria_met": infection_suspected and rng.random() > 0.3,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 9. Smart Factory IoT
# ═══════════════════════════════════════════════════════════════════════════

FACTORY_ACTIVITIES = [
    "Raw Material Intake", "Cutting", "Welding", "Assembly",
    "QA Inspection", "Rework", "Painting", "Packing", "Shipping",
]

FACTORY_PATHS = [
    # Standard (60%)
    ["Raw Material Intake", "Cutting", "Welding", "Assembly",
     "QA Inspection", "Painting", "Packing", "Shipping"],
    # QA fail + rework (25%)
    ["Raw Material Intake", "Cutting", "Welding", "Assembly",
     "QA Inspection", "Rework", "QA Inspection", "Painting", "Packing", "Shipping"],
    # Skip welding (10%)
    ["Raw Material Intake", "Cutting", "Assembly",
     "QA Inspection", "Painting", "Packing", "Shipping"],
    # Double rework (5%)
    ["Raw Material Intake", "Cutting", "Welding", "Assembly",
     "QA Inspection", "Rework", "QA Inspection", "Rework",
     "QA Inspection", "Painting", "Packing", "Shipping"],
]

FACTORY_PATH_WEIGHTS = [60, 25, 10, 5]

FACTORY_MACHINES = [f"M-{i:03d}" for i in range(1, 16)]
FACTORY_DEFECTS = [None, None, None, "Surface scratch", "Dimensional error",
                   "Weld crack", "Material defect", "Alignment off"]

def generate_smart_factory(n_cases: int = 2000) -> list[dict]:
    rng = _seed("factory")
    base = datetime(2023, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"PO-{50000 + i}"
        path = _pick(rng, FACTORY_PATHS, FACTORY_PATH_WEIGHTS)
        t = base + timedelta(days=rng.randint(0, 365))

        for activity in path:
            machine = _pick(rng, FACTORY_MACHINES)
            t += timedelta(minutes=rng.randint(15, 480))
            temp = round(rng.uniform(18, 45) + (200 if activity == "Welding" else 0)
                         + (80 if activity == "Painting" else 0), 1)
            vibration = round(rng.uniform(0.1, 5.0) +
                              (3.0 if activity in ("Cutting", "Welding") else 0), 2)
            power = round(rng.uniform(0.5, 15.0) +
                          (20 if activity == "Welding" else 0) +
                          (10 if activity == "Cutting" else 0), 1)
            humidity = round(rng.uniform(30, 70), 1)
            pressure = round(rng.uniform(1.0, 3.5), 2) if activity in ("Welding", "Painting") else None

            qa_score = None
            defect = None
            if activity == "QA Inspection":
                qa_score = round(rng.uniform(60, 100), 1)
                if qa_score < 75:
                    defect = _pick(rng, [d for d in FACTORY_DEFECTS if d])

            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "resource": machine,
                "temperature": temp,
                "vibration": vibration,
                "power_kw": power,
                "humidity": humidity,
                "pressure": pressure,
                "quality_score": qa_score,
                "defect_type": defect,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# 10. BPIC 2020 — University Travel (5 sub-logs)
# ═══════════════════════════════════════════════════════════════════════════

BPIC2020_DECLARATION_ACTIVITIES = [
    "Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
    "Declaration APPROVED by BUDGET OWNER", "Declaration APPROVED by SUPERVISOR",
    "Declaration APPROVED by PRE_APPROVER", "Declaration FINAL_APPROVED by SUPERVISOR",
    "Declaration FINAL_APPROVED by DIRECTOR",
    "Declaration REJECTED by ADMINISTRATION", "Declaration REJECTED by SUPERVISOR",
    "Declaration REJECTED by BUDGET OWNER",
    "Payment Handled", "Request Payment",
]

BPIC2020_DEPARTMENTS = [
    "Faculty of Science", "Faculty of Engineering", "Faculty of Medicine",
    "Faculty of Arts", "Faculty of Law", "Administration",
    "IT Services", "Research Institute",
]

BPIC2020_DOM_PATHS = [
    # Simple approval (40%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration APPROVED by BUDGET OWNER", "Declaration FINAL_APPROVED by SUPERVISOR",
     "Request Payment", "Payment Handled"],
    # Pre-approved (25%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by PRE_APPROVER",
     "Declaration APPROVED by ADMINISTRATION", "Declaration FINAL_APPROVED by SUPERVISOR",
     "Request Payment", "Payment Handled"],
    # Rejected then resubmitted (15%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration REJECTED by ADMINISTRATION",
     "Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration APPROVED by BUDGET OWNER", "Declaration FINAL_APPROVED by SUPERVISOR",
     "Request Payment", "Payment Handled"],
    # Director approval (high amount) (10%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration APPROVED by BUDGET OWNER", "Declaration APPROVED by SUPERVISOR",
     "Declaration FINAL_APPROVED by DIRECTOR", "Request Payment", "Payment Handled"],
    # Rejected final (10%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration REJECTED by BUDGET OWNER"],
]

BPIC2020_DOM_PATH_WEIGHTS = [40, 25, 15, 10, 10]

BPIC2020_INTL_PATHS = [
    # Full chain (35%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by PRE_APPROVER",
     "Declaration APPROVED by ADMINISTRATION", "Declaration APPROVED by BUDGET OWNER",
     "Declaration APPROVED by SUPERVISOR", "Declaration FINAL_APPROVED by DIRECTOR",
     "Request Payment", "Payment Handled"],
    # Supervisor final (30%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration APPROVED by BUDGET OWNER", "Declaration FINAL_APPROVED by SUPERVISOR",
     "Request Payment", "Payment Handled"],
    # Rejected (15%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration REJECTED by SUPERVISOR"],
    # Resubmit (20%)
    ["Declaration SUBMITTED by EMPLOYEE", "Declaration REJECTED by ADMINISTRATION",
     "Declaration SUBMITTED by EMPLOYEE", "Declaration APPROVED by ADMINISTRATION",
     "Declaration APPROVED by BUDGET OWNER", "Declaration APPROVED by SUPERVISOR",
     "Declaration FINAL_APPROVED by DIRECTOR", "Request Payment", "Payment Handled"],
]

BPIC2020_INTL_PATH_WEIGHTS = [35, 30, 15, 20]


def _gen_bpic2020_log(seed_name: str, paths: list, weights: list,
                       n_cases: int, amount_range: tuple,
                       is_international: bool = False) -> list[dict]:
    rng = _seed(seed_name)
    base = datetime(2017, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"{'INTL' if is_international else 'DOM'}-{20000 + i}"
        amount = round(rng.uniform(*amount_range), 2)
        dept = _pick(rng, BPIC2020_DEPARTMENTS)
        budget = f"BUD-{rng.randint(1000, 9999)}"
        project = f"PRJ-{rng.randint(100, 999)}"
        permit = f"TP-{rng.randint(10000, 99999)}"
        overspent = round(max(0, amount - rng.uniform(500, 3000)), 2)

        path = _pick(rng, paths, weights)
        t = base + timedelta(days=rng.randint(0, 700))
        for activity in path:
            t += timedelta(days=rng.randint(1, 10), hours=rng.randint(0, 23))
            rows.append({
                "case_id": case_id,
                "activity": activity,
                "timestamp": t.isoformat() + "Z",
                "resource": f"emp_{rng.randint(1, 500):04d}",
                "amount": amount,
                "declaration_number": case_id,
                "budget_number": budget,
                "organizational_entity": dept,
                "project_number": project,
                "travel_permit_number": permit,
                "overspent_amount": overspent if overspent > 0 else 0,
                "is_international": is_international,
            })
    return rows


def generate_bpic2020_domestic(n_cases: int = 2000) -> list[dict]:
    return _gen_bpic2020_log("bpic2020dom", BPIC2020_DOM_PATHS,
                              BPIC2020_DOM_PATH_WEIGHTS, n_cases, (20, 800))


def generate_bpic2020_international(n_cases: int = 1500) -> list[dict]:
    return _gen_bpic2020_log("bpic2020intl", BPIC2020_INTL_PATHS,
                              BPIC2020_INTL_PATH_WEIGHTS, n_cases, (200, 5000),
                              is_international=True)


def generate_bpic2020_prepaid(n_cases: int = 1000) -> list[dict]:
    rng = _seed("bpic2020prepaid")
    base = datetime(2017, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"PRE-{40000 + i}"
        amount = round(rng.uniform(50, 3000), 2)
        permit = f"TP-{rng.randint(10000, 99999)}"
        dept = _pick(rng, BPIC2020_DEPARTMENTS)

        t = base + timedelta(days=rng.randint(0, 700))
        for act in ["Prepaid Travel Cost SUBMITTED", "Prepaid Travel Cost APPROVED",
                     "Prepaid Travel Cost REGISTERED", "Payment Handled"]:
            t += timedelta(days=rng.randint(1, 14))
            rows.append({
                "case_id": case_id,
                "activity": act,
                "timestamp": t.isoformat() + "Z",
                "resource": f"emp_{rng.randint(1, 500):04d}",
                "amount": amount,
                "travel_permit_number": permit,
                "organizational_entity": dept,
            })
    return rows


def generate_bpic2020_permits(n_cases: int = 2000) -> list[dict]:
    rng = _seed("bpic2020permits")
    base = datetime(2017, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"TP-{10000 + i}"
        dept = _pick(rng, BPIC2020_DEPARTMENTS)
        budget = f"BUD-{rng.randint(1000, 9999)}"

        t = base + timedelta(days=rng.randint(0, 700))
        for act in ["Permit SUBMITTED by EMPLOYEE", "Permit APPROVED by ADMINISTRATION",
                     "Permit APPROVED by SUPERVISOR", "Permit FINAL_APPROVED by DIRECTOR",
                     "Start trip", "End trip"]:
            t += timedelta(days=rng.randint(1, 30))
            rows.append({
                "case_id": case_id,
                "activity": act,
                "timestamp": t.isoformat() + "Z",
                "resource": f"emp_{rng.randint(1, 500):04d}",
                "budget_number": budget,
                "organizational_entity": dept,
            })
    return rows


def generate_bpic2020_payment_requests(n_cases: int = 1500) -> list[dict]:
    rng = _seed("bpic2020pay")
    base = datetime(2017, 1, 1)
    rows = []
    for i in range(n_cases):
        case_id = f"PAY-{60000 + i}"
        amount = round(rng.uniform(50, 5000), 2)
        dept = _pick(rng, BPIC2020_DEPARTMENTS)

        t = base + timedelta(days=rng.randint(0, 700))
        for act in ["Request For Payment SUBMITTED by EMPLOYEE",
                     "Request For Payment APPROVED by ADMINISTRATION",
                     "Request For Payment APPROVED by BUDGET OWNER",
                     "Request For Payment FINAL_APPROVED by SUPERVISOR",
                     "Payment Handled"]:
            t += timedelta(days=rng.randint(1, 15))
            rows.append({
                "case_id": case_id,
                "activity": act,
                "timestamp": t.isoformat() + "Z",
                "resource": f"emp_{rng.randint(1, 500):04d}",
                "amount": amount,
                "organizational_entity": dept,
            })
    return rows


# ═══════════════════════════════════════════════════════════════════════════
# Insurance Demo — Policies, Claims, Medical Submissions
# ═══════════════════════════════════════════════════════════════════════════

import json as _json

_INSURANCE_TIERS = ["Basico", "Estandar", "Premium", "Platinum"]
_INSURANCE_TIER_WEIGHTS = [30, 35, 25, 10]

_INSURANCE_STATUSES = ["Vigente", "Vencida", "Cancelada"]
_INSURANCE_STATUS_WEIGHTS = [75, 15, 10]

_PLAN_TYPES = ["Individual", "Familiar", "Corporativo"]

_FIRST_NAMES = [
    "Maria", "Jose", "Carlos", "Ana", "Juan", "Rosa", "Luis", "Elena",
    "Pedro", "Carmen", "Miguel", "Sofia", "Fernando", "Patricia", "Ricardo",
    "Laura", "Alejandro", "Gabriela", "Roberto", "Claudia", "Oscar", "Diana",
    "Raul", "Monica", "Daniel", "Andrea", "Francisco", "Lucia", "Sergio", "Isabel",
]
_LAST_NAMES = [
    "Garcia", "Lopez", "Martinez", "Rodriguez", "Hernandez", "Gonzalez",
    "Perez", "Sanchez", "Ramirez", "Torres", "Flores", "Rivera", "Gomez",
    "Diaz", "Cruz", "Morales", "Ortiz", "Gutierrez", "Chavez", "Ramos",
    "Reyes", "Mendoza", "Aguilar", "Castillo", "Jimenez", "Romero",
]

_COVERED_SERVICES = {
    "Basico": ["Consulta general", "Urgencias", "Laboratorio basico", "Hospitalizacion (sala general)"],
    "Estandar": ["Consulta general", "Consulta especialista", "Urgencias", "Laboratorio", "Imagenologia basica", "Hospitalizacion", "Cirugia ambulatoria"],
    "Premium": ["Consulta general", "Consulta especialista", "Urgencias", "Laboratorio completo", "Imagenologia", "Hospitalizacion (privada)", "Cirugia", "Rehabilitacion", "Salud mental", "Maternidad"],
    "Platinum": ["Consulta general", "Consulta especialista", "Urgencias", "Laboratorio completo", "Imagenologia avanzada", "Hospitalizacion (suite)", "Cirugia", "Rehabilitacion", "Salud mental", "Maternidad", "Dental", "Vision", "Medicina alternativa", "Ambulancia aerea"],
}

_EXCLUDED_SERVICES = {
    "Basico": ["Cirugia estetica", "Dental", "Vision", "Salud mental", "Maternidad", "Rehabilitacion", "Medicina alternativa", "Ambulancia aerea"],
    "Estandar": ["Cirugia estetica", "Dental", "Vision", "Medicina alternativa", "Ambulancia aerea"],
    "Premium": ["Cirugia estetica", "Medicina alternativa", "Ambulancia aerea"],
    "Platinum": ["Cirugia estetica"],
}

_COVERAGE_DETAIL = {
    "Basico": {"consulta_general": {"copago": 30, "limite_anual_usd": 5000}, "urgencias": {"copago": 40, "limite_anual_usd": 10000}, "laboratorio": {"copago": 35, "limite_anual_usd": 3000}, "hospitalizacion": {"copago": 50, "limite_anual_usd": 15000}},
    "Estandar": {"consulta_general": {"copago": 20, "limite_anual_usd": 10000}, "consulta_especialista": {"copago": 25, "limite_anual_usd": 8000}, "urgencias": {"copago": 25, "limite_anual_usd": 20000}, "laboratorio": {"copago": 20, "limite_anual_usd": 5000}, "imagenologia": {"copago": 30, "limite_anual_usd": 5000}, "hospitalizacion": {"copago": 30, "limite_anual_usd": 30000}, "cirugia_ambulatoria": {"copago": 35, "limite_anual_usd": 15000}},
    "Premium": {"consulta_general": {"copago": 10, "limite_anual_usd": 20000}, "consulta_especialista": {"copago": 15, "limite_anual_usd": 15000}, "urgencias": {"copago": 15, "limite_anual_usd": 50000}, "laboratorio": {"copago": 10, "limite_anual_usd": 10000}, "imagenologia": {"copago": 15, "limite_anual_usd": 10000}, "hospitalizacion": {"copago": 15, "limite_anual_usd": 75000}, "cirugia": {"copago": 20, "limite_anual_usd": 50000}, "rehabilitacion": {"copago": 20, "limite_anual_usd": 10000}, "salud_mental": {"copago": 20, "limite_anual_usd": 8000}, "maternidad": {"copago": 15, "limite_anual_usd": 20000}},
    "Platinum": {"consulta_general": {"copago": 5, "limite_anual_usd": 50000}, "consulta_especialista": {"copago": 10, "limite_anual_usd": 30000}, "urgencias": {"copago": 10, "limite_anual_usd": 100000}, "laboratorio": {"copago": 5, "limite_anual_usd": 25000}, "imagenologia": {"copago": 10, "limite_anual_usd": 20000}, "hospitalizacion": {"copago": 10, "limite_anual_usd": 150000}, "cirugia": {"copago": 10, "limite_anual_usd": 100000}, "rehabilitacion": {"copago": 10, "limite_anual_usd": 25000}, "salud_mental": {"copago": 10, "limite_anual_usd": 20000}, "maternidad": {"copago": 10, "limite_anual_usd": 40000}, "dental": {"copago": 15, "limite_anual_usd": 5000}, "vision": {"copago": 15, "limite_anual_usd": 3000}},
}

_PREMIUM_RANGES = {
    "Basico": (45, 120), "Estandar": (120, 280),
    "Premium": (280, 550), "Platinum": (550, 1200),
}
_DEDUCTIBLE_RANGES = {
    "Basico": (500, 2000), "Estandar": (300, 1000),
    "Premium": (100, 500), "Platinum": (0, 200),
}
_MAX_COVERAGE = {
    "Basico": (25000, 50000), "Estandar": (50000, 150000),
    "Premium": (150000, 500000), "Platinum": (500000, 1500000),
}


def generate_insurance_policies(n_policies: int = 500) -> list[dict]:
    rng = _seed("insurance-policies")
    base = datetime(2023, 1, 1)
    rows = []
    for i in range(n_policies):
        tier = _pick(rng, _INSURANCE_TIERS, _INSURANCE_TIER_WEIGHTS)
        status = _pick(rng, _INSURANCE_STATUSES, _INSURANCE_STATUS_WEIGHTS)
        plan = _pick(rng, _PLAN_TYPES)
        first = _pick(rng, _FIRST_NAMES)
        last = _pick(rng, _LAST_NAMES)
        age = rng.randint(18, 75)
        start = base + timedelta(days=rng.randint(0, 700))
        end = start + timedelta(days=365)
        premium = round(rng.uniform(*_PREMIUM_RANGES[tier]), 2)
        deductible = round(rng.uniform(*_DEDUCTIBLE_RANGES[tier]), 2)
        max_cov = round(rng.uniform(*_MAX_COVERAGE[tier]), 2)
        deps = rng.randint(0, 4) if plan == "Familiar" else 0

        rows.append({
            "policy_id": f"POL-{10000 + i}",
            "holder_name": f"{first} {last}",
            "holder_age": age,
            "holder_id": f"{rng.randint(10000000, 99999999)}-{rng.randint(0,9)}",
            "plan_type": plan,
            "tier": tier,
            "status": status,
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
            "monthly_premium_usd": premium,
            "annual_deductible_usd": deductible,
            "max_annual_coverage_usd": max_cov,
            "dependents_count": deps,
            "covered_services": ", ".join(_COVERED_SERVICES[tier]),
            "excluded_services": ", ".join(_EXCLUDED_SERVICES[tier]),
            "exclusions": "Condiciones preexistentes no declaradas, Cirugia estetica, Lesiones autoinfligidas",
            "coverage_detail_json": _json.dumps(_COVERAGE_DETAIL[tier], ensure_ascii=False),
        })
    return rows


_CLAIM_CATEGORIES = ["Consulta", "Urgencias", "Hospitalizacion", "Cirugia", "Laboratorio", "Imagenologia", "Maternidad", "Rehabilitacion", "Dental", "Farmacia"]
_CLAIM_CATEGORY_WEIGHTS = [25, 15, 12, 8, 15, 8, 5, 5, 4, 3]

_DIAGNOSES = [
    "Infeccion respiratoria aguda", "Fractura de extremidad", "Apendicitis aguda",
    "Diabetes mellitus tipo 2", "Hipertension arterial", "Dolor abdominal agudo",
    "Embarazo normal", "Cesarea programada", "Hernia inguinal", "Calculo renal",
    "Gastritis cronica", "Lumbalgia", "Infeccion urinaria", "Dengue",
    "Neumonia adquirida en comunidad", "Trauma craneoencefalico leve",
    "Colecistitis aguda", "Artritis reumatoide", "Anemia ferropenica",
    "Trastorno de ansiedad generalizada",
]

_PROVIDERS = [
    "Hospital Nacional Rosales", "Hospital de Diagnostico", "Clinica Medica Pro-Familia",
    "Hospital CIMA", "Clinica Asistencial La Divina Providencia", "Centro Medico Escalon",
    "Hospital de la Mujer", "Clinica Mayo (San Salvador)", "Hospital San Rafael",
    "Laboratorios Paill", "Centro de Imagenologia Avanzada",
]

_DOCTORS = [
    "Dr. Martinez R.", "Dra. Lopez G.", "Dr. Hernandez M.", "Dra. Garcia P.",
    "Dr. Rodriguez S.", "Dra. Flores T.", "Dr. Ramirez L.", "Dra. Torres V.",
    "Dr. Gonzalez H.", "Dra. Sanchez K.", "Dr. Cruz D.", "Dra. Morales A.",
]

_CLAIM_ACTIVITIES = {
    "approved": [
        "Reclamo Registrado", "Documentos Verificados", "Cobertura Confirmada",
        "Evaluacion Medica", "Monto Aprobado", "Pago Procesado", "Reclamo Cerrado",
    ],
    "denied": [
        "Reclamo Registrado", "Documentos Verificados", "Cobertura Verificada",
        "Reclamo Denegado", "Notificacion al Asegurado",
    ],
    "pending": [
        "Reclamo Registrado", "Documentos Verificados", "Pendiente Evaluacion Medica",
    ],
    "appealed": [
        "Reclamo Registrado", "Documentos Verificados", "Cobertura Verificada",
        "Reclamo Denegado", "Apelacion Recibida", "Revision por Comite",
        "Apelacion Aprobada", "Monto Aprobado", "Pago Procesado", "Reclamo Cerrado",
    ],
}

_CLAIM_OUTCOME_WEIGHTS = [50, 25, 10, 15]  # approved, denied, pending, appealed


def generate_insurance_claims(n_cases: int = 2000) -> list[dict]:
    rng = _seed("insurance-claims")
    base = datetime(2023, 6, 1)
    policies = generate_insurance_policies()
    rows = []
    for i in range(n_cases):
        case_id = f"CLM-{20000 + i}"
        pol = _pick(rng, policies)
        category = _pick(rng, _CLAIM_CATEGORIES, _CLAIM_CATEGORY_WEIGHTS)
        diagnosis = _pick(rng, _DIAGNOSES)
        provider = _pick(rng, _PROVIDERS)
        doctor = _pick(rng, _DOCTORS)
        amount = round(rng.uniform(50, 15000), 2)
        outcome = _pick(rng, ["approved", "denied", "pending", "appealed"], _CLAIM_OUTCOME_WEIGHTS)
        path = _CLAIM_ACTIVITIES[outcome]

        t = base + timedelta(days=rng.randint(0, 500))
        for act in path:
            t += timedelta(hours=rng.randint(1, 72))
            rows.append({
                "case_id": case_id,
                "policy_id": pol["policy_id"],
                "activity": act,
                "timestamp": t.isoformat() + "Z",
                "resource": _pick(rng, ["Recepcion", "Verificador", "Medico Auditor", "Comite Medico", "Finanzas", "Notificaciones"]),
                "claim_category": category,
                "diagnosis": diagnosis,
                "claimed_amount_usd": amount,
                "tier": pol["tier"],
                "provider": provider,
                "attending_doctor": doctor,
            })
    return rows


_SUBMISSION_CATEGORIES = ["Cirugia programada", "Estudio diagnostico", "Tratamiento especializado", "Rehabilitacion", "Procedimiento dental", "Maternidad", "Salud mental"]
_SUBMISSION_CAT_WEIGHTS = [25, 25, 20, 10, 8, 7, 5]

_URGENCY_LEVELS = ["Electiva", "Prioritaria", "Urgente"]
_URGENCY_WEIGHTS = [50, 35, 15]

_SUBMISSION_STATUSES = ["Pendiente verificacion", "En revision", "Aprobada", "Denegada", "Requiere documentacion adicional"]
_SUBMISSION_STATUS_WEIGHTS = [35, 20, 20, 15, 10]

_PROCEDURES = {
    "Cirugia programada": ["Colecistectomia laparoscopica", "Artroscopia de rodilla", "Hernioplastia inguinal", "Cesarea programada", "Septoplastia", "Amigdalectomia"],
    "Estudio diagnostico": ["Resonancia magnetica cerebral", "Tomografia computarizada abdominal", "Ecocardiograma", "Electromiografia", "PET-CT", "Biopsia de ganglio"],
    "Tratamiento especializado": ["Quimioterapia ciclo completo", "Dialisis peritoneal", "Terapia biologica", "Radioterapia", "Cateterismo cardiaco"],
    "Rehabilitacion": ["Fisioterapia post-quirurgica (20 sesiones)", "Rehabilitacion cardiaca", "Terapia ocupacional", "Rehabilitacion pulmonar"],
    "Procedimiento dental": ["Implante dental unitario", "Endodoncia molar", "Cirugia de tercer molar", "Corona porcelana"],
    "Maternidad": ["Control prenatal completo", "Parto natural", "Cesarea de emergencia", "Ecografia 4D"],
    "Salud mental": ["Psicoterapia (12 sesiones)", "Evaluacion psiquiatrica", "Internamiento psiquiatrico", "Terapia de grupo (8 sesiones)"],
}


def generate_insurance_medical_submissions(n_submissions: int = 300) -> list[dict]:
    rng = _seed("insurance-submissions")
    base = datetime(2024, 1, 1)
    policies = generate_insurance_policies()
    rows = []
    for i in range(n_submissions):
        pol = _pick(rng, [p for p in policies if p["status"] == "Vigente"] or policies)
        category = _pick(rng, _SUBMISSION_CATEGORIES, _SUBMISSION_CAT_WEIGHTS)
        procedure = _pick(rng, _PROCEDURES[category])
        urgency = _pick(rng, _URGENCY_LEVELS, _URGENCY_WEIGHTS)
        status = _pick(rng, _SUBMISSION_STATUSES, _SUBMISSION_STATUS_WEIGHTS)
        cost = round(rng.uniform(200, 25000), 2)
        sub_date = base + timedelta(days=rng.randint(0, 300))

        rows.append({
            "submission_id": f"SUB-{30000 + i}",
            "policy_id": pol["policy_id"],
            "patient_name": pol["holder_name"],
            "category": category,
            "diagnosis": _pick(rng, _DIAGNOSES),
            "procedure_description": procedure,
            "estimated_cost_usd": cost,
            "provider": _pick(rng, _PROVIDERS),
            "attending_doctor": _pick(rng, _DOCTORS),
            "urgency": urgency,
            "status": status,
            "submission_date": sub_date.strftime("%Y-%m-%d"),
            "notes": "" if rng.random() > 0.3 else _pick(rng, [
                "Paciente con antecedentes de hipertension",
                "Requiere autorizacion previa del comite medico",
                "Segunda opinion solicitada",
                "Documentacion incompleta — falta orden medica",
                "Procedimiento previamente denegado, reevaluacion solicitada",
                "Paciente menor de edad, requiere consentimiento del tutor",
            ]),
        })
    return rows
