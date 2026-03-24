import { ontologyClient, inferenceClient } from './client';
import { ObjectType, ObjectTypeVersion, SchemaDiff, EnrichmentProposal, FieldConflict } from '../types/ontology';
import { InferenceResult } from '../types/inference';

export const ontologyApi = {
  listObjectTypes: async (): Promise<ObjectType[]> => {
    const response = await ontologyClient.get<ObjectType[]>('/object-types');
    return response.data;
  },

  getObjectType: async (id: string): Promise<ObjectType> => {
    const response = await ontologyClient.get<ObjectType>(`/object-types/${id}`);
    return response.data;
  },

  createObjectType: async (data: Partial<ObjectType>): Promise<ObjectType> => {
    const response = await ontologyClient.post<ObjectType>('/object-types', data);
    return response.data;
  },

  updateObjectType: async (id: string, data: Partial<ObjectType>): Promise<ObjectType> => {
    const response = await ontologyClient.put<ObjectType>(`/object-types/${id}`, data);
    return response.data;
  },

  getVersionHistory: async (id: string): Promise<ObjectTypeVersion[]> => {
    const response = await ontologyClient.get<ObjectTypeVersion[]>(`/object-types/${id}/versions`);
    return response.data;
  },

  applyEnrichment: async (id: string, proposal: EnrichmentProposal): Promise<ObjectType> => {
    const response = await ontologyClient.post<ObjectType>(`/object-types/${id}/enrich`, proposal);
    return response.data;
  },

  resolveConflict: async (id: string, conflicts: FieldConflict[]): Promise<ObjectType> => {
    const response = await ontologyClient.post<ObjectType>(`/object-types/${id}/resolve-conflict`, conflicts);
    return response.data;
  },

  getDiff: async (id: string, v1: number, v2: number): Promise<SchemaDiff> => {
    const response = await ontologyClient.get<SchemaDiff>(`/object-types/${id}/diff/${v1}/${v2}`);
    return response.data;
  },
};

export const inferenceApi = {
  inferSchema: async (rawSchema: Record<string, unknown>, sampleRows: Record<string, unknown>[]): Promise<InferenceResult> => {
    const response = await inferenceClient.post<InferenceResult>('/infer/schema', { raw_schema: rawSchema, sample_rows: sampleRows });
    return response.data;
  },

  scoreSimilarity: async (schemaA: InferenceResult, objectTypeId: string): Promise<import('../types/ontology').SimilarityScore> => {
    const response = await inferenceClient.post('/infer/similarity', { schema_a: schemaA, object_type_id: objectTypeId });
    return response.data;
  },

  detectConflicts: async (existingObject: ObjectType, incomingSchema: InferenceResult): Promise<FieldConflict[]> => {
    const response = await inferenceClient.post<FieldConflict[]>('/infer/conflicts', { existing_object: existingObject, incoming_schema: incomingSchema });
    return response.data;
  },
};
