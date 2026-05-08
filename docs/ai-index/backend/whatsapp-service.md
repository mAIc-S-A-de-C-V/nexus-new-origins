# whatsapp-service (port 8025)

**Purpose:** WhatsApp Business API integration via Baileys. Sessions (QR auth), chats (groups + 1:1), messages, participants. Persists encrypted credentials.
**Stack:** TypeScript Fastify, Postgres (`pg`), Baileys (`@whiskeysockets/baileys`), Node 18.
**Path:** `/Users/ishmontalvo/Desktop/nexus-new-origins/backend/whatsapp_service/`

## Files

```
whatsapp_service/
├── src/
│   ├── index.ts                       Fastify app; runMigrations + sessionManager.restoreAll on startup
│   ├── db/
│   │   ├── pool.ts                   pg.Pool
│   │   └── migrations/
│   │       └── 001_whatsapp_tables.sql
│   ├── sessions/
│   │   ├── manager.ts                SessionManager class — start/stop/unlinkAndRestart/restoreAll
│   │   └── session.ts                Single Baileys session with QR + event emitters
│   └── routes/
│       ├── sessions.ts               Start/stop/unlink/status + QR SSE
│       ├── chats.ts                  List + monitor toggle
│       └── messages.ts               History + send + react
├── package.json                       fastify, pg, @whiskeysockets/baileys
├── tsconfig.json
├── Dockerfile                         Node 18 + pnpm
└── README.md
```

## Tables (`001_whatsapp_tables.sql`)

| Table | Notes |
|-------|-------|
| `wa_sessions` | `connector_id` PK; tenant_id; status (`disconnected`/`qr_pending`/`connected`); phone_number; **auth_creds JSONB**, **auth_keys JSONB**; last_connected, last_error |
| `wa_chats` | `jid` PK; connector_id FK; chat_type (`individual`/`group`); name, description, participant_count; `is_monitored` BOOL; INDEX (connector_id, is_monitored) |
| `wa_messages` | id+connector_id PK; chat_jid, sender_jid, sender_name; timestamp TIMESTAMPTZ; message_type (`text`/`media`/`system`/`reaction`); text, quoted_msg_id, media_url, media_mime; raw_json JSONB; INDEX (connector_id, chat_jid, timestamp DESC) |
| `wa_participants` | (chat_jid, connector_id, user_jid) PK; display_name, is_admin |

## Endpoints (mounted under `/api/v1`)

### Sessions (`routes/sessions.ts`)

| Method | Path | Body | Purpose |
|--------|------|------|---------|
| POST | `/sessions/:connectorId/start` | `{tenantId?}` | Start session; emits QR if first time. |
| DELETE | `/sessions/:connectorId/stop` | — | Disconnect. |
| POST | `/sessions/:connectorId/unlink` | `{tenantId?}` | Clear creds + restart fresh QR. |
| GET | `/sessions/:connectorId/status` | — | Poll status. |
| GET (SSE) | `/sessions/:connectorId/qr` | — | Stream `{qr, status}` updates. |

Tenant lookup order: `x-tenant-id` header → request body `tenantId` → fetch `connector-service /connectors/{id}` for `tenant_id` → fallback `tenant-001`.

### Chats (`routes/chats.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/chats?connectorId=X&monitored=bool` | List, optionally only monitored. |
| POST | `/chats/:chatId/monitor` | Enable Nexus event syncing → POSTs to event-log-service for monitored messages. |
| DELETE | `/chats/:chatId/monitor` | Disable. |

### Messages (`routes/messages.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/messages?connectorId=X&chatId=Y&limit=...&offset=...&from_date&to_date` | History. |
| POST | `/messages/send` | Send outbound (requires connected session). |
| POST | `/messages/:id/react` | Add emoji reaction. |

## Cross-service

| → | URL | Why |
|---|-----|-----|
| connector-service | `/connectors/{id}` | Resolve tenant for a connector_id. |
| event-log-service | `/events` (batch) | When `is_monitored=true`, post incoming messages as events. |

Inbound: connector-service WHATSAPP-type connectors call into this service for schema fetch.

## Env

`DATABASE_URL`, `PORT` (8025), `INFERENCE_SERVICE_URL`, `ONTOLOGY_SERVICE_URL`, `CONNECTOR_SERVICE_URL`, `PIPELINE_SERVICE_URL`, `LOGIC_SERVICE_URL`, `AGENT_SERVICE_URL`.

## When to edit

| Intent | File |
|--------|------|
| Add a new message_type | `db/migrations/*` (or new migration) + ingestion in `session.ts`. |
| Persist new chat metadata | extend `wa_chats` columns + `routes/chats.ts`. |
| Add backfill on monitor enable | `routes/chats.ts:POST /:chatId/monitor` — fetch history, POST to event-log. |
| Add Nexus event hooks | `session.ts` event emitters → POST to event-log-service. |
| Send media | `routes/messages.ts:POST /messages/send` — accept media_url. |
| Implement different account types | `sessions/session.ts` Baileys auth flow. |
