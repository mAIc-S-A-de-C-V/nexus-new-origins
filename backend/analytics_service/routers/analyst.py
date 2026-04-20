"""
AIP Analyst — natural language to query to answer using Claude tool use.
"""
import os
import json
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
import anthropic
from database import get_session
from query_engine import run_explore_query, sample_fields
from shared.token_tracker import track_token_usage

router = APIRouter()

_anthropic = anthropic.AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))

ANALYST_TOOLS = [
    {
        "name": "get_fields",
        "description": "Get available field names for an object type. Call this first to understand the schema before building a query.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string", "description": "The object type ID to inspect"}
            },
            "required": ["object_type_id"],
        },
    },
    {
        "name": "run_query",
        "description": "Execute an analytical query against the object records. Returns rows of data.",
        "input_schema": {
            "type": "object",
            "properties": {
                "object_type_id": {"type": "string"},
                "filters": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "field": {"type": "string"},
                            "op": {"type": "string", "enum": ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "starts_with", "is_null", "is_not_null"]},
                            "value": {"type": "string"},
                        },
                        "required": ["field", "op"],
                    },
                    "description": "Filter conditions on JSONB fields",
                },
                "aggregate": {
                    "type": "object",
                    "properties": {
                        "function": {"type": "string", "enum": ["COUNT", "SUM", "AVG", "MIN", "MAX"]},
                        "field": {"type": "string", "description": "Field to aggregate (use * for COUNT)"},
                    },
                },
                "group_by": {"type": "string", "description": "Field to group results by"},
                "order_by": {
                    "type": "object",
                    "properties": {
                        "field": {"type": "string"},
                        "direction": {"type": "string", "enum": ["asc", "desc"]},
                    },
                },
                "limit": {"type": "integer", "default": 100},
            },
            "required": ["object_type_id"],
        },
    },
]

SYSTEM_PROMPT = """You are the AIP Analyst, an AI assistant embedded in the Nexus data intelligence platform.
You help users query and understand their object data using natural language.

When answering a question:
1. First call get_fields to understand the available schema
2. Then call run_query with appropriate filters, aggregations, and groupings
3. Synthesize the results into a clear, concise answer

Be precise with field names — use exactly the field names returned by get_fields.
If the user asks about counts by category, use aggregate + group_by.
If the user asks to filter, use the filters array.
Format numbers clearly. Keep your final answer brief and focused on what the user asked."""


def _tenant(request: Request) -> str:
    return request.headers.get("x-tenant-id", "tenant-001")


class AnalystRequest(BaseModel):
    question: str
    object_type_id: str
    object_type_name: str | None = None


class AnalystResponse(BaseModel):
    answer: str
    query_used: dict | None = None
    rows: list[dict] | None = None
    columns: list[str] | None = None
    total: int | None = None


@router.post("/query", response_model=AnalystResponse)
async def analyst_query(
    body: AnalystRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    tenant_id = _tenant(request)
    type_label = body.object_type_name or body.object_type_id

    messages = [
        {
            "role": "user",
            "content": f"I want to analyze my '{type_label}' data (object_type_id: {body.object_type_id}). {body.question}",
        }
    ]

    last_query: dict | None = None
    last_result: dict | None = None
    max_iterations = 5

    for _ in range(max_iterations):
        response = await _anthropic.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            tools=ANALYST_TOOLS,
            messages=messages,
        )
        track_token_usage(tenant_id, "analytics_service", "claude-opus-4-6",
                          response.usage.input_tokens, response.usage.output_tokens)

        if response.stop_reason == "end_turn":
            # Extract text answer
            answer = ""
            for block in response.content:
                if hasattr(block, "text"):
                    answer = block.text
                    break
            return AnalystResponse(
                answer=answer,
                query_used=last_query,
                rows=last_result.get("rows") if last_result else None,
                columns=last_result.get("columns") if last_result else None,
                total=last_result.get("total") if last_result else None,
            )

        # Process tool calls
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue

            tool_name = block.name
            tool_input = block.input

            if tool_name == "get_fields":
                fields = await sample_fields(
                    session, tenant_id, tool_input["object_type_id"]
                )
                result_content = json.dumps({"fields": fields})

            elif tool_name == "run_query":
                last_query = tool_input
                qr = await run_explore_query(
                    session=session,
                    tenant_id=tenant_id,
                    object_type_id=tool_input.get("object_type_id", body.object_type_id),
                    filters=tool_input.get("filters", []),
                    aggregate=tool_input.get("aggregate"),
                    group_by=tool_input.get("group_by"),
                    order_by=tool_input.get("order_by"),
                    limit=min(tool_input.get("limit", 100), 200),
                    offset=0,
                    select_fields=[],
                )
                last_result = qr
                # Truncate for Claude context
                preview = {"rows": qr["rows"][:50], "total": qr["total"], "columns": qr["columns"], "query_ms": qr["query_ms"]}
                result_content = json.dumps(preview, default=str)
            else:
                result_content = json.dumps({"error": f"Unknown tool: {tool_name}"})

            tool_results.append({
                "type": "tool_result",
                "tool_use_id": block.id,
                "content": result_content,
            })

        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": tool_results})

    return AnalystResponse(answer="I was unable to complete the analysis. Please try rephrasing your question.")
