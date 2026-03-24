from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from shared.models import InferenceResult, ObjectType, SimilarityScore
from shared.enums import SemanticType
from scorer import CorrelationScorer

app = FastAPI(
    title="Nexus Correlation Engine",
    description="Computes semantic similarity between schemas and object types",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

scorer = CorrelationScorer()


class ScoreRequest(BaseModel):
    schema_a: InferenceResult
    object_type: ObjectType


class ScoreAllRequest(BaseModel):
    schema_a: InferenceResult
    object_types: list[ObjectType]


class CorrelationMatch(BaseModel):
    object_type_id: str
    object_type_name: str
    composite_score: float
    field_name_overlap: float
    semantic_type_overlap: float
    primary_key_resolvable: bool
    conflicting_fields: list[str]
    action: str           # "enrich" | "link" | "new_type"
    suggested_join_key: Optional[dict[str, str]] = None   # {"incoming": "...", "existing": "..."}
    pipeline_hint: Optional[str] = None


class ScoreAllResponse(BaseModel):
    matches: list[CorrelationMatch]
    top_action: str       # overall recommendation
    new_object_name: str


def _suggest_join_and_pipeline(schema_a: InferenceResult, object_type: ObjectType, score: SimilarityScore) -> tuple[Optional[dict], Optional[str]]:
    """Return (suggested_join_key, pipeline_hint) for linking two schemas."""
    incoming_fields = {f.suggested_name: f for f in schema_a.fields}
    existing_props = {p.name: p for p in object_type.properties}

    # Try direct EMAIL join
    for inc_name, inc_f in incoming_fields.items():
        if inc_f.semantic_type == SemanticType.EMAIL:
            for ext_name, ext_p in existing_props.items():
                if ext_p.semantic_type == SemanticType.EMAIL:
                    return (
                        {"incoming": inc_name, "existing": ext_name},
                        f"Join on {inc_name} → {ext_name} (both EMAIL). Direct match — no transformation needed.",
                    )

    # Try direct IDENTIFIER join
    for inc_name, inc_f in incoming_fields.items():
        if inc_f.semantic_type == SemanticType.IDENTIFIER:
            for ext_name, ext_p in existing_props.items():
                if ext_p.semantic_type == SemanticType.IDENTIFIER:
                    import difflib
                    ratio = difflib.SequenceMatcher(None, inc_name, ext_name).ratio()
                    if ratio >= 0.6:
                        return (
                            {"incoming": inc_name, "existing": ext_name},
                            f"Join on {inc_name} → {ext_name} (both IDENTIFIER, {round(ratio*100)}% name similarity).",
                        )

    # Look for TEXT field that may contain names from the other side
    # e.g. meeting_title → company_name, speaker_name → first_name/last_name
    person_name_fields = [f for f in incoming_fields.values() if f.semantic_type == SemanticType.PERSON_NAME]
    text_fields_incoming = [f for f in incoming_fields.values() if f.semantic_type == SemanticType.TEXT]
    company_fields = [p for p in existing_props.values() if "company" in p.name or "organization" in p.name or "account" in p.name]
    name_fields = [p for p in existing_props.values() if p.semantic_type == SemanticType.PERSON_NAME]

    if person_name_fields and name_fields:
        inc = person_name_fields[0]
        ext = name_fields[0]
        return (
            {"incoming": inc.suggested_name, "existing": ext.name},
            f"MAP node: extract person name from '{inc.suggested_name}' → match to '{ext.name}'. Add a FILTER to drop non-matching rows, then DEDUPE by name.",
        )

    if text_fields_incoming and company_fields:
        inc = text_fields_incoming[0]
        ext = company_fields[0]
        return (
            {"incoming": inc.suggested_name, "existing": ext.name},
            f"Pipeline: MAP '{inc.suggested_name}' through NLP to extract company name → fuzzy-match to '{ext.name}' in {object_type.display_name}. Add FILTER (confidence > 0.8) and ENRICH node.",
        )

    # Fallback: suggest a generic link
    if schema_a.fields and object_type.properties:
        inc = schema_a.fields[0].suggested_name
        ext = object_type.properties[0].name
        return (
            {"incoming": inc, "existing": ext},
            f"No direct join key found. Consider a lookup pipeline: MAP {inc} → ENRICH from {object_type.display_name} on best-guess match.",
        )

    return None, None


@app.post("/score", response_model=SimilarityScore)
async def score_similarity(req: ScoreRequest):
    return scorer.score(req.schema_a, req.object_type)


@app.post("/score-all", response_model=ScoreAllResponse)
async def score_all(req: ScoreAllRequest):
    matches: list[CorrelationMatch] = []

    for ot in req.object_types:
        sim = scorer.score(req.schema_a, ot)

        if sim.composite_score >= 0.55:
            action = "enrich"
        elif sim.composite_score >= 0.15:
            action = "link"
        else:
            action = "new_type"

        join_key, pipeline_hint = None, None
        if action in ("enrich", "link"):
            join_key, pipeline_hint = _suggest_join_and_pipeline(req.schema_a, ot, sim)

        matches.append(CorrelationMatch(
            object_type_id=ot.id,
            object_type_name=ot.display_name,
            composite_score=sim.composite_score,
            field_name_overlap=sim.field_name_overlap,
            semantic_type_overlap=sim.semantic_type_overlap,
            primary_key_resolvable=sim.primary_key_resolvable,
            conflicting_fields=sim.conflicting_fields,
            action=action,
            suggested_join_key=join_key,
            pipeline_hint=pipeline_hint,
        ))

    matches.sort(key=lambda m: m.composite_score, reverse=True)

    best = matches[0] if matches else None
    if best and best.composite_score >= 0.55:
        top_action = "enrich"
    elif best and best.composite_score >= 0.15:
        top_action = "link"
    else:
        top_action = "new_type"

    return ScoreAllResponse(
        matches=matches,
        top_action=top_action,
        new_object_name=req.schema_a.suggested_object_type_name,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "service": "correlation-engine"}
