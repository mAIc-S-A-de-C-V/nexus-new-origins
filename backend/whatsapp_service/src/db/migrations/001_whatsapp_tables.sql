-- WhatsApp sessions: one row per WHATSAPP connector
CREATE TABLE IF NOT EXISTS wa_sessions (
  connector_id   TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'disconnected',
  phone_number   TEXT,
  auth_creds     JSONB,
  auth_keys      JSONB,
  last_connected TIMESTAMPTZ,
  last_error     TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_tenant ON wa_sessions(tenant_id);

-- WhatsApp chats (groups and 1:1 conversations)
CREATE TABLE IF NOT EXISTS wa_chats (
  jid            TEXT NOT NULL,
  connector_id   TEXT NOT NULL REFERENCES wa_sessions(connector_id) ON DELETE CASCADE,
  chat_type      TEXT NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT,
  is_monitored   BOOLEAN NOT NULL DEFAULT FALSE,
  participant_count INTEGER DEFAULT 0,
  first_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (jid, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_chats_connector ON wa_chats(connector_id);
CREATE INDEX IF NOT EXISTS idx_wa_chats_monitored ON wa_chats(connector_id, is_monitored) WHERE is_monitored = TRUE;

-- WhatsApp messages
CREATE TABLE IF NOT EXISTS wa_messages (
  id             TEXT NOT NULL,
  connector_id   TEXT NOT NULL,
  chat_jid       TEXT NOT NULL,
  sender_jid     TEXT NOT NULL,
  sender_name    TEXT,
  timestamp      TIMESTAMPTZ NOT NULL,
  message_type   TEXT NOT NULL,
  text           TEXT,
  quoted_msg_id  TEXT,
  media_url      TEXT,
  media_mime     TEXT,
  raw_json       JSONB NOT NULL DEFAULT '{}',
  ingested_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (id, connector_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_messages_chat_ts ON wa_messages(connector_id, chat_jid, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_wa_messages_ts ON wa_messages(connector_id, timestamp DESC);

-- Participants per chat
CREATE TABLE IF NOT EXISTS wa_participants (
  chat_jid       TEXT NOT NULL,
  connector_id   TEXT NOT NULL,
  user_jid       TEXT NOT NULL,
  display_name   TEXT,
  is_admin       BOOLEAN DEFAULT FALSE,
  PRIMARY KEY (chat_jid, connector_id, user_jid),
  FOREIGN KEY (chat_jid, connector_id) REFERENCES wa_chats(jid, connector_id) ON DELETE CASCADE
);
