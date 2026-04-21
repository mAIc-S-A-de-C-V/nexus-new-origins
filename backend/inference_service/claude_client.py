"""
Claude API client for schema inference, similarity scoring, and conflict detection.
Uses the Anthropic SDK with structured JSON output.
"""
import json
import os
import logging
from datetime import datetime
from uuid import uuid4
import anthropic
from prompts import (
    SCHEMA_INFERENCE_PROMPT,
    SIMILARITY_SCORING_PROMPT,
    CONFLICT_DETECTION_PROMPT,
    NEW_OBJECT_SUGGESTION_PROMPT,
)
from shared.models import (
    InferenceResult, FieldInference, SimilarityScore,
    FieldConflict, NewObjectProposal, ObjectProperty, OntologyLink
)
from shared.enums import SemanticType, PiiLevel, ConflictType, ConflictResolution
from shared.token_tracker import track_token_usage

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4096


class ClaudeInferenceClient:
    """Wrapper around the Anthropic SDK for structured schema inference tasks."""

    def __init__(self):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set — inference will use mock responses")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None
        self.tenant_id: str = "unknown"

    def _call(self, prompt: str) -> dict:
        """Make a Claude API call and parse JSON response."""
        if not self.client:
            raise ValueError("Anthropic API key not configured")

        message = self.client.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          message.usage.input_tokens, message.usage.output_tokens)

        content = message.content[0].text.strip()
        # Strip markdown code fences robustly (handles ```json, ``` json, trailing newlines, etc.)
        if content.startswith("```"):
            # Remove opening fence line (e.g. ```json or ```)
            content = content[content.index("\n") + 1:]
            # Remove closing fence
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()

        logger.debug(f"Claude raw content (first 200): {repr(content[:200])}")
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            # Attempt repair: Claude often produces broken JSON for code widgets
            # because the "code" field has unescaped newlines or quotes.
            # Try to extract the code field and re-escape it.
            return self._repair_code_json(content)

    @staticmethod
    def _repair_code_json(raw: str) -> dict:
        """Attempt to repair JSON with a broken 'code' string field.

        Strategy: extract metadata fields before "code", extract the raw code
        value (everything between the opening quote and the final closing of
        the JSON), then combine them.
        """
        import re

        # Find where "code": " starts
        m = re.search(r'"code"\s*:\s*"', raw)
        if not m:
            raise ValueError(f"Invalid JSON from Claude (no code field found): {raw[:200]}...")

        # Everything before the "code" key is valid JSON fields — extract them
        prefix = raw[:m.start()].rstrip().rstrip(',')
        # Close it as valid JSON so we can parse the metadata
        metadata_json = prefix.rstrip() + '}'
        try:
            metadata = json.loads(metadata_json)
        except json.JSONDecodeError:
            # Try harder: extract fields with regex
            metadata = {}
            for fm in re.finditer(r'"(\w+)"\s*:\s*("(?:[^"\\]|\\.)*"|\d+)', prefix):
                key = fm.group(1)
                val = fm.group(2)
                if val.startswith('"'):
                    metadata[key] = val[1:-1]
                else:
                    metadata[key] = int(val)

        # Extract the raw code: everything from after "code": " to the last "
        # followed by optional whitespace and }
        code_start = m.end()
        # Find the final closing: the code ends at the last " before the final }
        # Search backwards from end of string for the pattern "\n}" or "}"
        stripped = raw.rstrip()
        if stripped.endswith('}'):
            # Find the quote that closes the code value — scan back from the }
            end = len(stripped) - 1  # position of final }
            # Walk backwards past whitespace to find the closing "
            j = end - 1
            while j > code_start and stripped[j] in (' ', '\t', '\n', '\r'):
                j -= 1
            if stripped[j] == '"':
                code_value = raw[code_start:j]
            else:
                code_value = raw[code_start:end]
        else:
            code_value = raw[code_start:]

        # The code_value is the raw JS code with real newlines — just use it as-is
        metadata['code'] = code_value
        return metadata

    def infer_schema(
        self,
        connector_id: str,
        raw_schema: dict,
        sample_rows: list[dict],
    ) -> InferenceResult:
        """
        Infer semantic types, PII levels, and field metadata from a raw schema.

        Args:
            connector_id: The connector this schema came from
            raw_schema: The raw schema as returned by the connector
            sample_rows: Up to 5 sample data rows for value-based inference

        Returns:
            InferenceResult with field-level inferences
        """
        schema_hash = _hash_schema(raw_schema)

        try:
            prompt = (
                SCHEMA_INFERENCE_PROMPT
                .replace("{raw_schema}", json.dumps(raw_schema, indent=2)[:3000])
                .replace("{sample_rows}", json.dumps(sample_rows[:5], indent=2)[:2000])
            )
            result = self._call(prompt)

            fields = [
                FieldInference(
                    source_field=f["source_field"],
                    suggested_name=f["suggested_name"],
                    semantic_type=SemanticType(f["semantic_type"]),
                    data_type=f["data_type"],
                    pii_level=PiiLevel(f["pii_level"]),
                    confidence=float(f["confidence"]),
                    reasoning=f.get("reasoning", ""),
                    sample_values=[str(v) for v in f.get("sample_values", []) if v is not None],
                    nullable=f.get("nullable", True),
                )
                for f in result.get("fields", [])
            ]

            return InferenceResult(
                connector_id=connector_id,
                fields=fields,
                suggested_object_type_name=result.get("suggested_object_type_name", "UnknownObject"),
                overall_confidence=float(result.get("overall_confidence", 0.0)),
                raw_schema_hash=schema_hash,
                warnings=result.get("warnings", []),
            )

        except Exception as e:
            logger.error(f"Schema inference failed [{type(e).__name__}]: {e}", exc_info=True)
            # Return mock response for development
            return _mock_inference_result(connector_id, raw_schema, schema_hash)

    def detect_conflicts(
        self,
        existing_object: dict,
        incoming_schema: dict,
    ) -> list[FieldConflict]:
        """
        Detect schema conflicts between an existing ObjectType and incoming schema.

        Returns list of FieldConflict objects with suggested resolutions.
        """
        try:
            prompt = (
                CONFLICT_DETECTION_PROMPT
                .replace("{existing_object}", json.dumps(existing_object, indent=2)[:3000])
                .replace("{incoming_schema}", json.dumps(incoming_schema, indent=2)[:3000])
            )
            result = self._call(prompt)

            conflicts = []
            for c in (result if isinstance(result, list) else result.get("conflicts", [])):
                try:
                    conflict = FieldConflict(
                        field_name=c["field_name"],
                        conflict_type=ConflictType(c["conflict_type"]),
                        existing_shape=c["existing_shape"],
                        incoming_shape=c["incoming_shape"],
                        suggested_resolution=ConflictResolution(c.get("suggested_resolution", "PENDING")),
                    )
                    conflicts.append(conflict)
                except Exception as field_err:
                    logger.warning(f"Skipping malformed conflict: {field_err}")

            return conflicts

        except Exception as e:
            logger.error(f"Conflict detection failed: {e}")
            return []

    def score_similarity(
        self,
        existing_object: dict,
        incoming_schema: dict,
        schema_a_id: str,
        object_type_id: str,
    ) -> SimilarityScore:
        """
        Score similarity between an incoming schema and an existing ObjectType.

        Returns SimilarityScore with composite score and decision metadata.
        """
        try:
            prompt = (
                SIMILARITY_SCORING_PROMPT
                .replace("{existing_object}", json.dumps(existing_object, indent=2)[:3000])
                .replace("{incoming_schema}", json.dumps(incoming_schema, indent=2)[:3000])
            )
            result = self._call(prompt)

            return SimilarityScore(
                schema_a_id=schema_a_id,
                object_type_id=object_type_id,
                field_name_overlap=float(result.get("field_name_overlap", 0.0)),
                semantic_type_overlap=float(result.get("semantic_type_overlap", 0.0)),
                sample_value_overlap=float(result.get("sample_value_overlap", 0.0)),
                primary_key_resolvable=bool(result.get("primary_key_resolvable", False)),
                conflicting_fields=result.get("conflicting_fields", []),
                composite_score=float(result.get("composite_score", 0.0)),
            )

        except Exception as e:
            logger.error(f"Similarity scoring failed: {e}")
            return SimilarityScore(
                schema_a_id=schema_a_id,
                object_type_id=object_type_id,
                field_name_overlap=0.0,
                semantic_type_overlap=0.0,
                sample_value_overlap=0.0,
                primary_key_resolvable=False,
                conflicting_fields=[],
                composite_score=0.0,
            )

    def suggest_object_type(
        self,
        incoming_schema: dict,
        existing_objects: list[dict],
    ) -> NewObjectProposal:
        """
        Suggest a new ObjectType when incoming schema doesn't match existing types.
        """
        try:
            prompt = (
                NEW_OBJECT_SUGGESTION_PROMPT
                .replace("{incoming_schema}", json.dumps(incoming_schema, indent=2)[:3000])
                .replace("{existing_objects}", json.dumps(existing_objects[:3], indent=2)[:2000])
            )
            result = self._call(prompt)

            suggested_properties = [
                ObjectProperty(
                    name=p["name"],
                    display_name=p.get("display_name", p["name"]),
                    semantic_type=SemanticType(p["semantic_type"]),
                    data_type=p.get("data_type", "string"),
                    pii_level=PiiLevel(p.get("pii_level", "NONE")),
                    required=p.get("required", False),
                    description=p.get("description"),
                )
                for p in result.get("suggested_properties", [])
            ]

            suggested_links = [
                OntologyLink(
                    source_object_type_id=result.get("suggested_name", "Unknown"),
                    target_object_type_id=link["target_object_type_id"],
                    relationship_type=link["relationship_type"],
                    join_keys=link.get("join_keys", []),
                    is_inferred=True,
                    confidence=link.get("confidence", 0.7),
                )
                for link in result.get("suggested_links", [])
            ]

            return NewObjectProposal(
                suggested_name=result.get("suggested_name", "NewObject"),
                suggested_properties=suggested_properties,
                suggested_links=suggested_links,
                parent_object_type_id=result.get("parent_object_type_id"),
                is_sub_type=result.get("is_sub_type", False),
                similarity_score=0.3,
                source_connector_id=incoming_schema.get("connector_id", "unknown"),
            )

        except Exception as e:
            logger.error(f"Object type suggestion failed: {e}")
            return NewObjectProposal(
                suggested_name="NewObject",
                suggested_properties=[],
                suggested_links=[],
                is_sub_type=False,
                similarity_score=0.0,
                source_connector_id=incoming_schema.get("connector_id", "unknown"),
            )


    def generate_app(
        self,
        description: str,
        object_type_id: str,
        object_type_name: str,
        properties: list[str],
        sample_rows: list[dict] | None = None,
    ) -> dict:
        """
        Generate a dashboard app layout from a natural language description.
        Returns a dict with 'app_name', 'app_description', 'icon', and 'components'.
        """
        sample_rows = sample_rows or []

        # Build a compact tabular preview: header + rows (truncate long values)
        def _truncate(v: object, n: int = 45) -> str:
            if v is None:
                return "NULL"
            if isinstance(v, list):
                if not v:
                    return "[]"
                if isinstance(v[0], dict):
                    # Show count + first item summary (title/subject/name)
                    first = v[0]
                    label = (
                        first.get("title") or first.get("subject") or
                        first.get("name") or first.get("overview", "")
                    )
                    label_s = str(label)[:25] if label else "..."
                    return f"[{len(v)} items: \"{label_s}\"]"
                return f"[{len(v)} items]"
            s = str(v)
            return s[:n] + "..." if len(s) > n else s

        sample_preview = ""
        if sample_rows:
            all_keys = list(dict.fromkeys(k for row in sample_rows for k in row))
            header = "\t".join(all_keys)
            rows_text = "\n".join(
                "\t".join(_truncate(row.get(k)) for k in all_keys)
                for row in sample_rows[:7]
            )
            sample_preview = f"\nSample data ({len(sample_rows)} rows shown):\n{header}\n{rows_text}"

        prompt = f"""You are a dashboard builder AI. Generate a JSON layout for a data dashboard.

User request: "{description}"

Object type: "{object_type_name}" (id: {object_type_id})
All available fields: {json.dumps(properties[:60])}{sample_preview}

Use the sample data above to understand what fields actually contain values and what they look like.
Only reference fields that appear in the sample data or the fields list.

Return JSON with this exact structure (no markdown, no extra text):
{{
  "app_name": "short descriptive name",
  "app_description": "one sentence",
  "icon": "",
  "components": [
    {{
      "id": "c1",
      "type": "kpi-banner",
      "title": "string",
      "objectTypeId": "{object_type_id}",
      "colSpan": 12
    }},
    {{
      "id": "c2",
      "type": "metric-card",
      "title": "string",
      "objectTypeId": "{object_type_id}",
      "field": "field_name_or_null",
      "aggregation": "count | sum | avg | max | min",
      "colSpan": 3
    }},
    {{
      "id": "c3",
      "type": "data-table",
      "title": "string",
      "objectTypeId": "{object_type_id}",
      "columns": ["field1", "field2", "field3"],
      "maxRows": 20,
      "colSpan": 12
    }},
    {{
      "id": "c4",
      "type": "bar-chart",
      "title": "string",
      "objectTypeId": "{object_type_id}",
      "labelField": "field_used_for_labels",
      "valueField": "field_used_for_values_or_null",
      "colSpan": 6
    }}
  ]
}}

Rules:
- colSpan must be 3, 4, 6, or 12
- Always start with one kpi-banner (colSpan 12)
- Add 2-4 metric-cards based on what makes sense from the user request
- Add a data-table with columns that are relevant to the user's request
- Add a bar-chart if the request mentions trends, grouping, or comparison
- Pick columns for the data-table that actually have data in the sample rows
- For count aggregation, field may be null or omitted"""

        result = self._call(prompt)
        return result

    def generate_widget(
        self,
        description: str,
        object_type_id: str,
        object_type_name: str,
        properties: list[str],
        sample_rows: list[dict] | None = None,
    ) -> dict:
        """
        Generate a single widget config from a natural language description.
        Returns a component config dict (same shape as AppComponent on the frontend).
        """
        sample_rows = sample_rows or []
        today = datetime.now().strftime("%Y-%m-%d")
        # Monday of the current week
        from datetime import timedelta
        now = datetime.now()
        week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%dT00:00:00")
        month_start = now.replace(day=1).strftime("%Y-%m-%dT00:00:00")

        sample_preview = ""
        if sample_rows:
            all_keys = list(dict.fromkeys(k for row in sample_rows for k in row))[:25]
            header = "\t".join(all_keys)
            rows_text = "\n".join(
                "\t".join(str(row.get(k, ""))[:35] for k in all_keys)
                for row in sample_rows[:5]
            )
            sample_preview = f"\nSample data:\n{header}\n{rows_text}"

        prompt = f"""You are a dashboard widget builder. Generate ONE widget config from a natural language request.

Today: {today}  |  Current week starts: {week_start}  |  Current month starts: {month_start}

User request: "{description}"

Object type: "{object_type_name}" (id: {object_type_id})
Available fields: {json.dumps(properties[:60])}{sample_preview}

Return a SINGLE JSON widget object (no markdown, no extra text):
{{
  "id": "w-auto",
  "type": "<one of: metric-card | data-table | bar-chart | line-chart | kpi-banner | chat-widget>",
  "title": "descriptive title based on the request",
  "objectTypeId": "{object_type_id}",
  "colSpan": <3 | 4 | 6 | 12>,
  "field": "field_name (metric-card only, omit otherwise)",
  "aggregation": "count | sum | avg | max | min (metric-card only)",
  "columns": ["f1","f2","f3"] "(data-table only)",
  "maxRows": 50,
  "labelField": "field (bar-chart only)",
  "valueField": "field (bar/line-chart only)",
  "xField": "date field (line-chart only)",
  "filters": [
    {{
      "id": "f1",
      "field": "field_name",
      "operator": "eq | neq | contains | gt | gte | lt | lte | after | before | is_empty | is_not_empty",
      "value": "value (ISO datetime for date filters)"
    }}
  ]
}}

Widget selection rules:
- "how many" / count query → metric-card with aggregation "count", colSpan 3
- "average / avg" → metric-card with aggregation "avg", colSpan 3
- "show me" / list → data-table, colSpan 12
- "by stage / by type / distribution / per stage" → bar-chart with labelField=<category field>, NO valueField (count mode), colSpan 6
- "over time / trend / per week / per day / moved per week" → line-chart with xField=<date field>, NO valueField (count per period), colSpan 6
- chat / ask / question → chat-widget, colSpan 12
- default to data-table if unclear

Field name rules — CRITICAL:
- Field names MUST be copied character-for-character from the "Available fields" list above
- NEVER invent or guess field names. If unsure which field to use, pick the closest one from the list
- The available fields list is authoritative — if a field is not in the list, do not use it
- Example: if the list has "hs_lastmodifieddate", never write "hs_last_modified_date"

Filter rules:
- "current week" → after "{week_start}"
- "this month" → after "{month_start}"
- "today" → after "{today}T00:00:00"
- "last N days" → after the correct ISO date
- "stage X" → eq filter on the stage/status field
- Date fields in this dataset are ISO strings — use after/before operators

Line-chart rules:
- For "per week / per day / over time" with NO explicit numeric value → omit valueField entirely (the renderer groups by date and counts)
- xField must be a date field from the available fields list

Bar-chart rules:
- For "per stage / by category / distribution" with NO explicit numeric value → omit valueField entirely (the renderer counts per label)
- labelField must be the grouping/category field

Only include keys relevant to the widget type. Omit null/empty keys entirely."""

        result = self._call(prompt)
        return result

    def generate_code_widget(
        self,
        description: str,
        object_type_id: str,
        object_type_name: str,
        properties: list[str],
        sample_rows: list[dict] | None = None,
    ) -> dict:
        """
        Generate a custom-code widget — Claude writes React.createElement code
        that can render anything the user asks for, not limited to pre-built types.
        Returns a component dict with type='custom-code' and a 'code' field.
        """
        sample_rows = sample_rows or []
        today = datetime.now().strftime("%Y-%m-%d")
        from datetime import timedelta
        now = datetime.now()
        week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%dT00:00:00")

        sample_preview = ""
        if sample_rows:
            all_keys = list(dict.fromkeys(k for row in sample_rows for k in row))[:25]
            header = "\t".join(all_keys)
            rows_text = "\n".join(
                "\t".join(str(row.get(k, ""))[:40] for k in all_keys)
                for row in sample_rows[:5]
            )
            sample_preview = f"\nSample data ({len(sample_rows)} rows):\n{header}\n{rows_text}"

        prompt = f"""You are a dashboard code generator. Generate a JavaScript function body for a custom widget.

Today: {today}  |  Current week starts: {week_start}
User request: "{description}"
Object type: "{object_type_name}" (id: {object_type_id})
Available fields: {json.dumps(properties[:60])}{sample_preview}

TASK: Write JavaScript code (no JSX, no imports, no export) that:
1. Receives these variables: React (the React object), records (array of data objects), fields (array of field names), title (string)
2. Does whatever the user requested (filtering, grouping, calculations, custom visualization)
3. Returns a React element tree using React.createElement()

RULES:
- Use ONLY React.createElement(), never JSX syntax (no < > tags)
- Use only vanilla JS — no imports, no require(), no external libs
- Field names must match exactly from the Available fields list
- For date comparisons, parse with new Date()
- For colors use: primary=#7C3AED, success=#16A34A, danger=#DC2626, muted=#94A3B8, border=#E2E8F0
- Keep the UI clean and minimal — use padding 12-16px, font-size 12-13px
- Always wrap in a div with style={{padding:'12px', height:'100%', overflow:'auto', boxSizing:'border-box'}}
- Handle empty data gracefully (check records.length)

EXAMPLE pattern for a ranked list:
  var items = records.slice(0, 10);
  return React.createElement('div', {{style:{{padding:'12px'}}}},
    React.createElement('div', {{style:{{fontWeight:600,marginBottom:'8px',fontSize:'13px'}}}}, title),
    items.map(function(r, i) {{
      return React.createElement('div', {{key:i, style:{{...}}}}, r.fieldname);
    }})
  );

Return ONLY valid JSON (no markdown):
{{
  "id": "w-auto",
  "type": "custom-code",
  "title": "descriptive title",
  "objectTypeId": "{object_type_id}",
  "colSpan": <6 or 12>,
  "gridH": <4, 5, 6, or 8>,
  "code": "...the full JavaScript function body as a single-line string with \\n for newlines..."
}}

The 'code' value must be a JSON string — escape all double quotes as \\", newlines as \\n."""

        result = self._call(prompt)
        return result

    def chat_with_data(
        self,
        question: str,
        object_type_id: str,
        object_type_name: str,
        fields: list[str],
        records: list[dict],
        total_count: int | None = None,
        dashboard_widgets: list[dict] | None = None,
    ) -> str:
        """Two-pass approach: Claude plans the query from 5 samples, then answers from real results."""
        if not self.client:
            raise ValueError("Anthropic API key not configured")

        today = datetime.now().strftime("%Y-%m-%d")
        total = total_count if total_count is not None else len(records)
        sample = records[:5]

        # ── Pass 1: Query planning ────────────────────────────────────────────
        sample_json = json.dumps(sample, indent=2)[:3000]
        plan_prompt = f"""You are a data query planner. Today is {today}.
Dataset: {object_type_name} ({total} total records)
Available fields: {json.dumps(fields[:60])}
Sample records (5 of {total}):
{sample_json}

User question: {question}

Respond ONLY with valid JSON (no explanation, no markdown):
{{
  "filters": [{{"field": "field_name", "operator": "eq|neq|contains|gt|gte|lt|lte|after|before|is_empty|is_not_empty", "value": "string_value"}}],
  "groupBy": "field_name or null",
  "aggregation": "count|sum|avg|max|min or null",
  "aggregationField": "field_name or null",
  "sortBy": "field_name or null",
  "sortDir": "asc or desc",
  "limit": 200,
  "selectFields": ["field1", "field2"]
}}

Rules:
- filters: use field names exactly as listed above. For date fields, values must be ISO strings like "2026-03-17T00:00:00". Use "after" for "since/this week/today". Empty array if no filter needed.
- groupBy: field to group by for aggregations. null if not needed.
- aggregation: use "count" for "how many", "sum"/"avg" for numeric questions. null to return raw rows.
- selectFields: list the fields the user cares about. Empty array = all fields.
- limit: max records to return after filtering (default 200)
"""
        plan_response = self.client.messages.create(
            model=MODEL,
            max_tokens=512,
            system="You are a data query planner. Output only valid JSON.",
            messages=[{"role": "user", "content": plan_prompt}],
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          plan_response.usage.input_tokens, plan_response.usage.output_tokens)
        plan_text = plan_response.content[0].text.strip()
        # Strip markdown code fences if present
        if plan_text.startswith("```"):
            plan_text = "\n".join(plan_text.split("\n")[1:])
            plan_text = plan_text.rsplit("```", 1)[0]

        try:
            plan = json.loads(plan_text)
        except Exception:
            plan = {"filters": [], "groupBy": None, "aggregation": None,
                    "aggregationField": None, "sortBy": None, "sortDir": "asc",
                    "limit": 200, "selectFields": []}

        import logging as _logging
        _logging.getLogger("chat_with_data").info(f"Query plan: {json.dumps(plan)}")

        # ── Apply query plan ─────────────────────────────────────────────────
        result = _apply_query_plan(records, plan, fields)

        # Fallback: if filtering yields 0 results but there are records, include all records
        # so Claude can see what's actually available and give a useful answer
        fallback_note = ""
        if isinstance(result, list) and len(result) == 0 and len(records) > 0:
            result = records[:50]
            fallback_note = (
                f"\n\nNOTE: The query filter returned 0 results, so ALL {len(result)} records are shown below. "
                "The records DO exist — the filter may have been too restrictive. "
                "Look at the actual data and answer based on what you see. Do NOT say 'no records found'."
            )

        # ── Pass 2: Answer ────────────────────────────────────────────────────
        def _trunc(v: object, n: int = 80) -> str:
            if v is None: return "null"
            if isinstance(v, list): return f"[{len(v)} items]"
            s = str(v); return s[:n] + "…" if len(s) > n else s

        if isinstance(result, list):
            keys = list(dict.fromkeys(k for row in result[:50] for k in row))[:30]
            header = " | ".join(keys)
            rows_txt = "\n".join(" | ".join(_trunc(row.get(k)) for k in keys) for row in result[:50])
            result_section = f"{len(result)} records:\n{header}\n{rows_txt}"
        else:
            result_section = json.dumps(result, indent=2)

        fields_json = json.dumps(fields[:40])
        widget_guide = (
            "\n\nOPTIONAL — embed a widget when it adds real value:\n"
            "- bar-chart: {\"type\":\"bar-chart\",\"title\":\"...\",\"objectTypeId\":\"OBJ_ID\",\"labelField\":\"FIELD\",\"colSpan\":12,\"gridH\":5}\n"
            "- metric-card: {\"type\":\"metric-card\",\"title\":\"...\",\"objectTypeId\":\"OBJ_ID\",\"field\":\"FIELD\",\"aggregation\":\"count\",\"colSpan\":6,\"gridH\":3}\n"
            "- data-table: {\"type\":\"data-table\",\"title\":\"...\",\"objectTypeId\":\"OBJ_ID\",\"columns\":[\"F1\",\"F2\"],\"colSpan\":12,\"gridH\":6}\n"
            f"Replace OBJ_ID with \"{object_type_id}\". Field names from: {fields_json}. Max 2 widgets."
        )

        # Build dashboard context section if widgets are provided
        dashboard_section = ""
        if dashboard_widgets:
            widget_lines = []
            for w in dashboard_widgets:
                wtype = w.get("type", "unknown")
                wtitle = w.get("title", "Untitled")
                parts = [f"- **{wtitle}** ({wtype})"]
                if w.get("field"):
                    parts.append(f"field={w['field']}")
                if w.get("aggregation"):
                    parts.append(f"agg={w['aggregation']}")
                if w.get("labelField"):
                    parts.append(f"labels={w['labelField']}")
                if w.get("valueField"):
                    parts.append(f"values={w['valueField']}")
                if w.get("columns"):
                    parts.append(f"cols={','.join(w['columns'][:5])}")
                if w.get("filterField"):
                    parts.append(f"filter={w['filterField']}")
                widget_lines.append(" | ".join(parts))
            dashboard_section = (
                "\n\nDASHBOARD CONTEXT — the user is looking at a dashboard with these widgets:\n"
                + "\n".join(widget_lines)
                + "\nWhen the user asks about what they see, refer to these widgets. "
                "You can reference widget titles and explain what the data in them means."
            )

        message = self.client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=(
                f"You are a data analyst. Today is {today}. Dataset: {object_type_name} ({total} total records). "
                "Use GFM markdown: **bold** key values, ## headers, bullet lists, pipe tables. "
                "Be specific with numbers and examples from the data."
                + widget_guide
                + dashboard_section
            ),
            messages=[{
                "role": "user",
                "content": f"Question: {question}{fallback_note}\n\nQuery results ({object_type_name}):\n{result_section}",
            }],
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          message.usage.input_tokens, message.usage.output_tokens)
        return message.content[0].text

    # ------------------------------------------------------------------
    # Async AI Copilot methods (Phase 8)
    # ------------------------------------------------------------------

    async def create_pipeline_from_description(
        self, description: str, connectors: list, object_types: list
    ) -> dict:
        """Generate a pipeline config from natural language description."""
        from anthropic import AsyncAnthropic

        async_client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

        prompt = f"""You are building a data pipeline configuration for Nexus platform.

Available connectors:
{json.dumps(connectors, indent=2)}

Available object types (data targets):
{json.dumps(object_types, indent=2)}

User request: {description}

## Node types (use EXACTLY these uppercase values for "type"):
- SOURCE — pull data from a connector. Config: {{"connector_id":"<id>","endpoint":"<path>","method":"GET","poll_frequency":"5m"}}. Use "method":"POST" when the endpoint requires POST (e.g. scrape triggers). Default is GET.
- FILTER — filter records. Config: {{"field":"<name>","operator":"==","value":"<val>"}}
- MAP — rename/transform fields. Config: {{"mappings":[{{"from":"src","to":"dst"}}]}}
- CAST — change field types. Config: {{"casts":[{{"field":"name","toType":"string"}}]}}
- ENRICH — add computed fields. Config: {{"enrichments":[]}}
- FLATTEN — flatten nested arrays. Config: {{"arrayField":"items","prefix":"item"}}
- DEDUPE — remove duplicates. Config: {{"keys":["field1"]}}
- VALIDATE — validate records. Config: {{"rules":[]}}
- LLM_CLASSIFY — AI classification. Config: {{"textField":"<field>","prompt":"<optional>","batchSize":10,"createActions":true}}
- SINK_OBJECT — write to ontology object type. Config: {{"objectTypeId":"<id>","objectTypeName":"<name>"}}
- SINK_EVENT — write to process mining event log. Config: {{"objectTypeId":"<id>","caseIdField":"<field>","activityField":"<field>","timestampField":"<field>"}}
- AGENT_RUN — trigger an AI agent. Config: {{"agentId":"<id>"}}

Generate a pipeline as JSON. Each node needs id, type (UPPERCASE), label, config, and position ({{x:0, y:N*120}}).
Edges connect nodes sequentially via source/target node IDs.

{{
  "name": "Pipeline Name",
  "description": "what it does",
  "status": "DRAFT",
  "nodes": [...],
  "edges": [...],
  "tenant_id": "tenant-001"
}}

Return ONLY valid JSON. No markdown, no explanation."""

        message = await async_client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            messages=[{"role": "user", "content": prompt}],
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          message.usage.input_tokens, message.usage.output_tokens)
        content = message.content[0].text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)

    async def create_logic_function(
        self, description: str, object_types: list, existing_functions: list
    ) -> dict:
        """Generate a logic function config from natural language description."""
        from anthropic import AsyncAnthropic

        async_client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

        prompt = f"""You are building a Logic Function for Nexus platform. Logic Functions are automated workflows composed of blocks.

Available object types and their fields:
{json.dumps(object_types, indent=2)}

Existing functions (for reference/calling):
{json.dumps([f['name'] for f in existing_functions], indent=2)}

User request: {description}

Generate a logic function as JSON:
{{
  "name": "descriptive function name",
  "description": "what this function does",
  "blocks": [
    {{
      "id": "block-1",
      "type": "ontology_query",
      "label": "Fetch Records",
      "config": {{
        "object_type_id": "<id>",
        "filters": [],
        "limit": 100
      }}
    }},
    {{
      "id": "block-2",
      "type": "llm",
      "label": "AI Analysis",
      "config": {{
        "prompt": "Analyze this data: {{{{input}}}}",
        "model": "claude-haiku-4-5-20251001"
      }}
    }},
    {{
      "id": "block-3",
      "type": "condition",
      "label": "Check Result",
      "config": {{
        "expression": "output.length > 0"
      }}
    }}
  ],
  "block_order": ["block-1", "block-2", "block-3"]
}}

Available block types: ontology_query, llm, condition, http_request, transform, notification, email
Return ONLY valid JSON."""

        message = await async_client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            messages=[{"role": "user", "content": prompt}],
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          message.usage.input_tokens, message.usage.output_tokens)
        content = message.content[0].text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)

    async def explain_lineage(
        self, nodes: list, edges: list, focus_node_id: str | None
    ) -> dict:
        """Analyze a data lineage graph and explain it in plain English."""
        from anthropic import AsyncAnthropic

        async_client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

        node_map = {n["id"]: n for n in nodes}
        graph_lines = []
        for edge in edges:
            src = node_map.get(edge["source"], {})
            tgt = node_map.get(edge["target"], {})
            graph_lines.append(
                f"{src.get('type','?')}:{src.get('label','?')} "
                f"--[{edge.get('label','')}]--> "
                f"{tgt.get('type','?')}:{tgt.get('label','?')}"
            )

        focus_info = ""
        if focus_node_id and focus_node_id in node_map:
            n = node_map[focus_node_id]
            focus_info = (
                f"\nUser is focused on: {n['type']}:{n['label']} "
                f"(status: {n.get('status','unknown')})"
            )

        prompt = f"""You are a data lineage expert for Nexus platform. Analyze this data lineage graph and explain it clearly.

Lineage Graph ({len(nodes)} nodes, {len(edges)} edges):
{chr(10).join(graph_lines) or 'No edges — isolated nodes only'}

All nodes: {json.dumps([{{'type': n['type'], 'label': n['label'], 'status': n.get('status')}} for n in nodes], indent=2)}
{focus_info}

Provide:
1. A plain-English explanation of the data flow (2-3 sentences)
2. Any issues or anomalies detected (orphan nodes, broken flows, inactive components)
3. Key observations about the pipeline health

Return JSON:
{{
  "explanation": "markdown string explaining the data flow",
  "findings": [
    {{"type": "warning|info|error", "title": "...", "description": "...", "node": "optional node label"}}
  ]
}}"""

        message = await async_client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            messages=[{"role": "user", "content": prompt}],
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          message.usage.input_tokens, message.usage.output_tokens)
        content = message.content[0].text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)

    async def surface_anomalies(
        self, object_type_name: str, fields: list, records: list
    ) -> dict:
        """Analyze a dataset for anomalies and data quality issues."""
        from anthropic import AsyncAnthropic

        async_client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))

        stats = {}
        for field in fields:
            values = [r.get(field) for r in records if r.get(field) is not None]
            null_count = len(records) - len(values)
            stats[field] = {
                "total": len(records),
                "non_null": len(values),
                "null_pct": round(null_count / len(records) * 100, 1) if records else 0,
                "unique_count": len(set(str(v) for v in values)),
                "sample": values[:5],
            }

        prompt = f"""You are a data quality analyst. Analyze this dataset for anomalies and data quality issues.

Object Type: {object_type_name}
Record Count: {len(records)}

Field Statistics:
{json.dumps(stats, indent=2)}

Sample Records (first 10):
{json.dumps(records[:10], indent=2, default=str)}

Identify:
1. Fields with high null rates (>20%)
2. Fields with suspiciously low cardinality (might be miscategorized)
3. Fields that look like they contain PII unexpectedly
4. Outlier patterns or inconsistencies
5. Fields where values don't match expected format

Return JSON:
{{
  "summary": "2-3 sentence overall data quality assessment",
  "anomalies": [
    {{
      "field": "field_name",
      "type": "null_rate|low_cardinality|pii_risk|format_mismatch|outlier",
      "severity": "high|medium|low",
      "description": "clear explanation of the issue",
      "affected_count": 0,
      "recommendation": "what to do about it"
    }}
  ]
}}

Return ONLY valid JSON."""

        message = await async_client.messages.create(
            model=MODEL,
            max_tokens=2048,
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            messages=[{"role": "user", "content": prompt}],
        )
        track_token_usage(self.tenant_id, "inference_service", MODEL,
                          message.usage.input_tokens, message.usage.output_tokens)
        content = message.content[0].text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)


def _safe_floats(values) -> list[float]:
    """Convert an iterable of values to floats, silently skipping non-numeric ones (e.g. datetimes)."""
    result = []
    for v in values:
        if v is None:
            continue
        try:
            result.append(float(str(v)))
        except (ValueError, TypeError):
            pass
    return result


def _apply_query_plan(records: list[dict], plan: dict, fields: list[str]) -> object:
    """Apply a Claude-generated query plan to a list of records."""
    import re
    from datetime import datetime as _dt

    def _coerce(raw) -> tuple:
        s = str(raw) if raw is not None else ""
        try: num = float(s)
        except: num = None
        date = None
        if re.search(r'\d{4}-\d{2}-\d{2}', s):
            try: date = _dt.fromisoformat(s.replace("Z",""))
            except: pass
        elif re.match(r'^\d{10,13}$', s.strip()):
            ms = int(s) * (1000 if len(s) <= 10 else 1)
            try: date = _dt.fromtimestamp(ms / 1000)
            except: pass
        return s, num, date

    def _matches(rec, f):
        raw = rec.get(f.get("field",""))
        s, num, date = _coerce(raw)
        op = f.get("operator","eq")
        fv = str(f.get("value",""))
        try: fv_num = float(fv)
        except: fv_num = None
        fv_date = None
        if re.search(r'\d{4}-\d{2}-\d{2}', fv):
            try: fv_date = _dt.fromisoformat(fv.replace("Z",""))
            except: pass
        if op == "eq": return s == fv
        if op == "neq": return s != fv
        if op == "contains": return fv.lower() in s.lower()
        if op == "not_contains": return fv.lower() not in s.lower()
        if op == "gt": return (num > fv_num) if (num is not None and fv_num is not None) else s > fv
        if op == "gte": return (num >= fv_num) if (num is not None and fv_num is not None) else s >= fv
        if op == "lt": return (num < fv_num) if (num is not None and fv_num is not None) else s < fv
        if op == "lte": return (num <= fv_num) if (num is not None and fv_num is not None) else s <= fv
        if op == "after": return (date > fv_date) if (date and fv_date) else s > fv
        if op == "before": return (date < fv_date) if (date and fv_date) else s < fv
        if op == "is_empty": return s == "" or raw is None
        if op == "is_not_empty": return s != "" and raw is not None
        return True

    # Filter
    filters = plan.get("filters") or []
    filtered = [r for r in records if all(_matches(r, f) for f in filters)] if filters else records

    # Select fields
    select = plan.get("selectFields") or []
    if select:
        filtered = [{k: r.get(k) for k in select} for r in filtered]

    # Sort
    sort_by = plan.get("sortBy")
    sort_dir = plan.get("sortDir", "asc")
    if sort_by:
        def _sort_key(r):
            v = r.get(sort_by)
            _, num, date = _coerce(v)
            if date: return (2, date)
            if num is not None: return (1, num)
            return (0, str(v) if v is not None else "")
        filtered.sort(key=_sort_key, reverse=(sort_dir == "desc"))

    # Limit
    limit = plan.get("limit") or 200
    filtered = filtered[:limit]

    # Aggregate
    agg = plan.get("aggregation")
    group_by = plan.get("groupBy")
    agg_field = plan.get("aggregationField")

    if agg and group_by:
        groups: dict = {}
        for r in filtered:
            key = str(r.get(group_by, ""))
            if key not in groups: groups[key] = []
            groups[key].append(r)
        result = {}
        for key, rows in groups.items():
            if agg == "count":
                result[key] = len(rows)
            elif agg_field:
                vals = _safe_floats(r.get(agg_field) for r in rows)
                if agg == "sum": result[key] = sum(vals)
                elif agg == "avg": result[key] = sum(vals)/len(vals) if vals else 0
                elif agg == "max": result[key] = max(vals) if vals else 0
                elif agg == "min": result[key] = min(vals) if vals else 0
        return result
    elif agg and not group_by:
        if agg == "count": return {"count": len(filtered)}
        if agg_field:
            vals = _safe_floats(r.get(agg_field) for r in filtered)
            if agg == "sum": return {"sum": sum(vals), "field": agg_field}
            if agg == "avg": return {"avg": sum(vals)/len(vals) if vals else 0, "field": agg_field}
            if agg == "max": return {"max": max(vals) if vals else 0, "field": agg_field}
            if agg == "min": return {"min": min(vals) if vals else 0, "field": agg_field}
    return filtered


def _hash_schema(schema: dict) -> str:
    """Compute a stable hash of a schema dict."""
    import hashlib
    import json
    serialized = json.dumps(schema, sort_keys=True)
    return "sha256:" + hashlib.sha256(serialized.encode()).hexdigest()[:16]


def _default_app_layout(
    object_type_id: str,
    object_type_name: str,
    properties: list[str],
    description: str,
    sample_rows: list[dict] | None = None,
) -> dict:
    """Fallback template-based app layout when Claude is unavailable."""
    from uuid import uuid4

    # Pick sensible columns — avoid array fields
    flat_props = [p for p in properties if not p.endswith('[]')]
    table_cols = flat_props[:8] if flat_props else []
    name_field = next((p for p in flat_props if p in ('name', 'company_name', 'firstname', 'title')), flat_props[0] if flat_props else None)

    components = [
        {
            "id": "c1",
            "type": "kpi-banner",
            "title": f"{object_type_name} Overview",
            "objectTypeId": object_type_id,
            "colSpan": 12,
        },
        {
            "id": "c2",
            "type": "metric-card",
            "title": "Total Records",
            "objectTypeId": object_type_id,
            "aggregation": "count",
            "colSpan": 3,
        },
    ]

    if name_field:
        components.append({
            "id": "c3",
            "type": "bar-chart",
            "title": f"Records by {name_field}",
            "objectTypeId": object_type_id,
            "labelField": name_field,
            "colSpan": 12,
        })

    if table_cols:
        components.append({
            "id": "c4",
            "type": "data-table",
            "title": f"All {object_type_name} Records",
            "objectTypeId": object_type_id,
            "columns": table_cols,
            "maxRows": 20,
            "colSpan": 12,
        })

    return {
        "app_name": f"{object_type_name} Dashboard",
        "app_description": description or f"Overview of {object_type_name} data",
        "icon": "",
        "components": components,
    }


def _mock_inference_result(connector_id: str, schema: dict, schema_hash: str) -> InferenceResult:
    """Return a mock inference result when Claude is unavailable."""
    return InferenceResult(
        connector_id=connector_id,
        fields=[
            FieldInference(
                source_field="id",
                suggested_name="record_id",
                semantic_type=SemanticType.IDENTIFIER,
                data_type="string",
                pii_level=PiiLevel.NONE,
                confidence=0.99,
                reasoning="Field named 'id' — universal identifier pattern",
                sample_values=[],
                nullable=False,
            ),
            FieldInference(
                source_field="name",
                suggested_name="name",
                semantic_type=SemanticType.TEXT,
                data_type="string",
                pii_level=PiiLevel.LOW,
                confidence=0.85,
                reasoning="Generic 'name' field — likely an entity name",
                sample_values=[],
                nullable=True,
            ),
        ],
        suggested_object_type_name="InferredObject",
        overall_confidence=0.75,
        raw_schema_hash=schema_hash,
        warnings=["Using mock inference — ANTHROPIC_API_KEY not configured"],
    )
