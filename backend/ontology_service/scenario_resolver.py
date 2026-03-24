"""
ScenarioResolver — Core business logic for the 3-scenario ontology mapping algorithm.

Scenario 1 - Enrichment (composite_score > 0.85 AND primary_key_resolvable):
    The incoming schema is highly similar to an existing ObjectType and records
    can be joined by a common key. New fields should be added to the existing type.

Scenario 2 - Conflict (0.50 <= composite_score <= 0.85 OR conflicting_fields):
    Partial overlap detected with field-level conflicts. Human review required to
    choose resolution strategy per field.

Scenario 3 - New Object / Sub-type (composite_score < 0.50):
    The incoming schema represents a distinct business entity. Create a new ObjectType
    or a sub-type if a parent relationship can be established.
"""
from typing import Union
from uuid import uuid4
from datetime import datetime
from shared.models import (
    ObjectType, InferenceResult, SimilarityScore,
    EnrichmentProposal, FieldConflict, NewObjectProposal,
    ObjectProperty, OntologyLink
)
from shared.enums import ConflictType, ConflictResolution, SemanticType, PiiLevel


class ScenarioResolver:
    """
    Resolves which scenario applies when a new connector is mapped to the ontology,
    and builds the appropriate proposal object.
    """

    ENRICHMENT_THRESHOLD = 0.85
    CONFLICT_LOWER_THRESHOLD = 0.50

    def resolve(
        self,
        similarity_score: SimilarityScore,
        existing_object: ObjectType,
        incoming_schema: InferenceResult,
    ) -> Union[EnrichmentProposal, list[FieldConflict], NewObjectProposal]:
        """
        Main entry point — determine scenario and build proposal.

        Returns:
            EnrichmentProposal if scenario 1
            list[FieldConflict] if scenario 2
            NewObjectProposal if scenario 3
        """
        score = similarity_score.composite_score
        has_pk = similarity_score.primary_key_resolvable
        has_conflicts = bool(similarity_score.conflicting_fields)

        if score > self.ENRICHMENT_THRESHOLD and has_pk:
            return self._build_enrichment_proposal(
                similarity_score, existing_object, incoming_schema
            )
        elif score >= self.CONFLICT_LOWER_THRESHOLD or has_conflicts:
            return self._build_conflict_analysis(
                similarity_score, existing_object, incoming_schema
            )
        else:
            return self._build_new_object_proposal(
                similarity_score, existing_object, incoming_schema
            )

    def _build_enrichment_proposal(
        self,
        score: SimilarityScore,
        existing: ObjectType,
        incoming: InferenceResult,
    ) -> EnrichmentProposal:
        """Build Scenario 1: Enrichment proposal."""
        existing_names = {p.name for p in existing.properties}

        # New properties are those in incoming that don't exist in the target
        new_properties = [
            ObjectProperty(
                name=field.suggested_name,
                display_name=field.suggested_name.replace("_", " ").title(),
                semantic_type=field.semantic_type,
                data_type=field.data_type,
                pii_level=field.pii_level,
                required=not field.nullable,
                source_connector_id=incoming.connector_id,
                description=f"Inferred from {field.source_field}",
                sample_values=field.sample_values,
                inference_confidence=field.confidence,
            )
            for field in incoming.fields
            if field.suggested_name not in existing_names
        ]

        # Determine join key — look for IDENTIFIER fields that appear in both schemas
        join_key = self._find_join_key(existing, incoming)

        return EnrichmentProposal(
            existing_object_type_id=existing.id,
            new_properties=new_properties,
            join_key=join_key,
            backfill_strategy="incremental",
            similarity_score=score.composite_score,
            source_connector_id=incoming.connector_id,
        )

    def _build_conflict_analysis(
        self,
        score: SimilarityScore,
        existing: ObjectType,
        incoming: InferenceResult,
    ) -> list[FieldConflict]:
        """Build Scenario 2: Conflict analysis."""
        conflicts = []
        existing_prop_map = {p.name: p for p in existing.properties}
        incoming_field_map = {f.suggested_name: f for f in incoming.fields}

        for field_name in score.conflicting_fields:
            existing_prop = existing_prop_map.get(field_name)
            incoming_field = incoming_field_map.get(field_name)

            if not existing_prop or not incoming_field:
                continue

            conflict_type = self._determine_conflict_type(existing_prop, incoming_field)
            resolution = self._suggest_resolution(conflict_type)

            conflicts.append(FieldConflict(
                field_name=field_name,
                conflict_type=conflict_type,
                existing_shape={
                    "semantic_type": existing_prop.semantic_type.value,
                    "data_type": existing_prop.data_type,
                    "sample_values": existing_prop.sample_values[:3],
                },
                incoming_shape={
                    "semantic_type": incoming_field.semantic_type.value,
                    "data_type": incoming_field.data_type,
                    "sample_values": incoming_field.sample_values[:3],
                },
                suggested_resolution=resolution,
            ))

        # Also check for overlapping fields with type differences
        for field_name, incoming_field in incoming_field_map.items():
            if field_name in existing_prop_map and field_name not in score.conflicting_fields:
                existing_prop = existing_prop_map[field_name]
                if existing_prop.data_type != incoming_field.data_type:
                    conflicts.append(FieldConflict(
                        field_name=field_name,
                        conflict_type=ConflictType.TYPE,
                        existing_shape={"data_type": existing_prop.data_type},
                        incoming_shape={"data_type": incoming_field.data_type},
                        suggested_resolution=ConflictResolution.KEEP_EXISTING,
                    ))

        return conflicts

    def _build_new_object_proposal(
        self,
        score: SimilarityScore,
        nearest_existing: ObjectType,
        incoming: InferenceResult,
    ) -> NewObjectProposal:
        """Build Scenario 3: New ObjectType proposal."""
        # Check if this could be a sub-type of the nearest existing object
        is_sub_type = (
            score.composite_score > 0.30 and
            self._has_overlapping_identifier(nearest_existing, incoming)
        )

        suggested_properties = [
            ObjectProperty(
                name=field.suggested_name,
                display_name=field.suggested_name.replace("_", " ").title(),
                semantic_type=field.semantic_type,
                data_type=field.data_type,
                pii_level=field.pii_level,
                required=not field.nullable,
                source_connector_id=incoming.connector_id,
                sample_values=field.sample_values,
                inference_confidence=field.confidence,
            )
            for field in incoming.fields
        ]

        # Suggest a link to the nearest existing object if there's meaningful overlap
        suggested_links = []
        if score.composite_score > 0.20:
            join_key = self._find_join_key(nearest_existing, incoming)
            if join_key:
                link = OntologyLink(
                    source_object_type_id=incoming.suggested_object_type_name,
                    target_object_type_id=nearest_existing.id,
                    relationship_type="belongs_to",
                    join_keys=[join_key],
                    is_inferred=True,
                    confidence=score.composite_score,
                )
                suggested_links.append(link)

        return NewObjectProposal(
            suggested_name=incoming.suggested_object_type_name,
            suggested_properties=suggested_properties,
            suggested_links=suggested_links,
            parent_object_type_id=nearest_existing.id if is_sub_type else None,
            is_sub_type=is_sub_type,
            similarity_score=score.composite_score,
            source_connector_id=incoming.connector_id,
        )

    def _find_join_key(
        self, existing: ObjectType, incoming: InferenceResult
    ) -> dict[str, str]:
        """Find a common join key between existing properties and incoming fields."""
        existing_identifiers = {
            p.name: p for p in existing.properties
            if p.semantic_type == SemanticType.IDENTIFIER
        }
        incoming_identifiers = {
            f.suggested_name: f for f in incoming.fields
            if f.semantic_type == SemanticType.IDENTIFIER
        }

        # Look for exact name matches
        for name in existing_identifiers:
            if name in incoming_identifiers:
                return {"existing_field": name, "incoming_field": name}

        # Look for common patterns (id suffix, email, etc.)
        for e_name, e_prop in existing_identifiers.items():
            for i_name, i_field in incoming_identifiers.items():
                # Fuzzy: strip common prefixes
                e_stem = e_name.replace("_id", "").replace("id_", "")
                i_stem = i_name.replace("_id", "").replace("id_", "")
                if e_stem == i_stem or e_name in i_name or i_name in e_name:
                    return {"existing_field": e_name, "incoming_field": i_name}

        # Fallback: email as join key
        for p in existing.properties:
            if p.semantic_type == SemanticType.EMAIL:
                for f in incoming.fields:
                    if f.semantic_type == SemanticType.EMAIL:
                        return {"existing_field": p.name, "incoming_field": f.suggested_name}

        # Return first identifier pair as fallback
        if existing_identifiers and incoming_identifiers:
            e_name = next(iter(existing_identifiers))
            i_name = next(iter(incoming_identifiers))
            return {"existing_field": e_name, "incoming_field": i_name}

        return {}

    def _determine_conflict_type(
        self, existing_prop: ObjectProperty, incoming_field
    ) -> ConflictType:
        """Determine the type of conflict between a field in existing vs incoming."""
        if existing_prop.data_type != incoming_field.data_type:
            return ConflictType.TYPE
        if existing_prop.semantic_type != incoming_field.semantic_type:
            return ConflictType.VOCABULARY
        # Check sample value overlap for scale/granularity conflicts
        return ConflictType.VOCABULARY

    def _suggest_resolution(self, conflict_type: ConflictType) -> ConflictResolution:
        """Suggest a default resolution strategy based on conflict type."""
        suggestions = {
            ConflictType.VOCABULARY: ConflictResolution.NORMALIZE_CANONICAL,
            ConflictType.TYPE: ConflictResolution.KEEP_EXISTING,
            ConflictType.GRANULARITY: ConflictResolution.NAMESPACE_BOTH,
            ConflictType.SCALE: ConflictResolution.NORMALIZE_CANONICAL,
        }
        return suggestions.get(conflict_type, ConflictResolution.PENDING)

    def _has_overlapping_identifier(
        self, existing: ObjectType, incoming: InferenceResult
    ) -> bool:
        """Check if there's an overlapping IDENTIFIER field for sub-type detection."""
        existing_ids = {p.name for p in existing.properties if p.semantic_type == SemanticType.IDENTIFIER}
        incoming_ids = {f.suggested_name for f in incoming.fields if f.semantic_type == SemanticType.IDENTIFIER}
        return bool(existing_ids & incoming_ids)
