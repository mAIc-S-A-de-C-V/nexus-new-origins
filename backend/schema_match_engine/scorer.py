"""
CorrelationScorer — computes similarity between an InferenceResult and an ObjectType.

Uses fuzzy field name matching (difflib), semantic type overlap, and sample value analysis
to produce a composite SimilarityScore.
"""
import difflib
from datetime import datetime
from collections import Counter
from shared.models import InferenceResult, ObjectType, SimilarityScore
from shared.enums import SemanticType


class CorrelationScorer:
    """
    Computes field-level and semantic similarity between an incoming schema
    and a canonical ObjectType in the ontology.
    """

    FIELD_NAME_WEIGHT = 0.40
    SEMANTIC_TYPE_WEIGHT = 0.30
    SAMPLE_VALUE_WEIGHT = 0.15
    PRIMARY_KEY_WEIGHT = 0.15

    def score(
        self,
        schema_a: InferenceResult,
        object_type: ObjectType,
    ) -> SimilarityScore:
        """
        Compute composite similarity score between schema_a and object_type.

        Algorithm:
        1. Field name overlap: fuzzy match each incoming field against existing fields
        2. Semantic type overlap: count matching semantic types for overlapping fields
        3. Sample value overlap: Jaccard similarity on categorical/status sample values
        4. Primary key resolvability: check if an IDENTIFIER field maps between schemas
        5. Composite score: weighted sum

        Returns:
            SimilarityScore with all sub-scores and the composite
        """
        incoming_fields = schema_a.fields
        existing_props = object_type.properties

        if not incoming_fields or not existing_props:
            return SimilarityScore(
                schema_a_id=schema_a.id,
                object_type_id=object_type.id,
                field_name_overlap=0.0,
                semantic_type_overlap=0.0,
                sample_value_overlap=0.0,
                primary_key_resolvable=False,
                conflicting_fields=[],
                composite_score=0.0,
            )

        incoming_names = [f.suggested_name for f in incoming_fields]
        existing_names = [p.name for p in existing_props]

        # 1. Field name overlap (fuzzy)
        name_overlap, field_matches = self._compute_field_name_overlap(
            incoming_names, existing_names
        )

        # 2. Semantic type overlap
        semantic_overlap = self._compute_semantic_type_overlap(
            schema_a, object_type, field_matches
        )

        # 3. Sample value overlap
        sample_overlap = self._compute_sample_value_overlap(
            schema_a, object_type, field_matches
        )

        # 4. Primary key resolvability
        pk_resolvable, conflicting = self._check_primary_key_resolvability(
            schema_a, object_type
        )

        # 5. Composite
        composite = (
            name_overlap * self.FIELD_NAME_WEIGHT +
            semantic_overlap * self.SEMANTIC_TYPE_WEIGHT +
            sample_overlap * self.SAMPLE_VALUE_WEIGHT +
            (1.0 if pk_resolvable else 0.0) * self.PRIMARY_KEY_WEIGHT
        )

        return SimilarityScore(
            schema_a_id=schema_a.id,
            object_type_id=object_type.id,
            field_name_overlap=round(name_overlap, 4),
            semantic_type_overlap=round(semantic_overlap, 4),
            sample_value_overlap=round(sample_overlap, 4),
            primary_key_resolvable=pk_resolvable,
            conflicting_fields=conflicting,
            composite_score=round(min(1.0, composite), 4),
        )

    def _compute_field_name_overlap(
        self,
        incoming: list[str],
        existing: list[str],
    ) -> tuple[float, dict[str, str]]:
        """
        Fuzzy field name matching using difflib SequenceMatcher.
        Returns (overlap_ratio, {incoming_name: best_matching_existing_name})
        """
        matches: dict[str, str] = {}
        matched_existing: set[str] = set()
        match_count = 0

        for inc_name in incoming:
            best_score = 0.0
            best_match = None

            for ext_name in existing:
                if ext_name in matched_existing:
                    continue
                ratio = difflib.SequenceMatcher(None, inc_name, ext_name).ratio()
                if ratio > best_score:
                    best_score = ratio
                    best_match = ext_name

            # Threshold: 0.7 = strong enough fuzzy match
            if best_match and best_score >= 0.70:
                matches[inc_name] = best_match
                matched_existing.add(best_match)
                match_count += 1

        # Normalize by the larger set
        total = max(len(incoming), len(existing))
        overlap = match_count / total if total > 0 else 0.0
        return overlap, matches

    def _compute_semantic_type_overlap(
        self,
        schema_a: InferenceResult,
        object_type: ObjectType,
        field_matches: dict[str, str],
    ) -> float:
        """
        For matched field pairs, check if semantic types agree.
        """
        if not field_matches:
            return 0.0

        incoming_map = {f.suggested_name: f for f in schema_a.fields}
        existing_map = {p.name: p for p in object_type.properties}

        matching_semantic = 0
        for inc_name, ext_name in field_matches.items():
            inc_field = incoming_map.get(inc_name)
            ext_prop = existing_map.get(ext_name)
            if inc_field and ext_prop and inc_field.semantic_type == ext_prop.semantic_type:
                matching_semantic += 1

        return matching_semantic / len(field_matches)

    def _compute_sample_value_overlap(
        self,
        schema_a: InferenceResult,
        object_type: ObjectType,
        field_matches: dict[str, str],
    ) -> float:
        """
        Jaccard similarity on sample values for CATEGORY and STATUS fields.
        """
        if not field_matches:
            return 0.0

        incoming_map = {f.suggested_name: f for f in schema_a.fields}
        existing_map = {p.name: p for p in object_type.properties}

        categorical_types = {SemanticType.CATEGORY, SemanticType.STATUS}
        scores = []

        for inc_name, ext_name in field_matches.items():
            inc_field = incoming_map.get(inc_name)
            ext_prop = existing_map.get(ext_name)

            if (inc_field and ext_prop and
                    inc_field.semantic_type in categorical_types and
                    ext_prop.semantic_type in categorical_types):
                inc_vals = set(str(v).lower() for v in inc_field.sample_values)
                ext_vals = set(str(v).lower() for v in ext_prop.sample_values)

                if inc_vals or ext_vals:
                    jaccard = len(inc_vals & ext_vals) / len(inc_vals | ext_vals)
                    scores.append(jaccard)

        return sum(scores) / len(scores) if scores else 0.5  # neutral when no categorical fields

    def _check_primary_key_resolvability(
        self,
        schema_a: InferenceResult,
        object_type: ObjectType,
    ) -> tuple[bool, list[str]]:
        """
        Check if records can be joined via a common IDENTIFIER or EMAIL field.
        Also detect conflicting IDENTIFIER fields.
        """
        incoming_ids = {
            f.suggested_name: f for f in schema_a.fields
            if f.semantic_type in (SemanticType.IDENTIFIER, SemanticType.EMAIL)
        }
        existing_ids = {
            p.name: p for p in object_type.properties
            if p.semantic_type in (SemanticType.IDENTIFIER, SemanticType.EMAIL)
        }

        conflicting = []

        # Check for exact or near-exact matches
        for inc_name in incoming_ids:
            for ext_name in existing_ids:
                ratio = difflib.SequenceMatcher(None, inc_name, ext_name).ratio()
                if ratio >= 0.80:
                    return True, conflicting

        # Check for type conflicts on overlapping names
        incoming_all = {f.suggested_name: f for f in schema_a.fields}
        existing_all = {p.name: p for p in object_type.properties}

        for name in set(incoming_all.keys()) & set(existing_all.keys()):
            inc = incoming_all[name]
            ext = existing_all[name]
            if inc.data_type != ext.data_type or inc.semantic_type != ext.semantic_type:
                conflicting.append(name)

        return False, conflicting
