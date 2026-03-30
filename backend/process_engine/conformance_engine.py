"""
Conformance checking engine.

Given a "happy path" model (ordered list of expected activities) and a case's
actual activity sequence, compute:
  - fitness score (0–1)
  - list of deviations: skip, wrong_order, unauthorized, rework
"""
from dataclasses import dataclass, field


@dataclass
class Deviation:
    type: str          # skip | wrong_order | unauthorized | rework
    activity: str
    position: int      # index in actual sequence where detected
    detail: str = ""


@dataclass
class ConformanceResult:
    case_id: str
    fitness: float                     # 0.0 – 1.0
    is_conformant: bool
    deviations: list[Deviation] = field(default_factory=list)
    matched: int = 0
    expected_total: int = 0
    actual_total: int = 0


def _dedup_consecutive(seq: list[str]) -> list[str]:
    """Remove consecutive duplicate activities (same as rework detection in process.py)."""
    result = []
    for item in seq:
        if not result or result[-1] != item:
            result.append(item)
    return result


def check_conformance(
    case_id: str,
    actual_sequence: list[str],
    model_activities: list[str],
    conformance_threshold: float = 0.7,
) -> ConformanceResult:
    """
    Subsequence-pointer walk algorithm:

    Walk the actual sequence. For each actual activity:
      - If it matches model[pointer] → advance pointer (matched)
      - If it appears later in the model → mark activities between pointer
        and that position as skipped, then advance pointer past them
      - If it doesn't appear in model at all → mark as unauthorized
      - If it appeared before current pointer → mark as wrong_order

    Additionally, before the walk, mark rework where consecutive
    deduplication removes activities.
    """
    deviations: list[Deviation] = []
    model = list(model_activities)
    expected_set = set(model)
    model_index = {act: i for i, act in enumerate(model)}  # first occurrence

    # Detect rework (consecutive repeats) before the main walk
    for i, act in enumerate(actual_sequence):
        if i > 0 and actual_sequence[i - 1] == act:
            deviations.append(Deviation(
                type="rework",
                activity=act,
                position=i,
                detail=f"'{act}' repeated consecutively at position {i}",
            ))

    # Work on deduped sequence for the conformance walk
    deduped = _dedup_consecutive(actual_sequence)
    pointer = 0          # current position in model
    matched = 0
    seen_model_positions: set[int] = set()

    for pos, act in enumerate(deduped):
        if pointer >= len(model):
            # Past the end of the model
            if act not in expected_set:
                deviations.append(Deviation(
                    type="unauthorized",
                    activity=act,
                    position=pos,
                    detail=f"'{act}' not in model and occurs after model end",
                ))
            continue

        if act == model[pointer]:
            # Perfect match — advance
            matched += 1
            seen_model_positions.add(pointer)
            pointer += 1

        elif act in expected_set:
            act_model_pos = model_index[act]

            if act_model_pos > pointer:
                # Activity appears later in the model → activities in between are skipped
                for skipped_pos in range(pointer, act_model_pos):
                    skipped_act = model[skipped_pos]
                    if skipped_pos not in seen_model_positions:
                        deviations.append(Deviation(
                            type="skip",
                            activity=skipped_act,
                            position=pos,
                            detail=f"'{skipped_act}' was skipped before '{act}'",
                        ))
                matched += 1
                seen_model_positions.add(act_model_pos)
                pointer = act_model_pos + 1

            else:
                # Activity already passed in model → wrong order
                deviations.append(Deviation(
                    type="wrong_order",
                    activity=act,
                    position=pos,
                    detail=f"'{act}' occurred after expected position {model_index[act]}",
                ))
        else:
            # Not in model at all
            deviations.append(Deviation(
                type="unauthorized",
                activity=act,
                position=pos,
                detail=f"'{act}' is not part of the expected process model",
            ))

    # Any remaining unmatched model activities are skips
    for skipped_pos in range(pointer, len(model)):
        if skipped_pos not in seen_model_positions:
            deviations.append(Deviation(
                type="skip",
                activity=model[skipped_pos],
                position=len(deduped),
                detail=f"'{model[skipped_pos]}' never occurred in case",
            ))

    fitness = matched / len(model) if model else 1.0
    # Penalise for unauthorized activities (they inflate non-conformance)
    unauthorized_count = sum(1 for d in deviations if d.type == "unauthorized")
    if unauthorized_count and len(deduped):
        fitness = max(0.0, fitness - (unauthorized_count / len(deduped)) * 0.5)

    fitness = round(min(1.0, max(0.0, fitness)), 3)

    return ConformanceResult(
        case_id=case_id,
        fitness=fitness,
        is_conformant=fitness >= conformance_threshold,
        deviations=deviations,
        matched=matched,
        expected_total=len(model),
        actual_total=len(actual_sequence),
    )


def aggregate_conformance(results: list[ConformanceResult]) -> dict:
    """Summarise a list of per-case conformance results."""
    if not results:
        return {
            "total_cases": 0,
            "conformant_cases": 0,
            "conformance_rate": 0.0,
            "avg_fitness": 0.0,
            "deviation_summary": {},
        }

    conformant = sum(1 for r in results if r.is_conformant)
    avg_fitness = round(sum(r.fitness for r in results) / len(results), 3)

    deviation_counts: dict[str, dict[str, int]] = {}
    for r in results:
        for d in r.deviations:
            key = d.activity
            if key not in deviation_counts:
                deviation_counts[key] = {"skip": 0, "wrong_order": 0, "unauthorized": 0, "rework": 0}
            deviation_counts[key][d.type] = deviation_counts[key].get(d.type, 0) + 1

    # Sort by total deviation count descending
    deviation_summary = dict(
        sorted(
            deviation_counts.items(),
            key=lambda x: sum(x[1].values()),
            reverse=True,
        )
    )

    return {
        "total_cases": len(results),
        "conformant_cases": conformant,
        "conformance_rate": round(conformant / len(results) * 100, 1),
        "avg_fitness": avg_fitness,
        "deviation_summary": deviation_summary,
    }
