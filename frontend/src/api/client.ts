import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

const SERVICE_URLS = {
  connector: import.meta.env.VITE_CONNECTOR_SERVICE_URL || 'http://localhost:8001',
  pipeline: import.meta.env.VITE_PIPELINE_SERVICE_URL || 'http://localhost:8002',
  inference: import.meta.env.VITE_INFERENCE_SERVICE_URL || 'http://localhost:8003',
  ontology: import.meta.env.VITE_ONTOLOGY_SERVICE_URL || 'http://localhost:8004',
  eventLog: import.meta.env.VITE_EVENT_LOG_SERVICE_URL || 'http://localhost:8005',
  audit: import.meta.env.VITE_AUDIT_SERVICE_URL || 'http://localhost:8006',
};

const createClient = (baseURL: string): AxiosInstance => {
  const instance = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor - add auth token
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('nexus_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    const tenantId = localStorage.getItem('nexus_tenant_id') || 'tenant-001';
    config.headers['X-Tenant-ID'] = tenantId;
    return config;
  });

  // Response interceptor
  instance.interceptors.response.use(
    (response: AxiosResponse) => response,
    (error) => {
      if (error.response?.status === 401) {
        // Handle unauthorized
        console.warn('Unauthorized request, redirecting to login');
      }
      if (error.response?.status === 429) {
        console.warn('Rate limited');
      }
      return Promise.reject(error);
    }
  );

  return instance;
};

export const connectorClient = createClient(SERVICE_URLS.connector);
export const pipelineClient = createClient(SERVICE_URLS.pipeline);
export const inferenceClient = createClient(SERVICE_URLS.inference);
export const ontologyClient = createClient(SERVICE_URLS.ontology);
export const eventLogClient = createClient(SERVICE_URLS.eventLog);
export const auditClient = createClient(SERVICE_URLS.audit);

export default connectorClient;
