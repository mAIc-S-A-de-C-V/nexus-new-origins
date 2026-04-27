import { WhatsAppSession } from './session.js';
import { pool } from '../db/pool.js';

class SessionManager {
  private sessions = new Map<string, WhatsAppSession>();

  async restoreAll(): Promise<void> {
    const { rows } = await pool.query(
      `SELECT connector_id, tenant_id FROM wa_sessions WHERE status = 'connected'`
    );
    for (const row of rows) {
      console.log(`[manager] restoring session ${row.connector_id}`);
      await this.startSession(row.connector_id, row.tenant_id);
    }
    console.log(`[manager] restored ${rows.length} sessions`);
  }

  async startSession(connectorId: string, tenantId: string): Promise<WhatsAppSession> {
    // Stop existing session if any
    if (this.sessions.has(connectorId)) {
      await this.sessions.get(connectorId)!.stop();
    }

    // Ensure DB row exists
    await pool.query(
      `INSERT INTO wa_sessions (connector_id, tenant_id, status)
       VALUES ($1, $2, 'disconnected')
       ON CONFLICT (connector_id) DO UPDATE SET tenant_id = $2, updated_at = NOW()`,
      [connectorId, tenantId]
    );

    const session = new WhatsAppSession(connectorId, tenantId);
    this.sessions.set(connectorId, session);
    await session.start();
    return session;
  }

  async stopSession(connectorId: string): Promise<void> {
    const session = this.sessions.get(connectorId);
    if (session) {
      await session.stop();
      this.sessions.delete(connectorId);
    }
  }

  // Unlink the device entirely: stop the socket, wipe the auth blob, and
  // restart so a fresh QR is generated. The "Re-link device" button maps
  // here. Plain stopSession() leaves the auth on disk and lets Baileys
  // reconnect silently next time — that's the right behavior for routine
  // pause/resume but the wrong one when the user wants a new QR.
  async unlinkAndRestart(connectorId: string, tenantId: string): Promise<WhatsAppSession> {
    const existing = this.sessions.get(connectorId);
    if (existing) {
      await existing.unlinkAndClearAuth();
      this.sessions.delete(connectorId);
    } else {
      // No live session — wipe the persisted creds directly via a throwaway
      // session object so the next start() definitely generates a QR.
      const tmp = new WhatsAppSession(connectorId, tenantId);
      await tmp.unlinkAndClearAuth();
    }
    return this.startSession(connectorId, tenantId);
  }

  getSession(connectorId: string): WhatsAppSession | undefined {
    return this.sessions.get(connectorId);
  }

  async getStatus(connectorId: string): Promise<{
    status: string;
    phoneNumber: string | null;
    chatCount: number;
    monitoredCount: number;
    messageCount: number;
  }> {
    const session = this.sessions.get(connectorId);

    const { rows: sessionRows } = await pool.query(
      `SELECT status, phone_number, last_error FROM wa_sessions WHERE connector_id = $1`,
      [connectorId]
    );

    const { rows: chatRows } = await pool.query(
      `SELECT
         count(*) AS total,
         count(*) FILTER (WHERE is_monitored) AS monitored
       FROM wa_chats WHERE connector_id = $1`,
      [connectorId]
    );

    const { rows: msgRows } = await pool.query(
      `SELECT count(*) AS cnt FROM wa_messages WHERE connector_id = $1`,
      [connectorId]
    );

    return {
      status: session?.status || sessionRows[0]?.status || 'disconnected',
      phoneNumber: session?.phoneNumber || sessionRows[0]?.phone_number || null,
      chatCount: parseInt(chatRows[0]?.total || '0'),
      monitoredCount: parseInt(chatRows[0]?.monitored || '0'),
      messageCount: parseInt(msgRows[0]?.cnt || '0'),
    };
  }
}

export const sessionManager = new SessionManager();
