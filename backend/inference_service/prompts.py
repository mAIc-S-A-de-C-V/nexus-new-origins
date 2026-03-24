"""
Structured prompt templates for Claude API calls.
These prompts use few-shot examples and chain-of-thought instructions.
"""

SEMANTIC_TYPE_VOCABULARY = """
Available SemanticTypes (use EXACTLY these values):
- IDENTIFIER: Unique IDs, primary keys, foreign keys, UUIDs, record IDs
- PERSON_NAME: First/last names, full names, display names of people
- EMAIL: Email addresses (RFC 5322)
- PHONE: Phone numbers (any format)
- ADDRESS: Physical addresses, street, city, state, zip, country
- DATE: Date only values (no time component)
- DATETIME: Date + time values, timestamps, ISO 8601
- CURRENCY: Monetary amounts, prices, costs, revenue (numeric)
- QUANTITY: Counts, quantities, stock levels, measurements (numeric, non-monetary)
- PERCENTAGE: Rates, probabilities, ratios expressed as percentages
- CATEGORY: Enumerated categories, picklists, types, tags
- STATUS: State values, workflow stages, lifecycle stages
- URL: Web URLs, URIs, API endpoints, links
- BOOLEAN: True/false, yes/no, is_active, enabled/disabled
- TEXT: Free-form text, descriptions, notes, comments, names of things (not people)
"""

PII_DETECTION_INSTRUCTIONS = """
For PII detection, use these levels:
- HIGH: Direct identifiers — EMAIL, PHONE, full PERSON_NAME, ADDRESS, SSN, passport, bank account
- MEDIUM: Quasi-identifiers — partial names, birth dates, ZIP codes, IP addresses
- LOW: Indirect identifiers — employer, job title, general location, salary ranges
- NONE: No personal information — product IDs, amounts, categories, timestamps, status values

Chain-of-thought for PII: First identify if a field could relate to a real person. Then assess
how uniquely identifying it is. If combined with other fields it could identify someone, use MEDIUM.
"""

SCHEMA_INFERENCE_PROMPT = """\
You are a data engineering expert specializing in schema inference and semantic typing.

{semantic_types}

{pii_instructions}

Given the following raw schema and sample data rows, infer semantic types and metadata for each field.

Raw Schema:
```json
{raw_schema}
```

Sample Rows (up to 5):
```json
{sample_rows}
```

Instructions:
1. For each field in the schema, determine the most appropriate SemanticType from the vocabulary above.
2. Detect PII level using the chain-of-thought approach described above.
3. Suggest a normalized snake_case field name.
4. Determine the underlying data type (string, int, float, boolean, datetime, date, uuid).
5. Assess confidence (0.0-1.0) based on field name clarity + sample value evidence.
6. Suggest an object type name in PascalCase based on the overall schema shape.

Respond with ONLY a valid JSON object matching this exact structure:
{{
  "suggested_object_type_name": "PascalCaseName",
  "overall_confidence": 0.95,
  "warnings": ["optional warning messages"],
  "fields": [
    {{
      "source_field": "original_field_name",
      "suggested_name": "snake_case_name",
      "semantic_type": "SEMANTIC_TYPE_VALUE",
      "data_type": "string|int|float|boolean|datetime|date|uuid",
      "pii_level": "NONE|LOW|MEDIUM|HIGH",
      "confidence": 0.95,
      "reasoning": "Brief explanation of semantic type choice",
      "sample_values": ["val1", "val2"],
      "nullable": true
    }}
  ]
}}
""".format(
    semantic_types=SEMANTIC_TYPE_VOCABULARY,
    pii_instructions=PII_DETECTION_INSTRUCTIONS,
    raw_schema="{raw_schema}",
    sample_rows="{sample_rows}",
)

SIMILARITY_SCORING_PROMPT = """\
You are a data engineering expert performing schema similarity analysis for data integration.

Compare the following two schemas and score their similarity across multiple dimensions.

Existing Object Type:
```json
{existing_object}
```

Incoming Schema (InferenceResult):
```json
{incoming_schema}
```

{semantic_types}

Instructions:
1. Calculate field_name_overlap: ratio of field names that fuzzy-match between schemas (0.0-1.0)
2. Calculate semantic_type_overlap: ratio of fields with matching semantic types (0.0-1.0)
3. Calculate sample_value_overlap: ratio of overlapping enum/categorical values in sample data (0.0-1.0)
4. Determine primary_key_resolvable: can records be joined via a common key? (true/false)
5. List conflicting_fields: field names present in both but with conflicting shapes
6. Calculate composite_score: weighted average (field_name: 0.4, semantic: 0.3, sample: 0.15, pk: 0.15)

Decision thresholds:
- composite > 0.85 AND primary_key_resolvable → Enrichment scenario
- composite 0.50-0.85 OR conflicting_fields → Conflict scenario
- composite < 0.50 → New Object Type scenario

Respond with ONLY valid JSON:
{{
  "field_name_overlap": 0.0,
  "semantic_type_overlap": 0.0,
  "sample_value_overlap": 0.0,
  "primary_key_resolvable": false,
  "conflicting_fields": [],
  "composite_score": 0.0,
  "reasoning": "explanation"
}}
""".format(
    existing_object="{existing_object}",
    incoming_schema="{incoming_schema}",
    semantic_types=SEMANTIC_TYPE_VOCABULARY,
)

CONFLICT_DETECTION_PROMPT = """\
You are a data integration expert identifying schema conflicts between a canonical object type
and an incoming data source schema.

Existing Object Type:
```json
{existing_object}
```

Incoming Schema:
```json
{incoming_schema}
```

Conflict Types to detect:
- VOCABULARY: Same concept, different value vocabularies (e.g., phone format differences, enum naming)
- TYPE: Same field name but different data types (e.g., string vs integer)
- GRANULARITY: Different levels of granularity (e.g., full address vs city only)
- SCALE: Same quantity but different units or scale (e.g., USD vs thousands of USD)

For each conflict found, suggest a resolution:
- NAMESPACE_BOTH: Keep both fields with prefixes (e.g., sf_phone, hs_phone)
- NORMALIZE_CANONICAL: Transform incoming to match canonical format
- KEEP_EXISTING: Ignore incoming field
- REPLACE: Replace existing with incoming (use rarely)

Respond with ONLY valid JSON array:
[
  {{
    "field_name": "field_name",
    "conflict_type": "VOCABULARY|TYPE|GRANULARITY|SCALE",
    "existing_shape": {{"type": "...", "example": "..."}},
    "incoming_shape": {{"type": "...", "example": "..."}},
    "suggested_resolution": "RESOLUTION_VALUE",
    "reasoning": "Why this is a conflict and how to resolve it"
  }}
]
""".format(
    existing_object="{existing_object}",
    incoming_schema="{incoming_schema}",
)

NEW_OBJECT_SUGGESTION_PROMPT = """\
You are an enterprise data architect proposing new canonical object types for a business ontology.

Given an incoming schema that doesn't closely match any existing object type, propose a well-structured
canonical object type following enterprise data modeling best practices.

Incoming Schema (InferenceResult):
```json
{incoming_schema}
```

Existing Object Types (for context and relationship suggestions):
```json
{existing_objects}
```

{semantic_types}

Instructions:
1. Propose a clear PascalCase object type name that reflects the business entity
2. Define canonical properties with proper semantic types
3. Suggest ontology links to existing object types if natural relationships exist
4. Determine if this could be a sub-type (specialization) of an existing object type
5. Use snake_case for all property names

Respond with ONLY valid JSON:
{{
  "suggested_name": "PascalCaseName",
  "is_sub_type": false,
  "parent_object_type_id": null,
  "suggested_properties": [
    {{
      "name": "property_name",
      "display_name": "Display Name",
      "semantic_type": "SEMANTIC_TYPE",
      "data_type": "string",
      "pii_level": "NONE",
      "required": true,
      "description": "What this field represents"
    }}
  ],
  "suggested_links": [
    {{
      "target_object_type_id": "existing_id",
      "relationship_type": "belongs_to|has_many|has_one|many_to_many",
      "join_keys": [{{"source": "field_a", "target": "field_b"}}],
      "confidence": 0.85
    }}
  ],
  "reasoning": "Why this is a distinct entity and how it relates to existing objects"
}}
""".format(
    incoming_schema="{incoming_schema}",
    existing_objects="{existing_objects}",
    semantic_types=SEMANTIC_TYPE_VOCABULARY,
)
