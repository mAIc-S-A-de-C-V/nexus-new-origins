import { pipelineClient } from './client';
import { Pipeline, PipelineRun, EventLogQualityScore } from '../types/pipeline';

export const pipelinesApi = {
  list: async (): Promise<Pipeline[]> => {
    const response = await pipelineClient.get<Pipeline[]>('/pipelines');
    return response.data;
  },

  get: async (id: string): Promise<Pipeline> => {
    const response = await pipelineClient.get<Pipeline>(`/pipelines/${id}`);
    return response.data;
  },

  create: async (data: Partial<Pipeline>): Promise<Pipeline> => {
    const response = await pipelineClient.post<Pipeline>('/pipelines', data);
    return response.data;
  },

  update: async (id: string, data: Partial<Pipeline>): Promise<Pipeline> => {
    const response = await pipelineClient.put<Pipeline>(`/pipelines/${id}`, data);
    return response.data;
  },

  run: async (id: string): Promise<PipelineRun> => {
    const response = await pipelineClient.post<PipelineRun>(`/pipelines/${id}/run`);
    return response.data;
  },

  getRuns: async (id: string): Promise<PipelineRun[]> => {
    const response = await pipelineClient.get<PipelineRun[]>(`/pipelines/${id}/runs`);
    return response.data;
  },

  getQuality: async (id: string): Promise<EventLogQualityScore> => {
    const response = await pipelineClient.get<EventLogQualityScore>(`/pipelines/${id}/quality`);
    return response.data;
  },
};
