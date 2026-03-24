export type SemanticType =
  | 'IDENTIFIER'
  | 'PERSON_NAME'
  | 'EMAIL'
  | 'PHONE'
  | 'ADDRESS'
  | 'DATE'
  | 'DATETIME'
  | 'CURRENCY'
  | 'QUANTITY'
  | 'PERCENTAGE'
  | 'CATEGORY'
  | 'STATUS'
  | 'URL'
  | 'BOOLEAN'
  | 'TEXT';

export type PiiLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

export type ConflictType = 'VOCABULARY' | 'TYPE' | 'GRANULARITY' | 'SCALE';

export type ConflictResolution =
  | 'NAMESPACE_BOTH'
  | 'NORMALIZE_CANONICAL'
  | 'KEEP_EXISTING'
  | 'REPLACE'
  | 'PENDING';

export interface ObjectProperty {
  id: string;
  name: string;
  displayName: string;
  semanticType: SemanticType;
  dataType: string;
  piiLevel: PiiLevel;
  required: boolean;
  sourceConnectorId?: string;
  description?: string;
  sampleValues?: string[];
  inferenceConfidence?: number;
}

export interface OntologyLink {
  id: string;
  sourceObjectTypeId: string;
  targetObjectTypeId: string;
  relationshipType: 'has_many' | 'belongs_to' | 'has_one' | 'many_to_many';
  joinKeys: { source: string; target: string }[];
  isInferred: boolean;
  confidence?: number;
  label?: string;
}

export interface ObjectType {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  properties: ObjectProperty[];
  sourceConnectorIds: string[];
  version: number;
  schemaHealth: 'healthy' | 'warning' | 'degraded';
  createdAt: string;
  updatedAt: string;
  tenantId: string;
  position?: { x: number; y: number };
}

export interface PropertyDiff {
  propertyName: string;
  changeType: 'ADDED' | 'REMOVED' | 'MODIFIED';
  oldValue?: Partial<ObjectProperty>;
  newValue?: Partial<ObjectProperty>;
  breakingChange: boolean;
}

export interface SchemaDiff {
  objectTypeId: string;
  fromVersion: number;
  toVersion: number;
  diffs: PropertyDiff[];
  hasBreakingChanges: boolean;
  generatedAt: string;
}

export interface ObjectTypeVersion {
  id: string;
  objectTypeId: string;
  version: number;
  snapshot: ObjectType;
  changeDescription?: string;
  createdAt: string;
  createdBy: string;
}

export interface SimilarityScore {
  schemaAId: string;
  objectTypeId: string;
  fieldNameOverlap: number;
  semanticTypeOverlap: number;
  sampleValueOverlap: number;
  primaryKeyResolvable: boolean;
  conflictingFields: string[];
  compositeScore: number;
  computedAt: string;
}

export interface EnrichmentProposal {
  id: string;
  existingObjectTypeId: string;
  newProperties: ObjectProperty[];
  joinKey: { existingField: string; incomingField: string };
  backfillStrategy?: string;
  similarityScore: number;
  sourceConnectorId: string;
  createdAt: string;
}

export interface FieldConflict {
  fieldName: string;
  conflictType: ConflictType;
  existingShape: Record<string, unknown>;
  incomingShape: Record<string, unknown>;
  suggestedResolution: ConflictResolution;
  resolutionApplied?: ConflictResolution;
}

export interface NewObjectProposal {
  id: string;
  suggestedName: string;
  suggestedProperties: ObjectProperty[];
  suggestedLinks: Omit<OntologyLink, 'id'>[];
  parentObjectTypeId?: string;
  isSubType: boolean;
  similarityScore: number;
  sourceConnectorId: string;
  createdAt: string;
}
