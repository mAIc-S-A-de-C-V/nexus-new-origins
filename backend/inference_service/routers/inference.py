from typing import Optional
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from shared.models import InferenceResult, SimilarityScore, FieldConflict
from claude_client import ClaudeInferenceClient

router = APIRouter()
client = ClaudeInferenceClient()


class SchemaInferRequest(BaseModel):
    connector_id: str
    raw_schema: dict
    sample_rows: list[dict] = []


class SimilarityRequest(BaseModel):
    schema_a: dict
    schema_a_id: str
    object_type: dict
    object_type_id: str


class ConflictRequest(BaseModel):
    existing_object: dict
    incoming_schema: dict


class NewObjectRequest(BaseModel):
    incoming_schema: dict
    existing_objects: list[dict] = []


@router.post("/schema", response_model=InferenceResult)
async def infer_schema(req: SchemaInferRequest):
    """
    Run AI-powered schema inference on a raw connector schema.
    Returns field-level semantic types, PII levels, and suggested canonical names.
    """
    return client.infer_schema(
        connector_id=req.connector_id,
        raw_schema=req.raw_schema,
        sample_rows=req.sample_rows,
    )


@router.post("/similarity", response_model=SimilarityScore)
async def score_similarity(req: SimilarityRequest):
    """
    Score semantic similarity between an incoming schema and an existing ObjectType.
    Used to determine which scenario (enrichment/conflict/new) applies.
    """
    return client.score_similarity(
        existing_object=req.object_type,
        incoming_schema=req.schema_a,
        schema_a_id=req.schema_a_id,
        object_type_id=req.object_type_id,
    )


@router.post("/conflicts", response_model=list[FieldConflict])
async def detect_conflicts(req: ConflictRequest):
    """
    Detect schema conflicts between an existing ObjectType and incoming schema.
    Returns list of conflicts with suggested resolutions.
    """
    return client.detect_conflicts(
        existing_object=req.existing_object,
        incoming_schema=req.incoming_schema,
    )


@router.post("/suggest-object")
async def suggest_object_type(req: NewObjectRequest):
    """
    Suggest a new ObjectType definition for an incoming schema that has low similarity
    to any existing ObjectType.
    """
    return client.suggest_object_type(
        incoming_schema=req.incoming_schema,
        existing_objects=req.existing_objects,
    )


class GenerateAppRequest(BaseModel):
    description: str
    object_type_id: str
    object_type_name: str
    properties: list[str] = []
    sample_rows: list[dict] = []


@router.post("/generate-app")
async def generate_app_layout(req: GenerateAppRequest):
    """
    Generate a dashboard app layout from a natural language description.
    Returns a list of AppComponent configs ready for the frontend canvas.
    """
    try:
        return client.generate_app(
            description=req.description,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            properties=req.properties,
            sample_rows=req.sample_rows,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"App generation failed: {e}")


class GenerateWidgetRequest(BaseModel):
    description: str
    object_type_id: str
    object_type_name: str
    properties: list[str] = []
    sample_rows: list[dict] = []
    force_code: bool = False  # if True, always generate custom-code


@router.post("/generate-widget")
async def generate_widget(req: GenerateWidgetRequest):
    """
    Generate a single widget config from a natural language description.
    Returns one AppComponent config. If force_code=True or the request is complex,
    returns a custom-code widget with generated JavaScript.
    """
    try:
        if req.force_code:
            return client.generate_code_widget(
                description=req.description,
                object_type_id=req.object_type_id,
                object_type_name=req.object_type_name,
                properties=req.properties,
                sample_rows=req.sample_rows,
            )
        return client.generate_widget(
            description=req.description,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            properties=req.properties,
            sample_rows=req.sample_rows,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Widget generation failed: {e}")


@router.post("/generate-code")
async def generate_code_widget(req: GenerateWidgetRequest):
    """
    Always generates a custom-code widget — Claude writes arbitrary JS/React code
    to render exactly what the user asks for, with no preset widget type constraints.
    """
    try:
        return client.generate_code_widget(
            description=req.description,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            properties=req.properties,
            sample_rows=req.sample_rows,
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Code widget generation failed: {e}")


class ChatRequest(BaseModel):
    question: str
    object_type_id: str = ""
    object_type_name: str
    fields: list[str] = []
    records: list[dict] = []


@router.post("/chat")
async def chat_with_data(req: ChatRequest):
    """
    Answer a natural language question about provided records.
    Returns a markdown answer from Claude, optionally with embedded widget specs.
    """
    try:
        answer = client.chat_with_data(
            question=req.question,
            object_type_id=req.object_type_id,
            object_type_name=req.object_type_name,
            fields=req.fields,
            records=req.records,
        )
        return {"answer": answer}
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {e}")
