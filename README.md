# Nexus Origins

Enterprise data integration and intelligence platform. Built by **MAIC S.A. de C.V.**

Nexus Origins connects, transforms, and operationalizes data across an organization through a unified web interface backed by 25+ microservices. It combines connector management, pipeline orchestration, ontology modeling, process mining, AI-powered agents, and real-time alerting into a single platform.

---

## Architecture

```
nexus-new-origins/
├── frontend/              # React 18 + Vite + TypeScript SPA
├── backend/               # Python FastAPI microservices (ports 8001-8025)
├── nexus-apps/            # Domain-specific app services (ports 9000-9001)
├── nginx/                 # Reverse proxy configuration
├── scripts/               # Deployment, backup, and utility scripts
├── qa/                    # Quality assurance and test results
└── docker-compose.yml     # Full stack orchestration
```

The platform follows a microservices architecture where each service owns its own domain logic, communicates via REST, and shares PostgreSQL and TimescaleDB for persistence. Redis provides caching and pub/sub. The React frontend connects to services through individual API clients, with an optional API Gateway for external consumers.

---

## Quick Start

### Full Stack (Docker)

```bash
# 1. Clone the repository
git clone <repo-url> && cd nexus-new-origins

# 2. Create .env file (see Environment Variables section)
cp .env.example .env

# 3. Set a default LLM key (optional but recommended for first run)
#    Tenants can override this and add their own providers from Settings → AI Models.
export ANTHROPIC_API_KEY=your_key_here

# 4. Start all services
docker-compose up --build
```

The frontend will be available at `http://localhost:3000`. New sign-ins land on the **Dashboards** module; returning users resume the last page they viewed.

### Frontend Only (Development)

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

### Production Overrides

```bash
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This enables JWT enforcement (`SKIP_AUTH=false`), secure cookies, and service-to-service auth validation.

---

## Services Reference

### Application Services

| Service | Port | Description |
|---------|------|-------------|
| Frontend | 3000 | React SPA served via nginx |
| Connector Service | 8001 | Data source management, connection testing, schema discovery |
| Pipeline Service | 8002 | DAG-based pipeline orchestration and execution |
| Inference Service | 8003 | Claude API proxy for schema inference, classification, and chat |
| Ontology Service | 8004 | Object type definitions, relationships, versioning |
| Event Log Service | 8005 | Time-series event ingestion and querying (TimescaleDB) |
| Audit Service | 8006 | User action audit trail and compliance logging |
| Schema Registry | 8007 | Centralized schema storage and validation |
| Correlation Engine | 8008 | Cross-source entity resolution and matching |
| Process Engine | 8009 | Process mining: discovery, conformance, variant analysis |
| Alert Engine | 8010 | Rule-based alerting with multi-channel notifications |
| Auth Service | 8011 | Authentication, authorization, SSO, MFA, tenant management |
| Logic Service | 8012 | Visual function builder and execution engine |
| Agent Service | 8013 | Configurable AI agents with tool use and memory |
| Utility Service | 8014 | Shared utilities, file handling, tenant helpers |
| Analytics Service | 8015 | Dashboards, metrics aggregation, token usage tracking |
| Eval Service | 8016 | Agent and logic function evaluation framework |
| Lineage Service | 8017 | End-to-end data lineage graph across connectors, pipelines, and ontology |
| Search Service | 8018 | Full-text and semantic search across platform entities |
| Data Quality Service | 8019 | Data profiling, quality rules, and anomaly detection |
| Collaboration Service | 8020 | Comments, annotations, and team collaboration features |
| API Gateway | 8021 | External API exposure for ontology data and platform resources |
| Admin Service | 8022 | Superadmin platform management, tenant provisioning, token tracking |
| Sepsis Demo Service | 8023 | Isolated demo dataset for process mining showcase |
| Demo Service | 8024 | General-purpose demo data and walkthrough support |
| WhatsApp Service | 8025 | WhatsApp Business API integration for connector and agent interaction |

### Nexus Apps

| Service | Port | Description |
|---------|------|-------------|
| Project Management | 9000 | Task boards, milestones, and project tracking |
| Finance Service | 9001 | Financial records, invoicing, and budget management |

### Infrastructure

| Service | Port | Description |
|---------|------|-------------|
| PostgreSQL 16 | 5432 | Primary relational database |
| TimescaleDB | 5434 | Time-series database for events and metrics |
| Redis 7 | 6379 | Caching, pub/sub, and session storage |
| Backup Service | -- | Automated daily backups with configurable retention |

---

## Frontend Modules

All modules are accessible from the NavRail sidebar:

| Module | Description |
|--------|-------------|
| Connectors | Source/destination management with live status, health history, schema explorer |
| Pipelines | Visual DAG builder with drag-and-drop node editor |
| Ontology Graph | React Flow canvas for object types, relationships, and versioned schemas |
| Data Explorer | Browse and query ontology object instances |
| Process Mining | Discovery, conformance checking, and variant analysis |
| Logic Studio | Visual function builder with test execution |
| Agent Studio | Configure AI agents with tools, memory, and evaluation |
| Evals | Evaluation suites for agents and logic functions |
| Apps | Domain-specific applications (Projects, Finance) |
| Event Log | Time-series event stream with filtering and drill-down |
| Human Actions | Manual review queues and approval workflows |
| Alerts | Rule configuration, notification channels, alert history |
| Utilities | File converters, data generators, and platform tools |
| Users | User management, roles, and tenant assignment |
| Settings | Platform and tenant configuration. Includes the **AI Models** tab where tenants register LLM providers (Anthropic / OpenAI / Azure OpenAI / Local), test connections, and pick a default. |
| Activity / Audit | Audit trail with user action history and compliance reports |
| Admin Hub | Tenant administration and platform settings |
| Platform | Superadmin console with impersonation and cross-tenant management |
| Data Quality | Data profiling dashboards and quality rule management |
| Value Monitor | Business value tracking and ROI metrics |
| Projects | Task boards and milestone tracking (Nexus App) |
| Finance | Financial management and invoicing (Nexus App) |
| Nexus Assistant | AI chat sidebar that can create connectors, objects, and pipelines |

---

## Authentication

The Auth Service provides multi-tenant authentication and authorization:

- **JWT (RS256)** -- Asymmetric token signing with configurable issuer
- **Roles** -- `superadmin`, `admin`, `analyst`, `viewer` with granular permissions
- **SSO Providers** -- Google, Okta, Azure AD
- **MFA** -- Multi-factor authentication support
- **Impersonation** -- Superadmins can impersonate any user for debugging
- **Tenant Isolation** -- All data is scoped by `tenant_id`; cross-tenant access restricted to superadmin
- **Dev Mode** -- `SKIP_AUTH=true` bypasses authentication for local development

---

## Key Features

**Connector Framework** -- Supports REST API, Database, File Upload, Webhook, and WhatsApp connector types. Includes dynamic header/query/body builders, connection testing with step-by-step logs, health monitoring, and automatic schema discovery.

**Pipeline DAG Builder** -- Visual editor with 13 node types for building data transformation pipelines. Supports scheduling, manual triggers, and real-time execution status. Each pipeline node operates as an individual step in a chain graph.

**Enterprise Ontology** -- Versioned object type definitions with field-level schema management. The 3-Scenario Resolver automatically routes new data mappings to enrichment (>0.85 similarity), conflict resolution (0.50-0.85), or new object type creation (<0.50).

**AI-Powered Inference** -- Schema inference, data classification, field mapping suggestions, and natural language interaction across the platform. Each tenant can register its own LLM providers from the Settings UI (Anthropic, OpenAI, Azure OpenAI, or any OpenAI-compatible local endpoint such as Ollama, vLLM, or LM Studio) and pick a default. Token usage is tracked and attributed per tenant + provider + model across all LLM calls.

**Bring Your Own LLM** -- Settings → AI Models lets each tenant add API keys, point to a self-hosted endpoint, register custom model IDs, test the connection, and mark a default. Agent Studio, the AIP Analyst, schema inference, app generation, and chat-with-data all route through the tenant's chosen provider; there is a graceful env-based Anthropic fallback when nothing is configured.

**Process Mining** -- Import event logs, discover process models, run conformance checks against expected flows, and analyze process variants with performance metrics.

**Logic Studio** -- Visual function builder for creating reusable data transformations and business logic. Functions can be tested in isolation and composed into pipelines.

**Agent Studio** -- Configure AI agents with access to platform tools (connectors, ontology, logic functions). Agents support memory, multi-turn conversations, and structured tool use via Claude.

**Nexus Assistant** -- In-app AI sidebar that understands the platform context. Can create connectors, define object types, build pipelines, and answer questions about your data through natural conversation.

**Real-Time Alerting** -- Rule-based alert engine with multi-channel notifications. Supports threshold, anomaly, and pattern-based triggers with configurable escalation.

**Superadmin Platform** -- Cross-tenant management console with user impersonation, tenant provisioning, token usage dashboards, and platform-wide configuration.

**API Gateway** -- Expose ontology data and platform resources to external systems through managed API endpoints with authentication and rate limiting.

---

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 18, TypeScript, Vite, Zustand, React Flow, Recharts, Tailwind CSS |
| UI | Custom design tokens, Lucide icons, Inter + JetBrains Mono fonts |
| Backend | Python 3.12, FastAPI, Pydantic v2, SQLAlchemy (async), uvicorn |
| AI | Anthropic Claude (default), OpenAI, Azure OpenAI, OpenAI-compatible local servers (Ollama, vLLM, LM Studio) — selectable per tenant |
| Database | PostgreSQL 16, TimescaleDB, Redis 7 |
| Infrastructure | Docker, Docker Compose, nginx |
| CI/CD | GitHub Actions |
| Hosting | AWS EC2 with Elastic IP |

---

## Deployment

The platform deploys via Docker Compose on an EC2 instance with an Elastic IP:

1. **GitHub Actions** -- Pushes to `main` trigger the CI/CD pipeline defined in `.github/workflows/deploy.yml`
2. **Docker Compose** -- All services are built and orchestrated via `docker-compose.yml` with production overrides in `docker-compose.prod.yml`
3. **nginx** -- Reverse proxy handles TLS termination and routes requests to services
4. **Backups** -- Automated daily PostgreSQL and TimescaleDB backups with configurable retention (default: 30 days)

See [DEPLOY.md](DEPLOY.md) for detailed deployment instructions.

---

## Environment Variables

Create a `.env` file in the project root with the following variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Recommended | Default Anthropic key. Used as a platform-wide fallback when a tenant has no provider configured in Settings → AI Models. |
| `JWT_PRIVATE_KEY_PEM` | Prod | RSA private key (PEM) for JWT signing |
| `ADMIN_SEED_PASSWORD` | No | Initial superadmin password (default provided) |
| `GOOGLE_CLIENT_ID` | No | Google OAuth client ID for SSO |
| `GOOGLE_CLIENT_SECRET` | No | Google OAuth client secret |
| `OKTA_CLIENT_ID` | No | Okta OAuth client ID |
| `OKTA_CLIENT_SECRET` | No | Okta OAuth client secret |
| `OKTA_BASE_URL` | No | Okta tenant base URL |
| `AZURE_CLIENT_ID` | No | Azure AD client ID |
| `AZURE_CLIENT_SECRET` | No | Azure AD client secret |
| `AZURE_TENANT_ID` | No | Azure AD tenant ID (default: `common`) |
| `SKIP_AUTH` | No | Set to `true` to bypass auth in development |
| `ALLOWED_ORIGIN_EC2` | No | Additional allowed CORS origin for production |
| `APP_BASE_URL` | No | Frontend URL for OAuth callbacks (default: `http://localhost:3000`) |
| `SMTP_HOST` | No | SMTP server for email notifications |
| `SMTP_PORT` | No | SMTP port (default: `587`) |
| `SMTP_USER` | No | SMTP username |
| `SMTP_PASSWORD` | No | SMTP password |
| `SMTP_FROM` | No | Sender email address |
| `BACKUP_ENCRYPTION_KEY` | No | Encryption key for backup archives |
| `POSTGRES_USER` | No | PostgreSQL user (default: `nexus`) |
| `POSTGRES_PASSWORD` | No | PostgreSQL password (default: `nexus_pass`) |

Database URLs and inter-service URLs are preconfigured in `docker-compose.yml` and generally do not need to be overridden.

---

## License

Proprietary. All rights reserved by MAIC S.A. de C.V.
