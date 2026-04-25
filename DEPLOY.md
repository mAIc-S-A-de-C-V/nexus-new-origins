# Nexus -- Deployment Guide

Operator-focused reference for deploying and maintaining Nexus on the production EC2 instance.

---

## SSH Access

```bash
ssh -i ~/.ssh/maic-prod.pem ec2-user@52.202.36.168
```

The key file `maic-prod.pem` must be on your local machine at `~/.ssh/maic-prod.pem` with `chmod 400` permissions.

---

## EC2 Instance Details

| Field | Value |
|---|---|
| **Elastic IP** | `52.202.36.168` |
| **Instance ID** | `i-02a7b2cc367418aff` |
| **Type** | `t3.large` (2 vCPU, 8 GB RAM) |
| **Region** | `us-east-1` |
| **OS** | Amazon Linux 2023 |
| **Frontend URL** | http://52.202.36.168:3000 |

> **Note:** The instance uses an AWS Elastic IP (`52.202.36.168`). This IP persists across
> instance stops/starts. All references to the old IP `13.221.101.212` are obsolete --
> if you see that IP anywhere (GitHub secrets, `.env` files, browser cache), update it to
> `52.202.36.168`.

---

## Default Admin Login

| | |
|---|---|
| **Email** | `admin@maic.ai` |
| **Password** | `NexusSuperAdmin2026!` |

The password is set by `ADMIN_SEED_PASSWORD` in the `.env` file and is seeded on first boot by `auth-service`.

---

## First-Time Setup

Run these steps on a fresh EC2 instance (already done for production):

```bash
# Install Docker and Docker Compose (Amazon Linux 2023)
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Install docker-compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
  -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone the repo
git clone https://github.com/mAIc-S-A-de-C-V/nexus-new-origins.git
cd nexus-new-origins

# Create the root .env file (see Environment Variables section below)
# Then build and start everything
sudo DOCKER_BUILDKIT=0 docker-compose up -d --build
```

---

## Environment Variables

The root `.env` file is read by `docker-compose.yml` for both build-time args (Vite URLs baked into the frontend) and runtime secrets. Create it at the repo root on the server:

```bash
# ---- Secrets ----
# ANTHROPIC_API_KEY is the platform-wide fallback used when a tenant has not
# registered its own provider in Settings → AI Models. It is recommended but
# not strictly required: tenants can bring their own Anthropic / OpenAI /
# Azure / local Ollama / vLLM / LM Studio endpoints from the UI.
ANTHROPIC_API_KEY=sk-ant-...
ADMIN_SEED_PASSWORD=NexusSuperAdmin2026!

# ---- Auth behavior ----
SKIP_AUTH=true          # set to false for production (docker-compose.prod.yml forces false)

# ---- CORS: EC2 origin allowed by all backend services ----
ALLOWED_ORIGIN_EC2=http://52.202.36.168:3000

# ---- Vite build args (baked into frontend at build time) ----
VITE_CONNECTOR_SERVICE_URL=http://52.202.36.168:8001
VITE_PIPELINE_SERVICE_URL=http://52.202.36.168:8002
VITE_INFERENCE_SERVICE_URL=http://52.202.36.168:8003
VITE_ONTOLOGY_SERVICE_URL=http://52.202.36.168:8004
VITE_EVENT_LOG_SERVICE_URL=http://52.202.36.168:8005
VITE_AUDIT_SERVICE_URL=http://52.202.36.168:8006
VITE_CORRELATION_ENGINE_URL=http://52.202.36.168:8008
VITE_PROCESS_ENGINE_URL=http://52.202.36.168:8009
VITE_ALERT_ENGINE_URL=http://52.202.36.168:8010
VITE_AUTH_SERVICE_URL=http://52.202.36.168:8011
VITE_LOGIC_SERVICE_URL=http://52.202.36.168:8012
VITE_AGENT_SERVICE_URL=http://52.202.36.168:8013
VITE_UTILITY_SERVICE_URL=http://52.202.36.168:8014
VITE_ANALYTICS_SERVICE_URL=http://52.202.36.168:8015
VITE_EVAL_SERVICE_URL=http://52.202.36.168:8016
VITE_LINEAGE_SERVICE_URL=http://52.202.36.168:8017
VITE_SEARCH_SERVICE_URL=http://52.202.36.168:8018
VITE_DATA_QUALITY_SERVICE_URL=http://52.202.36.168:8019
VITE_COLLABORATION_SERVICE_URL=http://52.202.36.168:8020
VITE_API_GATEWAY_URL=http://52.202.36.168:8021
VITE_ADMIN_SERVICE_URL=http://52.202.36.168:8022
VITE_PROJECT_MGMT_URL=http://52.202.36.168:9000
VITE_FINANCE_SERVICE_URL=http://52.202.36.168:9001
```

A copy should also exist at `frontend/.env` as a Vite fallback (same `VITE_*` keys only). The CI/CD pipeline writes both files automatically.

---

## Manual Redeploy

```bash
ssh -i ~/.ssh/maic-prod.pem ec2-user@52.202.36.168
cd nexus-new-origins
git pull
sudo DOCKER_BUILDKIT=0 docker-compose build --no-cache
sudo DOCKER_BUILDKIT=0 docker-compose up -d --force-recreate
```

If you only changed backend code and the frontend `.env` has not changed, you can skip `--no-cache` for a faster build:

```bash
sudo DOCKER_BUILDKIT=0 docker-compose up -d --build
```

---

## Rebuilding Individual Services

To rebuild and restart a single service without touching the rest:

```bash
sudo DOCKER_BUILDKIT=0 docker-compose build --no-cache <service-name>
sudo docker-compose up -d --force-recreate <service-name>
```

Examples:

```bash
# Rebuild only the frontend (e.g., after changing VITE_* URLs)
sudo DOCKER_BUILDKIT=0 docker-compose build --no-cache frontend
sudo docker-compose up -d --force-recreate frontend

# Rebuild only the connector service
sudo DOCKER_BUILDKIT=0 docker-compose build --no-cache connector-service
sudo docker-compose up -d --force-recreate connector-service
```

---

## GitHub Actions CI/CD

Defined in `.github/workflows/deploy.yml`. On every push to `main`:

1. **Security scan** -- `pip-audit` on all `requirements.txt` files + Trivy filesystem scan for HIGH/CRITICAL vulnerabilities.
2. **Deploy** -- SSHes into EC2, runs `git reset --hard origin/main`, writes `.env` and `frontend/.env` from secrets, builds all images with `--no-cache`, and recreates containers.

### Required GitHub Secrets

Set these in the repo under **Settings > Secrets and variables > Actions**:

| Secret | Value |
|---|---|
| `EC2_HOST` | `52.202.36.168` (must match the Elastic IP) |
| `EC2_USER` | `ec2-user` |
| `EC2_SSH_KEY` | Full contents of `~/.ssh/maic-prod.pem` |
| `ANTHROPIC_API_KEY` | Default Anthropic key (platform fallback when tenants have no LLM provider configured in Settings → AI Models) |

> **Important:** If the Elastic IP ever changes, you must update the `EC2_HOST` secret in GitHub. The deploy script derives all `VITE_*` URLs and `ALLOWED_ORIGIN_EC2` from this value.

---

## Running the Insurance Demo

```bash
ssh -i ~/.ssh/maic-prod.pem ec2-user@52.202.36.168
cd nexus-new-origins
bash backend/demo_service/setup_insurance_demo.sh
```

This seeds the demo dataset and configures connectors, pipelines, and ontology objects for the insurance use case.

---

## Complete Services and Ports

### Application Services

| Service | Container Name | Port | Description |
|---|---|---|---|
| Frontend | `frontend` | 3000 | Vite/React UI |
| Connector Service | `connector-service` | 8001 | Data source connectors (REST, DB, file) |
| Pipeline Service | `pipeline-service` | 8002 | ETL / data pipeline orchestration |
| Inference Service | `inference-service` | 8003 | LLM inference — Anthropic / OpenAI / Azure / local, routed per tenant |
| Ontology Service | `ontology-service` | 8004 | Object types, link types, properties |
| Event Log Service | `event-log-service` | 8005 | TimescaleDB-backed event stream |
| Audit Service | `audit-service` | 8006 | Audit trail logging |
| Schema Registry | `schema-registry` | 8007 | Schema versioning |
| Correlation Engine | `correlation-engine` | 8008 | Entity resolution / linking |
| Process Engine | `process-engine-service` | 8009 | Workflow / process execution |
| Alert Engine | `alert-engine-service` | 8010 | Rule-based alerting |
| Auth Service | `auth-service` | 8011 | Authentication, JWT, SSO |
| Logic Service | `logic-service` | 8012 | Business rules, AI functions |
| Agent Service | `agent-service` | 8013 | Autonomous AI agents (tool-use over Anthropic + OpenAI-compatible providers); also exposes `/model-providers` CRUD for tenant LLM configuration |
| Utility Service | `utility-service` | 8014 | Shared utilities (file parsing, etc.) |
| Analytics Service | `analytics-service` | 8015 | Dashboards and analytics |
| Eval Service | `eval-service` | 8016 | Agent/logic evaluation harness |
| Lineage Service | `lineage-service` | 8017 | Data lineage tracking |
| Search Service | `search-service` | 8018 | Full-text search |
| Data Quality Service | `data-quality-service` | 8019 | Data quality rules and scoring |
| Collaboration Service | `collaboration-service` | 8020 | Comments, annotations, sharing |
| API Gateway | `api-gateway-service` | 8021 | External API management |
| Admin Service | `admin-service` | 8022 | Platform administration |
| Sepsis Service | `sepsis-service` | 8023 | Sepsis test dataset (isolated) |
| Demo Service | `demo-service` | 8024 | Demo data seeding |
| WhatsApp Service | `whatsapp-service` | 8025 | WhatsApp bot integration |

### Nexus Apps

| Service | Port | Description |
|---|---|---|
| Project Management | 9000 | Task boards, milestones |
| Finance Service | 9001 | Financial data and reporting |

### Infrastructure

| Service | Port (host) | Description |
|---|---|---|
| PostgreSQL 16 | 5432 | Primary relational database |
| TimescaleDB (PG 16) | 5434 | Time-series event store |
| Redis 7 | 6379 | Cache and queue broker |
| Backup Service | -- | Cron-based nightly Postgres backup |

> In production (`docker-compose.prod.yml`), ports for infrastructure services, schema-registry, correlation-engine, process-engine, and utility-service are removed from the host. They remain accessible only within the `nexus-net` Docker network.

---

## Useful Docker Commands

All commands assume you are in the `nexus-new-origins` directory on the server.

```bash
# List all running containers with status
sudo docker-compose ps

# Follow logs for a specific service
sudo docker-compose logs -f connector-service

# Tail the last 100 lines of a service
sudo docker-compose logs --tail=100 auth-service

# Restart a single service (no rebuild)
sudo docker-compose restart connector-service

# Open a shell inside a running container
sudo docker exec -it nexus-new-origins-connector-service-1 bash

# Live resource usage for all containers
sudo docker stats

# Stop everything (preserves volumes/data)
sudo docker-compose down

# Stop everything AND delete all data volumes (destructive)
sudo docker-compose down -v

# Free disk space: remove unused images, containers, build cache
sudo docker system prune -af
sudo docker builder prune -af
```

---

## Common Issues

### Disk full / builds failing

The t3.large instance has limited disk. Docker images and build cache accumulate fast.

```bash
# Check disk usage
df -h

# Aggressive cleanup
sudo docker system prune -af
sudo docker builder prune -af
```

### CORS errors in the browser

Every backend service reads `ALLOWED_ORIGINS`, which includes `${ALLOWED_ORIGIN_EC2}` from the `.env` file. If CORS errors appear:

1. Verify `ALLOWED_ORIGIN_EC2=http://52.202.36.168:3000` is set in the root `.env`.
2. Restart the affected service: `sudo docker-compose restart <service-name>`.
3. Make sure you are accessing the frontend at `http://52.202.36.168:3000` (not the old IP or `localhost`).

### Old IP baked into frontend

Vite URLs are baked in at build time. If the frontend is still calling an old IP:

1. Update `VITE_*` values in both `.env` and `frontend/.env`.
2. Rebuild the frontend with `--no-cache`:

```bash
sudo DOCKER_BUILDKIT=0 docker-compose build --no-cache frontend
sudo docker-compose up -d --force-recreate frontend
```

### A single service keeps crashing

```bash
# Check the logs
sudo docker-compose logs --tail=200 <service-name>

# Force full rebuild of just that service
sudo DOCKER_BUILDKIT=0 docker-compose build --no-cache <service-name>
sudo docker-compose up -d --force-recreate <service-name>
```

### Database connection errors on first boot

Postgres and TimescaleDB have healthchecks, but on very slow first boots they may not be ready in time. Restart the dependent services:

```bash
sudo docker-compose restart connector-service pipeline-service ontology-service auth-service
```
