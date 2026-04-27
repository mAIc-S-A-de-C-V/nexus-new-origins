import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  type WASocket,
  type BaileysEventMap,
  type AuthenticationCreds,
  type SignalKeyStore,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import { EventEmitter } from 'events';
import QRCode from 'qrcode';
import { pool } from '../db/pool.js';
import { extractContent, type ExtractedMessage } from '../extract.js';

const INFERENCE_URL = process.env.INFERENCE_SERVICE_URL || 'http://inference-service:8003';

/**
 * Serialize keys to JSON with Buffers encoded as base64 strings.
 * This avoids the JSONB round-trip corruption where {type:'Buffer',data:[...]}
 * objects lose their prototype and break libsignal's deserialization.
 */
const B64_PREFIX = '::b64::';

function serializeKeys(keys: Record<string, any>): string {
  return JSON.stringify(keys, (_key, value) => {
    // Buffer.isBuffer works if the value hasn't been through toJSON() yet
    if (Buffer.isBuffer(value)) {
      return B64_PREFIX + value.toString('base64');
    }
    if (value instanceof Uint8Array) {
      return B64_PREFIX + Buffer.from(value).toString('base64');
    }
    // Buffer.toJSON() fires BEFORE the replacer sees the value, converting
    // Buffers to {type:'Buffer', data:[...]} plain objects. Catch that here.
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return B64_PREFIX + Buffer.from(value.data).toString('base64');
    }
    return value;
  });
}

function deserializeKeys(raw: any): Record<string, any> {
  if (!raw) return {};
  // If it's already parsed by PostgreSQL (JSONB), stringify it first
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  return JSON.parse(str, (_key, value) => {
    if (typeof value === 'string' && value.startsWith(B64_PREFIX)) {
      return Buffer.from(value.slice(B64_PREFIX.length), 'base64');
    }
    // Legacy: handle old-style {type:'Buffer',data:[...]} from JSONB
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) {
      return Buffer.from(value.data);
    }
    return value;
  });
}

export type SessionStatus = 'disconnected' | 'qr_pending' | 'connected' | 'error';

export class WhatsAppSession extends EventEmitter {
  connectorId: string;
  tenantId: string;
  status: SessionStatus = 'disconnected';
  qrDataUrl: string | null = null;
  phoneNumber: string | null = null;
  private sock: WASocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;

  constructor(connectorId: string, tenantId: string) {
    super();
    this.connectorId = connectorId;
    this.tenantId = tenantId;
  }

  async start(): Promise<void> {
    const { version } = await fetchLatestBaileysVersion();
    const authState = await this.loadAuthState();

    this.sock = makeWASocket({
      version,
      auth: authState,
      browser: Browsers.macOS('Desktop'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      fireInitQueries: true,
      printQRInTerminal: false,
      generateHighQualityLinkPreview: false,
    });

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.status = 'qr_pending';
        this.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        await this.updateDbStatus('qr_pending');
        this.emit('qr', this.qrDataUrl);
      }

      if (connection === 'open') {
        this.status = 'connected';
        this.backoff = 1000;
        const me = this.sock?.user;
        this.phoneNumber = me?.id?.split(':')[0] || me?.id || null;
        await this.updateDbStatus('connected');
        this.emit('connected', this.phoneNumber);
        // Discover groups after connection
        await this.discoverChats();
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          this.status = 'disconnected';
          await this.clearAuth();
          await this.updateDbStatus('disconnected', 'Logged out — please re-scan QR');
          this.emit('disconnected', 'logged_out');
          return;
        }
        // Reconnect with backoff
        this.status = 'disconnected';
        await this.updateDbStatus('disconnected', `Connection closed (code ${code})`);
        this.reconnectTimer = setTimeout(() => this.start(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30000);
      }
    });

    this.sock.ev.on('creds.update', async () => {
      await this.saveCreds();
    });

    this.sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        await this.handleMessage(m);
      }
    });

    this.sock.ev.on('groups.upsert', async (groups) => {
      for (const g of groups) {
        await this.upsertChat(g.id, 'group', g.subject || g.id, g.desc || null, g.participants?.length || 0);
      }
    });

    this.sock.ev.on('groups.update', async (updates) => {
      for (const u of updates) {
        if (u.id && u.subject) {
          await pool.query(
            `UPDATE wa_chats SET name = $1, updated_at = NOW() WHERE jid = $2 AND connector_id = $3`,
            [u.subject, u.id, this.connectorId]
          );
        }
      }
    });

    // Discover individual chats from initial sync
    this.sock.ev.on('chats.upsert', async (chats) => {
      let individualCount = 0;
      for (const chat of chats) {
        const jid = chat.id;
        if (!jid || jid.endsWith('@g.us') || jid.endsWith('@broadcast')) continue;
        const name = (chat as any).name || (chat as any).notify || jid.split('@')[0];
        await this.upsertChat(jid, 'individual', name, null, 2);
        individualCount++;
      }
      if (individualCount > 0) {
        console.log(`[session:${this.connectorId}] discovered ${individualCount} individual chats`);
      }
    });
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.sock) {
      this.sock.end(undefined);
      this.sock = null;
    }
    this.status = 'disconnected';
    await this.updateDbStatus('disconnected');
  }

  // ── Chat Discovery ──────────────────────────────────────────────

  private async discoverChats(): Promise<void> {
    if (!this.sock) return;
    try {
      const groups = await this.sock.groupFetchAllParticipating();
      for (const [jid, meta] of Object.entries(groups)) {
        await this.upsertChat(jid, 'group', meta.subject || jid, meta.desc || null, meta.participants?.length || 0);
        // Upsert participants
        for (const p of meta.participants || []) {
          await pool.query(
            `INSERT INTO wa_participants (chat_jid, connector_id, user_jid, display_name, is_admin)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (chat_jid, connector_id, user_jid) DO UPDATE
             SET display_name = EXCLUDED.display_name, is_admin = EXCLUDED.is_admin`,
            [jid, this.connectorId, p.id, p.id, p.admin === 'admin' || p.admin === 'superadmin']
          );
        }
      }
      console.log(`[session:${this.connectorId}] discovered ${Object.keys(groups).length} groups`);
    } catch (e) {
      console.error(`[session:${this.connectorId}] group discovery error:`, e);
    }
  }

  private async upsertChat(jid: string, chatType: string, name: string, description: string | null, participantCount: number): Promise<void> {
    await pool.query(
      `INSERT INTO wa_chats (jid, connector_id, chat_type, name, description, participant_count)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (jid, connector_id) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description,
           participant_count = EXCLUDED.participant_count, updated_at = NOW()`,
      [jid, this.connectorId, chatType, name, description, participantCount]
    );
  }

  // ── Message Handling ────────────────────────────────────────────

  private async handleMessage(m: any): Promise<void> {
    const jid = m.key?.remoteJid;
    const id = m.key?.id;
    if (!jid || !id) return;

    const extracted = extractContent(m);
    const text = extracted.text?.trim() || '';

    // Handle /asistente command — works from any sender in any chat
    if (text.toLowerCase().startsWith('/asistente')) {
      const query = text.slice('/asistente'.length).trim();
      if (query) {
        await this.handleAssistantCommand(jid, query);
      }
      if (m.key?.fromMe) return;
      // Don't store /asistente commands as regular messages — fall through only if not fromMe
      // (non-fromMe /asistente still gets stored as a regular message below for audit)
    }

    if (m.key?.fromMe) return;

    const chatType = jid.endsWith('@g.us') ? 'group' : 'individual';

    // Check if this chat is monitored
    const { rows } = await pool.query(
      `SELECT is_monitored FROM wa_chats WHERE jid = $1 AND connector_id = $2`,
      [jid, this.connectorId]
    );
    if (rows.length === 0) {
      // Auto-discover individual chats
      const name = m.pushName || m.key?.participant || jid.split('@')[0];
      await this.upsertChat(jid, chatType, name, null, chatType === 'group' ? 0 : 2);
    }
    const isMonitored = rows.length > 0 ? rows[0].is_monitored : false;
    if (!isMonitored) return;

    const senderJid = m.key?.participant || jid;
    const senderName = m.pushName || null;
    const timestamp = m.messageTimestamp
      ? new Date(Number(m.messageTimestamp) * 1000)
      : new Date();

    await pool.query(
      `INSERT INTO wa_messages (id, connector_id, chat_jid, sender_jid, sender_name, timestamp, message_type, text, quoted_msg_id, media_mime, raw_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id, connector_id) DO NOTHING`,
      [
        id, this.connectorId, jid, senderJid, senderName,
        timestamp, extracted.type, extracted.text, extracted.quotedMsgId,
        extracted.mediaMime, JSON.stringify(m),
      ]
    );
  }

  // ── WhatsApp Assistant ("/asistente") ──────────────────────────

  private async handleAssistantCommand(chatJid: string, query: string): Promise<void> {
    if (!this.sock) return;
    console.log(`[assistant] query from ${chatJid} (tenant=${this.tenantId}): ${query.slice(0, 100)}`);

    // Show "typing" indicator while the agent loop runs
    try { await this.sock.sendPresenceUpdate('composing', chatJid); } catch {}

    try {
      const AGENT_URL = process.env.AGENT_SERVICE_URL || 'http://agent-service:8013';

      const res = await fetch(`${AGENT_URL}/agents/run-inline`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tenant-id': this.tenantId,
        },
        body: JSON.stringify({
          message: query,
          model: 'claude-haiku-4-5-20251001',
          enabled_tools: [
            'list_object_types', 'get_object_schema', 'query_records',
            'count_records', 'logic_function_run', 'utility_list',
            'utility_run', 'list_connectors', 'list_pipelines',
            'create_pipeline', 'run_pipeline',
          ],
          max_iterations: 12,
          dry_run: false,
        }),
        signal: AbortSignal.timeout(120_000), // 2 min timeout for multi-tool loops
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Agent service ${res.status}: ${errText}`);
      }

      const result = await res.json() as { final_text?: string; iterations?: number; error?: string };
      let answer = result.final_text || '';

      if (result.error) {
        console.warn(`[assistant] agent warning: ${result.error}`);
      }

      if (!answer) answer = 'No pude procesar tu consulta. Intenta de nuevo.';

      // Truncate for WhatsApp message limit
      if (answer.length > 3800) {
        answer = answer.slice(0, 3800) + '\n\n_(respuesta truncada)_';
      }

      // Strip markdown formatting for WhatsApp (keep bold with *)
      const waText = answer
        .replace(/#{1,3}\s/g, '*')        // headers → bold
        .replace(/\*\*(.*?)\*\*/g, '*$1*') // **bold** → *bold*
        .replace(/`([^`]+)`/g, '$1');      // remove backticks

      await this.sock.sendMessage(chatJid, { text: `🤖 *Nexus Asistente*\n\n${waText}` });
      console.log(`[assistant] replied to ${chatJid} (${answer.length} chars, ${result.iterations || 0} iterations)`);
    } catch (e) {
      console.error(`[assistant] error:`, e);
      try {
        await this.sock!.sendMessage(chatJid, {
          text: '🤖 Error al procesar tu consulta. Verifica que el servicio de agentes esté activo.',
        });
      } catch { /* ignore send error */ }
    }
  }

  // ── Auth State (PostgreSQL-backed) ──────────────────────────────

  private async loadAuthState(): Promise<AuthenticationState> {
    const { rows } = await pool.query(
      `SELECT auth_creds, auth_keys FROM wa_sessions WHERE connector_id = $1`,
      [this.connectorId]
    );

    let creds: AuthenticationCreds | undefined;
    let keys: Record<string, any> = {};

    if (rows.length > 0 && rows[0].auth_creds) {
      creds = deserializeKeys(rows[0].auth_creds) as AuthenticationCreds;
      keys = deserializeKeys(rows[0].auth_keys);
    }

    if (!creds) {
      // Import initAuthCreds dynamically
      const { initAuthCreds } = await import('@whiskeysockets/baileys');
      creds = initAuthCreds();
    }

    const keyStore: SignalKeyStore = {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, any> = {};
        for (const id of ids) {
          const key = `${type}-${id}`;
          if (keys[key]) {
            try {
              result[id] = keys[key];
            } catch (e) {
              console.warn(`[session:${this.connectorId}] corrupted key ${key}, skipping`);
              delete keys[key]; // purge corrupted key
            }
          }
        }
        return result;
      },
      set: async (data: Record<string, Record<string, any>>) => {
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries)) {
            const key = `${type}-${id}`;
            if (value) {
              keys[key] = value;
            } else {
              delete keys[key];
            }
          }
        }
        await this.saveKeys(keys);
      },
    };

    return {
      creds,
      keys: makeCacheableSignalKeyStore(keyStore, undefined as any),
    };
  }

  private async saveCreds(): Promise<void> {
    if (!this.sock) return;
    const creds = (this.sock as any).authState?.creds;
    if (!creds) return;
    await pool.query(
      `UPDATE wa_sessions SET auth_creds = $1, updated_at = NOW() WHERE connector_id = $2`,
      [serializeKeys(creds as any), this.connectorId]
    );
  }

  private async saveKeys(keys: Record<string, any>): Promise<void> {
    await pool.query(
      `UPDATE wa_sessions SET auth_keys = $1, updated_at = NOW() WHERE connector_id = $2`,
      [serializeKeys(keys), this.connectorId]
    );
  }

  private async clearAuth(): Promise<void> {
    await pool.query(
      `UPDATE wa_sessions SET auth_creds = NULL, auth_keys = NULL, updated_at = NOW() WHERE connector_id = $1`,
      [this.connectorId]
    );
  }

  // Public wrapper for the "Re-link device" flow: stops the socket, blows
  // away the cached auth, and clears the in-memory QR. Caller is expected
  // to follow up with a fresh start() to generate a new QR.
  async unlinkAndClearAuth(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* socket may already be dead */ }
      this.sock = null;
    }
    await this.clearAuth();
    this.qrDataUrl = null;
    this.phoneNumber = null;
    this.status = 'disconnected';
    await this.updateDbStatus('disconnected', 'Unlinked — re-scan QR to reconnect');
  }

  private async updateDbStatus(status: string, error?: string): Promise<void> {
    await pool.query(
      `UPDATE wa_sessions SET status = $1, last_error = $2, updated_at = NOW()
       ${status === 'connected' ? ', last_connected = NOW(), phone_number = $3' : ''}
       WHERE connector_id = ${status === 'connected' ? '$4' : '$3'}`,
      status === 'connected'
        ? [status, null, this.phoneNumber, this.connectorId]
        : [status, error || null, this.connectorId]
    );
  }
}
