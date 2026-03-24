import { connectorClient } from './client';
import { ConnectorConfig, ConnectorHealth, RawSchema } from '../types/connector';

export const connectorsApi = {
  list: async (): Promise<ConnectorConfig[]> => {
    const response = await connectorClient.get<ConnectorConfig[]>('/connectors');
    return response.data;
  },

  get: async (id: string): Promise<ConnectorConfig> => {
    const response = await connectorClient.get<ConnectorConfig>(`/connectors/${id}`);
    return response.data;
  },

  create: async (data: Partial<ConnectorConfig>): Promise<ConnectorConfig> => {
    const response = await connectorClient.post<ConnectorConfig>('/connectors', data);
    return response.data;
  },

  update: async (id: string, data: Partial<ConnectorConfig>): Promise<ConnectorConfig> => {
    const response = await connectorClient.put<ConnectorConfig>(`/connectors/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await connectorClient.delete(`/connectors/${id}`);
  },

  testConnection: async (id: string): Promise<{ success: boolean; latencyMs: number; error?: string }> => {
    const response = await connectorClient.post(`/connectors/${id}/test`);
    return response.data;
  },

  getSchema: async (id: string): Promise<RawSchema> => {
    const response = await connectorClient.get<RawSchema>(`/connectors/${id}/schema`);
    return response.data;
  },

  getHealth: async (id: string): Promise<ConnectorHealth[]> => {
    const response = await connectorClient.get<ConnectorHealth[]>(`/connectors/${id}/health`);
    return response.data;
  },
};
