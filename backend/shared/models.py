from __future__ import annotations
from typing import Any, Optional, Union
from datetime import datetime
from uuid import UUID, uuid4
from pydantic import BaseModel, Field, field_validator
from .enums import (
    SemanticType, NodeType, PipelineStatus, ConflictType,
    ConflictResolution, PiiLevel, Role, Permission, ExtractionPattern
)


class FieldInference(BaseModel):
    """AI-inferred field metadata for a single source field."""
    source_field: str
    suggested_name: str
    semantic_type: SemanticType
    data_type: str
    pii_level: PiiLevel
    confidence: float = Field(ge=0.0, le=1.0)
    reasoning: str
    sample_values: list[str] = Field(default_factory=list)
    nullable: bool = True

    model_config = {"json_schema_extra": {"example": {
        "source_field": "EmailAddress",
        "suggested_name": "email",
        "semantic_type": "EMAIL",
        "data_type": "string",
        "pii_level": "HIGH",
        "confidence": 0.99,
        "reasoning": "Field name contains 'Email', sample values match RFC 5322 pattern",
        "sample_values": ["john@example.com"],
        "nullable": False,
    }}}


class InferenceResult(BaseModel):
    """Complete inference result for a connector schema."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    connector_id: str
    fields: list[FieldInference]
    suggested_object_type_name: str
    overall_confidence: float = Field(ge=0.0, le=1.0)
    inferred_at: datetime = Field(default_factory=datetime.utcnow)
    model_version: str = "claude-sonnet-4-6"
    raw_schema_hash: str
    warnings: list[str] = Field(default_factory=list)


class PipelineNode(BaseModel):
    """A single transformation node in a pipeline DAG."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    type: NodeType
    label: str
    config: dict[str, Any] = Field(default_factory=dict)
    position: dict[str, float] = Field(default_factory=lambda: {"x": 0, "y": 0})
    connector_id: Optional[str] = None
    object_type_id: Optional[str] = None


class PipelineEdge(BaseModel):
    """A directed edge in the pipeline DAG."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    source: str
    target: str
    label: Optional[str] = None
    animated: bool = False


class Pipeline(BaseModel):
    """A complete data transformation pipeline."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: Optional[str] = None
    status: PipelineStatus = PipelineStatus.DRAFT
    nodes: list[PipelineNode] = Field(default_factory=list)
    edges: list[PipelineEdge] = Field(default_factory=list)
    connector_ids: list[str] = Field(default_factory=list)
    target_object_type_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    last_run_at: Optional[datetime] = None
    last_run_row_count: Optional[int] = None
    tenant_id: str
    version: int = 1
    # Process mining configuration — set via the Settings tab in Process Mining
    event_config: Optional[dict[str, Any]] = None


class ObjectProperty(BaseModel):
    """A property (field) of an ObjectType in the ontology."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    display_name: str
    semantic_type: SemanticType
    data_type: str
    pii_level: PiiLevel = PiiLevel.NONE
    required: bool = False
    source_connector_id: Optional[str] = None
    description: Optional[str] = None
    sample_values: list[str] = Field(default_factory=list)
    inference_confidence: Optional[float] = None


class OntologyLink(BaseModel):
    """A relationship between two ObjectTypes in the ontology graph."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    source_object_type_id: str
    target_object_type_id: str
    relationship_type: str  # has_many, belongs_to, has_one, many_to_many
    join_keys: list[dict[str, str]] = Field(default_factory=list)
    is_inferred: bool = False
    confidence: Optional[float] = None
    label: Optional[str] = None


class ObjectType(BaseModel):
    """A canonical object type in the enterprise ontology."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    display_name: str
    description: Optional[str] = None
    properties: list[ObjectProperty] = Field(default_factory=list)
    source_connector_ids: list[str] = Field(default_factory=list)
    source_pipeline_id: Optional[str] = None
    version: int = 1
    schema_health: str = "healthy"
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    tenant_id: str = ""
    position: Optional[dict[str, float]] = None


class SimilarityScore(BaseModel):
    """Similarity score between an incoming schema and an existing ObjectType."""
    schema_a_id: str
    object_type_id: str
    field_name_overlap: float = Field(ge=0.0, le=1.0)
    semantic_type_overlap: float = Field(ge=0.0, le=1.0)
    sample_value_overlap: float = Field(ge=0.0, le=1.0)
    primary_key_resolvable: bool
    conflicting_fields: list[str] = Field(default_factory=list)
    composite_score: float = Field(ge=0.0, le=1.0)
    computed_at: datetime = Field(default_factory=datetime.utcnow)


class EnrichmentProposal(BaseModel):
    """Proposal to enrich an existing ObjectType with new properties."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    existing_object_type_id: str
    new_properties: list[ObjectProperty]
    join_key: dict[str, str]  # {"existing_field": "...", "incoming_field": "..."}
    backfill_strategy: Optional[str] = None
    similarity_score: float
    source_connector_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class FieldConflict(BaseModel):
    """A detected conflict between an existing ObjectType and incoming schema."""
    field_name: str
    conflict_type: ConflictType
    existing_shape: dict[str, Any]
    incoming_shape: dict[str, Any]
    suggested_resolution: ConflictResolution = ConflictResolution.PENDING
    resolution_applied: Optional[ConflictResolution] = None


class ConflictResolutionRecord(BaseModel):
    """Record of a conflict resolution decision."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    object_type_id: str
    conflicts: list[FieldConflict]
    applied_by: str
    applied_at: datetime = Field(default_factory=datetime.utcnow)
    resulting_version: int


class NewObjectProposal(BaseModel):
    """Proposal to create a new ObjectType from an incoming schema."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    suggested_name: str
    suggested_properties: list[ObjectProperty]
    suggested_links: list[OntologyLink] = Field(default_factory=list)
    parent_object_type_id: Optional[str] = None
    is_sub_type: bool = False
    similarity_score: float
    source_connector_id: str
    created_at: datetime = Field(default_factory=datetime.utcnow)


class PropertyDiff(BaseModel):
    """A single property change in a schema diff."""
    property_name: str
    change_type: str  # ADDED, REMOVED, MODIFIED
    old_value: Optional[dict[str, Any]] = None
    new_value: Optional[dict[str, Any]] = None
    breaking_change: bool = False


class SchemaDiff(BaseModel):
    """Git-diff style schema diff between two ObjectType versions."""
    object_type_id: str
    from_version: int
    to_version: int
    diffs: list[PropertyDiff]
    has_breaking_changes: bool
    generated_at: datetime = Field(default_factory=datetime.utcnow)


class ObjectTypeVersion(BaseModel):
    """Immutable snapshot of an ObjectType at a specific version."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    object_type_id: str
    version: int
    snapshot: ObjectType
    change_description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    created_by: str


class Event(BaseModel):
    """A process mining event in the event log."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    case_id: str
    activity: str
    timestamp: datetime
    object_type_id: str
    object_id: str
    pipeline_id: str
    connector_id: str
    attributes: dict[str, Any] = Field(default_factory=dict)
    resource: Optional[str] = None
    cost: Optional[float] = None
    tenant_id: str


class EventLogQualityScore(BaseModel):
    """Quality assessment for a pipeline's event log output."""
    pipeline_id: str
    completeness: float = Field(ge=0.0, le=1.0)
    timeliness: float = Field(ge=0.0, le=1.0)
    consistency: float = Field(ge=0.0, le=1.0)
    accuracy: float = Field(ge=0.0, le=1.0)
    composite: float = Field(ge=0.0, le=1.0)
    evaluated_at: datetime = Field(default_factory=datetime.utcnow)
    issues: list[str] = Field(default_factory=list)
    case_count: int = 0
    event_count: int = 0


class AuditEvent(BaseModel):
    """Immutable audit trail event."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    tenant_id: str
    actor_id: str
    actor_role: Role
    action: str
    resource_type: str
    resource_id: str
    before_state: Optional[dict[str, Any]] = None
    after_state: Optional[dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    occurred_at: datetime = Field(default_factory=datetime.utcnow)
    success: bool = True
    error_message: Optional[str] = None
