# `src/api/` — HTTP clients

4 axios-based clients with interceptors. **Beyond these 4, modules talk to backend via raw `fetch()` (which the global interceptor in `main.tsx` decorates with auth headers).**

## Files

| File | Purpose |
|------|---------|
| `client.ts` | Factory + interceptors. Exports `connectorClient`, `pipelineClient`, `inferenceClient`, `ontologyClient`, `eventLogClient`, `auditClient`. |
| `connectors.ts` | `connectorsApi` — list/get/create/update/delete/testConnection/getSchema/getHealth. |
| `ontology.ts` | `ontologyApi` (object types CRUD + versioning + enrichment + diffs) and `inferenceApi` (schema/similarity/conflicts). |
| `pipelines.ts` | `pipelinesApi` — list/get/create/update/run/getRuns/getQuality. |

## Service URLs (env-driven, all with localhost fallbacks)

```
VITE_CONNECTOR_SERVICE_URL  → 8001
VITE_PIPELINE_SERVICE_URL   → 8002
VITE_INFERENCE_SERVICE_URL  → 8003
VITE_ONTOLOGY_SERVICE_URL   → 8004
VITE_EVENT_LOG_SERVICE_URL  → 8005
VITE_AUDIT_SERVICE_URL      → 8006
```

(See `docker-compose.yml` frontend build args for the full list of `VITE_*_URL` envs feeding the bundle.)

## Interceptors (in `client.ts`)

- **Request:** inject `Authorization: Bearer <accessToken>` + `X-Tenant-ID` from `authStore` helpers.
- **Response:** log 401 + 429.
- 30s timeout, JSON content-type.

## Patterns

```typescript
// Example: connectors.ts
export const connectorsApi = {
  list:   ()             => connectorClient.get('/connectors'),
  get:    (id)           => connectorClient.get(`/connectors/${id}`),
  create: (data)         => connectorClient.post('/connectors', data),
  update: (id, data)     => connectorClient.put(`/connectors/${id}`, data),
  delete: (id)           => connectorClient.delete(`/connectors/${id}`),
  testConnection: (id)   => connectorClient.post(`/connectors/${id}/test`),
  getSchema:      (id)   => connectorClient.get(`/connectors/${id}/schema`),
  getHealth:      (id)   => connectorClient.get(`/connectors/${id}/health`),
};
```

## When to edit

| Intent | File |
|--------|------|
| Add a method to an existing client | `api/<service>.ts`. |
| Add a new client for a new service | new file in `api/` + create a fresh axios instance via factory in `client.ts`. |
| Change auth header strategy | both `api/client.ts` request interceptor AND `main.tsx` global fetch interceptor. |
| Add request retry/backoff | wrap axios instance with interceptor or use `axios-retry`. |
| Add CSRF | request interceptor in `client.ts`. |
