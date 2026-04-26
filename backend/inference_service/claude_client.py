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
from shared.llm_router import (
    resolve_provider,
    resolve_provider_sync,
    make_anthropic_client,
    make_async_anthropic_client,
    chat_text_sync,
    chat_text_async,
)

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
MAX_TOKENS = 4096


# ── Schema-shape detection ──────────────────────────────────────────────────
# Helper used by every generator prompt. Sniffs a sample of records to figure
# out whether the object type is in entity-attribute-value (EAV) shape — one
# row per measurement event with the metric name in a column, the value in
# another column. Sensor data, custom-field tables, observability logs all
# look like this. The AI's training assumes wide-format tables, so without a
# hint it generates `SUM(value)` aggregations that mix RPM with running flags.

_ATTRIBUTE_NAME_HINTS = {
    "field", "metric", "metric_name", "metric_type", "measurement", "kpi",
    "attribute", "attr", "key", "tag", "type", "reading_type", "signal",
    "sensor_type", "channel", "param", "parameter",
    # "name" intentionally excluded — too generic, false-positives on
    # entity tables (customer.name, sensor.name, etc.).
}
_VALUE_NAME_HINTS = {
    "value", "val", "reading", "data", "amount", "measurement",
    "magnitude", "quantity",
}
_NUMERIC_RE = re.compile(r"^-?\d+(\.\d+)?$") if False else None  # see below; not used


def _detect_eav_pattern(sample_rows: list[dict]) -> dict | None:
    """
    Returns {'attribute_col': str, 'value_col': str, 'metrics': [..], 'preview': [..]}
    when the sample looks like long-format / EAV data, else None.

    Detection heuristic:
      - A column whose name suggests an attribute/metric label
        (field/metric/measurement/attribute/etc.) AND has 2–30 distinct
        short string values.
      - A separate column whose name suggests a value
        (value/reading/data/amount/etc.) AND contains a mix of numeric and
        non-numeric values, OR purely numeric values that vary per attribute
        (different metrics having different scales).
    """
    import re as _re
    if not sample_rows or len(sample_rows) < 5:
        return None

    keys: list[str] = []
    distinct: dict[str, set[str]] = {}
    counts: dict[str, int] = {}
    for row in sample_rows:
        for k, v in (row or {}).items():
            if k not in distinct:
                distinct[k] = set()
                counts[k] = 0
                keys.append(k)
            if v is not None and v != "":
                distinct[k].add(str(v))
                counts[k] += 1

    # Find attribute column. Criteria:
    #   - Name hint matches (field / metric / measurement / etc.)
    #   - 2..30 distinct values (low cardinality, looks like a metric label)
    #   - Recurrence: average appearances per value >= 1.5, so we don't
    #     false-positive on a `name` column where each row is its own entity
    #     (1 distinct value per row → ratio 1.0).
    attr_col: str | None = None
    for k in keys:
        kl = k.lower()
        if kl not in _ATTRIBUTE_NAME_HINTS:
            continue
        vals = distinct[k]
        if not (2 <= len(vals) <= 30):
            continue
        if not all(len(v) <= 40 for v in vals):
            continue
        recurrence = counts[k] / max(len(vals), 1)
        if recurrence < 1.5:
            continue
        attr_col = k
        break

    if not attr_col:
        return None

    # Find value column (different from attr)
    numeric_re = _re.compile(r"^-?\d+(\.\d+)?$")
    value_col: str | None = None
    for k in keys:
        if k == attr_col:
            continue
        kl = k.lower()
        if kl not in _VALUE_NAME_HINTS:
            continue
        vals = distinct[k]
        if not vals:
            continue
        numeric_count = sum(1 for v in vals if numeric_re.match(v))
        # Either: at least one numeric (the typical sensor case), or pure
        # numeric with widely varying ranges (different metrics)
        if numeric_count >= 1:
            value_col = k
            break

    if not value_col:
        return None

    # Build a preview of one row per metric so the AI sees the structure
    seen_attrs: set[str] = set()
    preview: list[dict] = []
    for row in sample_rows:
        attr = row.get(attr_col)
        if attr is None or str(attr) in seen_attrs:
            continue
        seen_attrs.add(str(attr))
        preview.append({attr_col: attr, value_col: row.get(value_col)})
        if len(preview) >= 6:
            break

    return {
        "attribute_col": attr_col,
        "value_col": value_col,
        "metrics": sorted(distinct[attr_col]),
        "preview": preview,
    }


def _eav_prompt_section(sample_rows: list[dict]) -> str:
    """Format the EAV hint as a prompt section. Empty string when not EAV."""
    eav = _detect_eav_pattern(sample_rows)
    if not eav:
        return ""
    metrics_csv = ", ".join(eav["metrics"][:20])
    preview_lines = "\n".join(
        f"  {row[eav['attribute_col']]:<15s}  {eav['value_col']}={row.get(eav['value_col'])}"
        for row in eav["preview"]
    )
    return (
        "\n\nDETECTED PATTERN — Entity-Attribute-Value (EAV) / long-format:\n"
        f"  Attribute column: \"{eav['attribute_col']}\" (categorical)\n"
        f"  Value column:     \"{eav['value_col']}\" (mixed types — numeric for some\n"
        f"                    metrics, strings for others)\n"
        f"  Distinct metrics: {metrics_csv}\n"
        f"  One row per metric:\n{preview_lines}\n"
        "\n"
        "EACH row is ONE measurement event, NOT a record with all metrics.\n"
        "Different rows have different metrics in the attribute column.\n"
        "\n"
        "RULES for this kind of data:\n"
        f"  1. When the user asks for a chart on a specific metric (e.g. \"RPM\",\n"
        f"     \"temperature\"), you MUST add a filter on the attribute column:\n"
        f"     {{\"field\": \"{eav['attribute_col']}\", \"operator\": \"eq\", \"value\": \"<METRIC>\"}}\n"
        f"  2. Use \"{eav['value_col']}\" as the valueField, with aggregation=avg\n"
        f"     (or sum for counter-style metrics).\n"
        f"  3. NEVER aggregate \"{eav['value_col']}\" without the attribute filter —\n"
        "     it would mix metrics of different units and scales.\n"
        "  4. For \"all metrics over time\" requests, generate ONE chart per metric\n"
        "     (e.g. one line-chart for RPM, one for temperature, one for running).\n"
        "     Or use multi-series with labelField on a sub-attribute (e.g.\n"
        "     sensor_name) and a single attribute filter.\n"
        "  5. Counter-style flags (running=1) are best aggregated with method=count\n"
        "     and the filter value=1, NOT sum/avg.\n"
    )


class ClaudeInferenceClient:
    """Wrapper around the Anthropic SDK for structured schema inference tasks."""

    def __init__(self):
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        if not api_key:
            logger.warning("ANTHROPIC_API_KEY not set — inference will use mock responses unless tenant has a provider configured")
        self.client = anthropic.Anthropic(api_key=api_key) if api_key else None
        self.tenant_id: str = "unknown"

    def _resolve_sync(self) -> tuple:
        """Resolve per-tenant Anthropic client + model for legacy sync paths.
        Falls back to env-based Anthropic when the resolved provider isn't Anthropic.
        Prefer _chat_sync for new code so non-Anthropic providers route correctly.
        """
        try:
            cfg = resolve_provider_sync(self.tenant_id)
            if cfg.provider_type == "anthropic" and cfg.api_key:
                return make_anthropic_client(cfg), cfg.model
        except Exception as exc:
            logger.warning("Sync provider resolve failed for %s: %s", self.tenant_id, exc)
        return self.client, MODEL

    async def _resolve_async(self) -> tuple:
        """Async variant — see _resolve_sync caveat."""
        try:
            cfg = await resolve_provider(self.tenant_id)
            if cfg.provider_type == "anthropic" and cfg.api_key:
                return make_async_anthropic_client(cfg), cfg.model
        except Exception as exc:
            logger.warning("Async provider resolve failed for %s: %s", self.tenant_id, exc)
        from anthropic import AsyncAnthropic
        return AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", "")), MODEL

    def _chat_sync(self, system: str, user_content: str, max_tokens: int = MAX_TOKENS) -> tuple[str, str]:
        """Cross-provider synchronous text chat. Returns (text, model_name)."""
        try:
            cfg = resolve_provider_sync(self.tenant_id)
        except Exception:
            cfg = None
        if cfg is None or not cfg.api_key and cfg.provider_type != "local":
            if not self.client:
                raise ValueError("No LLM provider configured for this tenant and ANTHROPIC_API_KEY is unset")
            msg = self.client.messages.create(
                model=MODEL, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": user_content}],
            )
            track_token_usage(self.tenant_id, "inference_service", MODEL,
                              msg.usage.input_tokens, msg.usage.output_tokens)
            return msg.content[0].text, MODEL

        result = chat_text_sync(cfg, system, user_content, max_tokens=max_tokens)
        track_token_usage(self.tenant_id, "inference_service", result["model"],
                          result["input_tokens"], result["output_tokens"])
        return result["text"], result["model"]

    async def _chat_async(self, system: str, user_content: str, max_tokens: int = MAX_TOKENS) -> tuple[str, str]:
        """Cross-provider async text chat. Returns (text, model_name)."""
        try:
            cfg = await resolve_provider(self.tenant_id)
        except Exception:
            cfg = None
        if cfg is None or (not cfg.api_key and cfg.provider_type != "local"):
            from anthropic import AsyncAnthropic
            client = AsyncAnthropic(api_key=os.environ.get("ANTHROPIC_API_KEY", ""))
            msg = await client.messages.create(
                model=MODEL, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": user_content}],
            )
            track_token_usage(self.tenant_id, "inference_service", MODEL,
                              msg.usage.input_tokens, msg.usage.output_tokens)
            return msg.content[0].text, MODEL

        result = await chat_text_async(cfg, system, user_content, max_tokens=max_tokens)
        track_token_usage(self.tenant_id, "inference_service", result["model"],
                          result["input_tokens"], result["output_tokens"])
        return result["text"], result["model"]

    def _call(self, prompt: str) -> dict:
        """Make a Claude API call and parse JSON response."""
        text, _model = self._chat_sync(
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            user_content=prompt,
        )

        content = text.strip()
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

        eav_section = _eav_prompt_section(sample_rows)

        prompt = f"""You are a dashboard builder AI. Generate a JSON layout for a data dashboard.

User request: "{description}"

Object type: "{object_type_name}" (id: {object_type_id})
All available fields: {json.dumps(properties[:60])}{sample_preview}{eav_section}

Use the sample data above to understand what fields actually contain values and what they look like.
Only reference fields that appear in the sample data or the fields list.

CRITICAL — DATA SCALE: this object type may contain millions of rows.
The dashboard NEVER pulls raw rows for charts or metric cards. Each widget you
generate is rendered by the frontend as a single SQL-shaped query against the
server's /aggregate endpoint. Your job is to pick the right groupBy, valueField,
and time bucket so the server returns at most ~50 numbers per widget. Picking
the wrong field is fine; picking a field that doesn't exist in the list will
fail. Picking labelField/valueField that produce 100k unique groups is wrong —
prefer low-cardinality categorical fields (status, type, category, region) for
groupBy, and date fields for time-bucketed charts.

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
    }},
    {{
      "id": "c5",
      "type": "line-chart",
      "title": "MetricName per Series — Time Range",
      "objectTypeId": "{object_type_id}",
      "xField": "date_field",
      "valueField": "value_field",
      "labelField": "series_field (e.g. sensor_name) for multi-series",
      "timeBucket": "hour",
      "aggregation": "avg",
      "xAxisRange": "last_24h",
      "filters": [{{"field": "<attribute_col>", "operator": "eq", "value": "<metric>"}}],
      "colSpan": 12
    }},
    {{
      "id": "c6",
      "type": "pivot-table",
      "title": "X per Y per Day",
      "objectTypeId": "{object_type_id}",
      "labelField": "row_field (e.g. sensor_name)",
      "xField": "date_field",
      "valueField": "value_field_or_null_for_count",
      "timeBucket": "day",
      "aggregation": "count",
      "xAxisRange": "last_7d",
      "filters": [],
      "colSpan": 12
    }}
  ]
}}

Rules:
- colSpan must be 3, 4, 6, or 12
- Always start with one kpi-banner (colSpan 12)
- Add 2-4 metric-cards based on what makes sense from the user request
- Add a data-table with columns that are relevant to the user's request
   - Use "pageSize" (default 50) — data-table is paginated server-side. Never
     promise it shows "all" records.
- Add a bar-chart if the request mentions trends, grouping, or comparison
- For time-series widgets (line-chart, area-chart): set "xField" to a date field
   AND set "timeBucket" to "day" | "week" | "month" | "quarter" | "year" based on
   how zoomed-in the user wants. Default to "month" for general overview, "day"
   for "last 30 days" type asks.
- For "X per Y per Z" / pivot questions ("uptime per sensor per day",
   "revenue per region per month"), use the "pivot-table" widget. Config:
   {{"type":"pivot-table", "labelField":"<row field, e.g. sensor_name>",
     "xField":"<date field>", "valueField":"<numeric, blank for count>",
     "timeBucket":"day", "aggregation":"count|sum|avg",
     "xAxisRange":"last_7d", "filters":[...], "colSpan":12}}
   The pivot-table widget renders a real 2D HTML table client-side; no
   custom code needed.
- DO NOT generate "custom-code" widgets in this dashboard. They're for the
   single-widget AI generator, not multi-widget dashboards. If the user
   asks for something a typed widget can't express exactly, pick the
   closest typed widget — never custom-code.
- MULTI-SERIES line/area charts: when the user asks for several metrics on the
   same chart over time (e.g. "rpm, running, temp over time", "revenue by region
   over time"), set "labelField" to the categorical column that distinguishes
   the series (e.g. "field", "metric_type", "region", "sensor_name"). The chart
   will draw one line per labelField value automatically. Use a filter with
   operator "in" to scope to specific values, e.g.
   { "field": "field", "operator": "in", "value": "rpm, running, temp" }.
- Pick columns for the data-table that actually have data in the sample rows
- For count aggregation, field may be null or omitted
- For groupBy widgets (bar-chart, pie-chart): labelField MUST be a categorical
   field — status, stage, type, category, source, region. NEVER pick a primary
   key, an email, a freeform name, or a high-cardinality field.
- Filters now support operators "in" / "not_in" with comma-separated values,
   e.g. value="rpm, running, temp". Use these instead of stacking multiple eq
   filters (eq filters AND together, "in" gives OR semantics)."""

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

        eav_section = _eav_prompt_section(sample_rows)

        prompt = f"""You are a dashboard widget builder. Generate ONE widget config from a natural language request.

Today: {today}  |  Current week starts: {week_start}  |  Current month starts: {month_start}

User request: "{description}"

Object type: "{object_type_name}" (id: {object_type_id})
Available fields: {json.dumps(properties[:60])}{sample_preview}{eav_section}

CRITICAL — DATA SCALE: this object type may contain millions of rows.
Charts, metric cards, and data tables are rendered by the frontend as queries
against /aggregate (for charts/metrics) or paginated /records (for tables).
The browser NEVER receives raw rows for charts or metric cards. Pick groupBy
(labelField) on low-cardinality categorical fields. For line/area charts,
always set xField to a date field AND set timeBucket explicitly.

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
  "labelField": "field (bar-chart / pie-chart only — categorical, low cardinality)",
  "valueField": "field (bar/line-chart only — numeric. omit for count mode)",
  "xField": "date field (line-chart / area-chart only)",
  "timeBucket": "day | week | month | quarter | year (line/area-chart only — defaults to month)",
  "pageSize": 50,
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
- MULTI-SERIES: when the user wants several metrics on one chart (e.g. "rpm,
   running, temp over time", "revenue by region over time"), ALSO set labelField
   to the categorical column that distinguishes the series. The chart draws one
   line per distinct labelField value. Always set timeBucket explicitly.
- Use an "in" filter with comma-separated values to scope a multi-series chart
   to specific labels, e.g. {"field": "metric", "operator": "in", "value": "rpm, running, temp"}.

Bar-chart rules:
- For "per stage / by category / distribution" with NO explicit numeric value → omit valueField entirely (the renderer counts per label)
- labelField must be the grouping/category field

Filter operator notes:
- "eq" filters AND together. To filter "metric is rpm OR running OR temp", use
   ONE filter row with operator "in" and value "rpm, running, temp". Do NOT
   create three separate eq filters — that's an impossible AND.

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

        eav_section = _eav_prompt_section(sample_rows)

        prompt = f"""You are a dashboard code generator. Generate a JavaScript function body for a custom widget.

Today: {today}  |  Current week starts: {week_start}
User request: "{description}"
Object type: "{object_type_name}" (id: {object_type_id})
Available fields: {json.dumps(properties[:60])}{sample_preview}{eav_section}

TASK: Write JavaScript code (no JSX, no imports, no export) that:
1. Receives these variables:
   - React           — the React object (use React.createElement, hooks, etc.)
   - records         — array of raw rows. HARD CAPPED at 5000 rows. If the
                       object type has more than 5000 rows total, this is a
                       SAMPLE, not the whole dataset. Iterating over
                       `records` for counts/sums/groupings is WRONG — the
                       answer would be wrong AND it wastes bandwidth.
   - fields          — array of field names from the sample
   - title           — the widget title string
   - query(opts)     — server-side aggregation against the WHOLE table.
                       Returns {{ rows, loading, error }}. Hooks-based;
                       call at the TOP of your code, SAME number of times
                       every render, NEVER inside if/else.
                       opts: {{ groupBy, timeBucket: {{field, interval}},
                       aggregations: [{{field, method}}], filters,
                       sortBy, sortDir, limit }}
                       method ∈ count | sum | avg | min | max | count_distinct
                       interval ∈ hour | day | week | month | quarter | year
   - total           — total row count in the database (number).
   - isSampled       — boolean. True iff total > records.length.
2. Does whatever the user requested (filtering, grouping, calculations, custom visualization)
3. Returns a React element tree using React.createElement()

RULES:
- DEFAULT TO query(). Use `records` ONLY for: rendering a small list of rows,
   showing a sample, formatting raw text. Never use it for sums, counts,
   averages, group-bys, or any aggregation — those go through query().
- If isSampled is true and your widget needs all-rows semantics (top N,
   total count, average, etc.), use query(). Iterating records when
   isSampled would silently give the user a wrong answer.
- Use ONLY React.createElement(), never JSX syntax (no < > tags)
- Use only vanilla JS — no imports, no require(), no external libs
- Field names must match exactly from the Available fields list
- For date comparisons, parse with new Date()
- For colors use: primary=#7C3AED, success=#16A34A, danger=#DC2626, muted=#94A3B8, border=#E2E8F0
- Keep the UI clean and minimal — use padding 12-16px, font-size 12-13px
- Always wrap in a div with style={{padding:'12px', height:'100%', overflow:'auto', boxSizing:'border-box'}}
- Handle empty data gracefully (check records.length, or data.loading / data.error from query())

EXAMPLE pattern for a ranked list (small dataset):
  var items = records.slice(0, 10);
  return React.createElement('div', {{style:{{padding:'12px'}}}},
    React.createElement('div', {{style:{{fontWeight:600,marginBottom:'8px',fontSize:'13px'}}}}, title),
    items.map(function(r, i) {{
      return React.createElement('div', {{key:i, style:{{...}}}}, r.fieldname);
    }})
  );

EXAMPLE pattern for a server-side query (any dataset size):
  var data = query({{
    groupBy: 'status',
    aggregations: [{{ method: 'count' }}],
    sortBy: 'agg_0', sortDir: 'desc', limit: 10
  }});
  if (data.loading) return React.createElement('div', null, 'Loading…');
  if (data.error)   return React.createElement('div', null, 'Error: ' + data.error);
  return React.createElement('div', {{style:{{padding:'12px'}}}},
    React.createElement('div', {{style:{{fontWeight:600}}}}, title),
    data.rows.map(function(r, i) {{
      return React.createElement('div', {{key:i}}, r.group + ': ' + r.agg_0);
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
        plan_text_raw, _ = self._chat_sync(
            system="You are a data query planner. Output only valid JSON.",
            user_content=plan_prompt,
            max_tokens=512,
        )
        plan_text = plan_text_raw.strip()
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

        text, _ = self._chat_sync(
            system=(
                f"You are a data analyst. Today is {today}. Dataset: {object_type_name} ({total} total records). "
                "Use GFM markdown: **bold** key values, ## headers, bullet lists, pipe tables. "
                "Be specific with numbers and examples from the data."
                + widget_guide
                + dashboard_section
            ),
            user_content=f"Question: {question}{fallback_note}\n\nQuery results ({object_type_name}):\n{result_section}",
            max_tokens=2048,
        )
        return text

    # ------------------------------------------------------------------
    # Async AI Copilot methods (Phase 8)
    # ------------------------------------------------------------------

    async def create_pipeline_from_description(
        self, description: str, connectors: list, object_types: list
    ) -> dict:
        """Generate a pipeline config from natural language description."""
        prompt = f"""You are building a data pipeline configuration for Nexus platform.

Available connectors:
{json.dumps(connectors, indent=2)}

Available object types (data targets):
{json.dumps(object_types, indent=2)}

User request: {description}

## Node types (use EXACTLY these uppercase values for "type"):
- SOURCE — pull data from a connector. Config: {{"connector_id":"<id>","endpoint":"<path>","method":"GET","poll_frequency":"5m"}}. IMPORTANT: Check the connector's "endpoints" array for the correct HTTP method. If an endpoint has "method":"POST", set "method":"POST" in the SOURCE config. Default is GET.
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

        text, _resolved_model = await self._chat_async(
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            user_content=prompt,
            max_tokens=2048,
        )
        content = text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)

    async def create_logic_function(
        self, description: str, object_types: list, existing_functions: list
    ) -> dict:
        """Generate a logic function config from natural language description."""
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

        text, _resolved_model = await self._chat_async(
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            user_content=prompt,
            max_tokens=2048,
        )
        content = text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)

    async def explain_lineage(
        self, nodes: list, edges: list, focus_node_id: str | None
    ) -> dict:
        """Analyze a data lineage graph and explain it in plain English."""
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

        text, _resolved_model = await self._chat_async(
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            user_content=prompt,
            max_tokens=2048,
        )
        content = text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)

    async def surface_anomalies(
        self, object_type_name: str, fields: list, records: list
    ) -> dict:
        """Analyze a dataset for anomalies and data quality issues."""
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

        text, _resolved_model = await self._chat_async(
            system=(
                "You are a precise data engineering assistant. Always respond with "
                "valid JSON only — no markdown, no explanations outside the JSON structure."
            ),
            user_content=prompt,
            max_tokens=2048,
        )
        content = text.strip()
        if content.startswith("```"):
            content = content[content.index("\n") + 1:]
            if content.rstrip().endswith("```"):
                content = content.rstrip()[:-3].rstrip()
        return json.loads(content)


WORKBENCH_SYSTEM_PROMPT = """You are the Nexus Workbench agent — a data analyst that responds to every user question by producing a SHORT Jupyter-style notebook that answers it.

You MUST respond with valid JSON only:
{ "cells": [ Cell, Cell, ... ] }

Each Cell is one of:
  { "kind": "markdown", "source": "..." }
  { "kind": "python",   "source": "..." }

Rules:
1. Always interleave one short markdown cell (1-3 sentences) with the code that follows. Use markdown for narration; keep it tight.
2. Python cells can use these pre-imported names: `nexus`, `pd` (pandas), `np` (numpy), `px` (plotly.express), `go` (plotly.graph_objects), `plt` (matplotlib.pyplot).
3. To read data, always call `nexus.query(object_type_id, filters=..., limit=...)` or `nexus.records(object_type_id, limit=...)`. Never use `requests` / `httpx` directly. Never call `pip install`.
4. For charts, PREFER plotly.express (e.g. `fig = px.scatter(df, x=..., y=..., color=...)`). The last expression in the cell must be the Plotly figure (`fig`) so it is rendered as an interactive chart. Only fall back to matplotlib when plotly can't express it.
5. For tables, end the cell with the DataFrame itself (e.g. `df.head(20)`) — Jupyter will render its HTML table.
6. Keep the answer short — usually 2 to 5 cells total. Don't echo the schema, don't print dozens of debug lines.
7. Use the provided object types / fields to ground your code. If the user's request is ambiguous, pick the most plausible object type + fields and go.
8. Field names in the ontology may be snake_case or arbitrary — respect what is actually in the schema list. Never invent a field.
9. If the user's request is just conversational ("what can you do?"), answer with a single markdown cell and stop.

Output format: ONLY the JSON object. No prose, no markdown fences, no trailing commas.
"""


def generate_workbench_cells(
    client: "ClaudeInferenceClient",
    prompt: str,
    prior_cells: list[dict],
    ontology_context: list[dict],
) -> list[dict]:
    """Ask Claude to produce the next batch of notebook cells to append."""
    # Compact ontology context: object_type_id -> name + up-to-25 field names
    compact_ot = []
    for ot in ontology_context[:12]:
        fields = ot.get("fields") or ot.get("properties") or []
        if fields and isinstance(fields[0], dict):
            fields = [f.get("name") for f in fields if f.get("name")]
        compact_ot.append({
            "id": ot.get("id"),
            "name": ot.get("name") or ot.get("display_name") or ot.get("displayName"),
            "fields": fields[:25],
        })

    # Trim prior cell outputs to stay within context
    trimmed_prior = []
    for c in prior_cells[-12:]:
        trimmed_prior.append({
            "kind": c.get("kind"),
            "source": (c.get("source") or "")[:800],
        })

    user_msg = json.dumps({
        "user_prompt": prompt,
        "object_types": compact_ot,
        "prior_cells": trimmed_prior,
    })

    text, _resolved_model = client._chat_sync(
        system=WORKBENCH_SYSTEM_PROMPT,
        user_content=user_msg,
        max_tokens=3500,
    )

    content = text.strip()
    if content.startswith("```"):
        content = content[content.index("\n") + 1:]
        if content.rstrip().endswith("```"):
            content = content.rstrip()[:-3].rstrip()

    data = json.loads(content)
    cells = data.get("cells", [])

    # Normalize: every cell is either markdown or python (executable via kernel).
    # SQL-ish prompts are expected to be expressed as python cells using nexus.query().
    out = []
    for i, cell in enumerate(cells):
        kind = cell.get("kind", "markdown")
        if kind not in ("markdown", "python"):
            kind = "markdown"
        out.append({
            "id": f"{uuid4().hex[:8]}-{i}",
            "kind": kind,
            "source": cell.get("source", ""),
        })
    return out


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
