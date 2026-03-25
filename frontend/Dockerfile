FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .

ARG VITE_CONNECTOR_SERVICE_URL
ARG VITE_PIPELINE_SERVICE_URL
ARG VITE_INFERENCE_SERVICE_URL
ARG VITE_ONTOLOGY_SERVICE_URL
ARG VITE_EVENT_LOG_SERVICE_URL
ARG VITE_AUDIT_SERVICE_URL
ARG VITE_CORRELATION_ENGINE_URL

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
