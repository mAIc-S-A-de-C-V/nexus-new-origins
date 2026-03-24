# Nexus Origins — Enterprise Data Integration Platform

A full-stack enterprise data integration platform with:
- React frontend with visual pipeline builder, ontology graph, and connector management
- Python FastAPI microservices for connectors, pipelines, ontology, inference (Claude), and more

## Quick Start (Frontend Only)

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:3000
```

## Architecture

```
nexus-new-origins/
├── frontend/          # React 18 + Vite + TypeScript
│   └── src/
│       ├── modules/
│       │   ├── connectors/   # ConnectorGrid + DetailPanel
│       │   ├── pipeline/     # PipelineBuilder (React Flow)
│       │   ├── ontology/     # OntologyGraph + ScenarioResolver
│       │   └── lineage/      # Data lineage canvas
│       ├── store/            # Zustand state management
│       └── api/              # Axios API clients
└── backend/
    ├── shared/               # Pydantic models + enums
    ├── connector_service/    # Port 8001
    ├── pipeline_service/     # Port 8002
    ├── inference_service/    # Port 8003 (Claude API)
    ├── ontology_service/     # Port 8004
    ├── event_log_service/    # Port 8005
    ├── audit_service/        # Port 8006
    ├── schema_registry/      # Port 8007
    └── correlation_engine/   # Port 8008
```

## Frontend Features

- **Connectors** — 14 connector types with live status, health history, schema explorer
- **Ontology Graph** — React Flow canvas for object type relationships with 3-scenario resolver
- **Pipeline Builder** — Visual DAG editor with 10 node types, drag-and-drop
- **Design System** — Custom tokens, no shadows, 4px radius cards, Inter + JetBrains Mono

## Backend Services

Each service runs independently with FastAPI + Pydantic v2:

```bash
cd backend/connector_service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

## Docker (Full Stack)

```bash
# Set your API key for Claude inference
export ANTHROPIC_API_KEY=your_key_here

docker-compose up
```

## The 3-Scenario Ontology Resolver

When a new connector is mapped, the system computes a similarity score and routes to:

1. **Enrichment** (score > 0.85 + pk_resolvable): Add fields to existing object type
2. **Conflict** (score 0.50–0.85): Show field-level conflicts with resolution options
3. **New Object Type** (score < 0.50): Propose a new canonical object type

## Mock Data Included

The frontend ships with rich mock data:
- 4 connectors: Salesforce (live), HubSpot (active), PostgreSQL (idle), File Upload (idle)
- 3 object types: Customer, SalesOrder, Product
- 3 pipelines: SF→Customer (running), PG→Product (idle), SF→EventLog (failed)
- 2 ontology links: SalesOrder belongs_to Customer, SalesOrder has_many Product

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, React Flow, Zustand, TanStack Query |
| UI | Custom design tokens, Lucide icons, no component library |
| Backend | Python 3.12, FastAPI 0.111, Pydantic v2 |
| AI | Anthropic Claude claude-sonnet-4-6 |
| DB | PostgreSQL 16, TimescaleDB, Redis |
| Infra | Docker Compose |
