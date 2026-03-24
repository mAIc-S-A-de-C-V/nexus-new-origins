import { SemanticType, PiiLevel } from './ontology';

export interface FieldInference {
  sourceField: string;
  suggestedName: string;
  semanticType: SemanticType;
  dataType: string;
  piiLevel: PiiLevel;
  confidence: number;
  reasoning: string;
  sampleValues: string[];
  nullable: boolean;
}

export interface InferenceResult {
  id: string;
  connectorId: string;
  fields: FieldInference[];
  suggestedObjectTypeName: string;
  overallConfidence: number;
  inferredAt: string;
  modelVersion: string;
  rawSchemaHash: string;
  warnings?: string[];
}
