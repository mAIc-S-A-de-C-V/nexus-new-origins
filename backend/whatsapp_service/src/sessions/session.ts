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
 * Recursively convert serialised `{type:'Buffer',data:[…]}` objects back to
 * real Buffer instances.  PostgreSQL jsonb round-trips lose the Buffer
 * prototype, which makes Baileys' crypto helpers crash.
 */
function bufferify(obj: any): any {
  if (obj == null) return obj;
  // Handle serialized Buffer: {type:'Buffer', data:[…]}
  if (typeof obj === 'object' && obj.type === 'Buffer' && Array.isArray(obj.data)) {
    return Buffer.from(obj.data);
  }
  // Handle Uint8Array-like objects: {0: n, 1: n, ...} with numeric keys
  if (typeof obj === 'object' && !Array.isArray(obj)) {
    const entries = Object.entries(obj);
    if (entries.length > 0 && entries.every(([k]) => /^\d+$/.test(k))) {
      // Looks like a serialized typed array — convert to Buffer
      try {
        const arr = new Uint8Array(entries.length);
        for (const [k, v] of entries) arr[parseInt(k)] = v as number;
        return Buffer.from(arr);
      } catch { /* fall through to recursive handling */ }
    }
  }
  if (Array.isArray(obj)) return obj.map(bufferify);
  if (typeof obj === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = bufferify(v);
    }
    return out;
  }
  return obj;
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
    console.log(`[assistant] query from ${chatJid}: ${query.slice(0, 100)}`);

    try {
      const h = { 'x-tenant-id': this.tenantId };
      const ONTOLOGY_URL = process.env.ONTOLOGY_SERVICE_URL || 'http://ontology-service:8004';
      const CONNECTOR_URL = process.env.CONNECTOR_SERVICE_URL || 'http://connector-service:8001';
      const PIPELINE_URL = process.env.PIPELINE_SERVICE_URL || 'http://pipeline-service:8002';
      const LOGIC_URL = process.env.LOGIC_SERVICE_URL || 'http://logic-service:8012';

      // Fetch live context from all services in parallel
      const [otsRes, connsRes, pipsRes, fnsRes] = await Promise.allSettled([
        fetch(`${ONTOLOGY_URL}/object-types`, { headers: h }).then(r => r.json()),
        fetch(`${CONNECTOR_URL}/connectors`, { headers: h }).then(r => r.json()),
        fetch(`${PIPELINE_URL}/pipelines`, { headers: h }).then(r => r.json()),
        fetch(`${LOGIC_URL}/logic/functions`, { headers: h }).then(r => r.json()),
      ]);

      const objectTypes = otsRes.status === 'fulfilled' ? otsRes.value : [];
      const connectors = connsRes.status === 'fulfilled' ? connsRes.value : [];
      const pipelines = pipsRes.status === 'fulfilled' ? pipsRes.value : [];
      const functions = fnsRes.status === 'fulfilled' ? fnsRes.value : [];

      // Fetch recent records for each object type (up to first 8)
      const otsWithRecords = await Promise.all(
        (objectTypes as any[]).slice(0, 8).map(async (ot: any) => {
          try {
            const r = await fetch(`${ONTOLOGY_URL}/object-types/${ot.id}/records?limit=25`, { headers: h });
            const d = await r.json();
            return { ...ot, recent_records: (d.records || []).slice(0, 25), total_records: d.total || 0 };
          } catch { return ot; }
        })
      );

      const context = {
        current_page: 'WhatsApp Assistant',
        object_types: otsWithRecords,
        connectors: (connectors as any[]).map((c: any) => ({
          id: c.id, name: c.name, type: c.type, status: c.status,
          base_url: c.base_url, last_sync: c.last_sync,
        })),
        pipelines,
        functions,
      };

      const res = await fetch(`${INFERENCE_URL}/infer/stream-help`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': this.tenantId },
        body: JSON.stringify({
          messages: [{ role: 'user', content: query }],
          context,
        }),
      });

      // Read SSE stream and accumulate full response
      const body = await res.text();
      let answer = '';
      for (const line of body.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.text) answer += parsed.text;
          } catch { /* skip malformed lines */ }
        }
      }

      if (!answer) answer = 'No pude procesar tu consulta. Intenta de nuevo.';

      // Strip markdown formatting for WhatsApp (keep bold with *)
      const waText = answer
        .replace(/#{1,3}\s/g, '*')        // headers → bold
        .replace(/\*\*(.*?)\*\*/g, '*$1*') // **bold** → *bold*
        .replace(/`([^`]+)`/g, '$1');      // remove backticks

      await this.sock.sendMessage(chatJid, { text: `🤖 *Nexus Asistente*\n\n${waText}` });
      console.log(`[assistant] replied to ${chatJid} (${answer.length} chars)`);
    } catch (e) {
      console.error(`[assistant] error:`, e);
      try {
        await this.sock!.sendMessage(chatJid, {
          text: '🤖 Error al procesar tu consulta. Verifica que el servicio de inferencia esté activo.',
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
      creds = bufferify(rows[0].auth_creds) as AuthenticationCreds;
      keys = bufferify(rows[0].auth_keys) || {};
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
          if (keys[key]) result[id] = bufferify(keys[key]);
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
      [JSON.stringify(creds), this.connectorId]
    );
  }

  private async saveKeys(keys: Record<string, any>): Promise<void> {
    await pool.query(
      `UPDATE wa_sessions SET auth_keys = $1, updated_at = NOW() WHERE connector_id = $2`,
      [JSON.stringify(keys), this.connectorId]
    );
  }

  private async clearAuth(): Promise<void> {
    await pool.query(
      `UPDATE wa_sessions SET auth_creds = NULL, auth_keys = NULL, updated_at = NOW() WHERE connector_id = $1`,
      [this.connectorId]
    );
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
