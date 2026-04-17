import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  // List all chats for a connector
  app.get<{ Params: { connectorId: string }; Querystring: { type?: string } }>(
    '/sessions/:connectorId/chats',
    async (req) => {
      const { connectorId } = req.params;
      const chatType = req.query.type; // 'group' | 'individual' | undefined

      let sql = `
        SELECT c.*,
          (SELECT count(*) FROM wa_messages m WHERE m.chat_jid = c.jid AND m.connector_id = c.connector_id) AS message_count,
          (SELECT max(m.timestamp) FROM wa_messages m WHERE m.chat_jid = c.jid AND m.connector_id = c.connector_id) AS last_activity
        FROM wa_chats c
        WHERE c.connector_id = $1
      `;
      const params: any[] = [connectorId];

      if (chatType) {
        sql += ` AND c.chat_type = $2`;
        params.push(chatType);
      }

      sql += ` ORDER BY c.is_monitored DESC, c.name ASC`;

      const { rows } = await pool.query(sql, params);
      return {
        chats: rows.map(r => ({
          jid: r.jid,
          chatType: r.chat_type,
          name: r.name,
          description: r.description,
          isMonitored: r.is_monitored,
          participantCount: r.participant_count,
          messageCount: parseInt(r.message_count || '0'),
          lastActivity: r.last_activity,
          firstSeenAt: r.first_seen_at,
        })),
      };
    }
  );

  // Toggle monitoring for a chat
  app.patch<{ Params: { connectorId: string; jid: string }; Body: { monitored: boolean } }>(
    '/sessions/:connectorId/chats/:jid/monitor',
    async (req) => {
      const { connectorId, jid } = req.params;
      const { monitored } = req.body;
      const decodedJid = decodeURIComponent(jid);

      await pool.query(
        `UPDATE wa_chats SET is_monitored = $1, updated_at = NOW()
         WHERE jid = $2 AND connector_id = $3`,
        [monitored, decodedJid, connectorId]
      );

      return { jid: decodedJid, monitored };
    }
  );

  // Monitor all / none
  app.post<{ Params: { connectorId: string }; Body: { monitored: boolean } }>(
    '/sessions/:connectorId/chats/monitor-all',
    async (req) => {
      const { connectorId } = req.params;
      const { monitored } = req.body;

      const result = await pool.query(
        `UPDATE wa_chats SET is_monitored = $1, updated_at = NOW()
         WHERE connector_id = $2`,
        [monitored, connectorId]
      );

      return { updated: result.rowCount, monitored };
    }
  );

  // Get participants for a chat
  app.get<{ Params: { connectorId: string; jid: string } }>(
    '/sessions/:connectorId/chats/:jid/participants',
    async (req) => {
      const { connectorId, jid } = req.params;
      const decodedJid = decodeURIComponent(jid);

      const { rows } = await pool.query(
        `SELECT user_jid, display_name, is_admin
         FROM wa_participants
         WHERE chat_jid = $1 AND connector_id = $2
         ORDER BY is_admin DESC, display_name ASC`,
        [decodedJid, connectorId]
      );

      return { participants: rows };
    }
  );
}
