import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';

export async function messageRoutes(app: FastifyInstance): Promise<void> {
  // List messages — primary endpoint for pipeline SOURCE
  app.get<{
    Params: { connectorId: string };
    Querystring: { chat_jid?: string; since?: string; limit?: string; offset?: string };
  }>(
    '/sessions/:connectorId/messages',
    async (req) => {
      const { connectorId } = req.params;
      const { chat_jid, since, limit: limitStr, offset: offsetStr } = req.query;
      const limit = Math.min(parseInt(limitStr || '500'), 5000);
      const offset = parseInt(offsetStr || '0');

      let sql = `
        SELECT
          m.id,
          m.chat_jid,
          c.name AS chat_name,
          m.sender_jid,
          m.sender_name,
          m.timestamp,
          m.message_type,
          m.text,
          m.quoted_msg_id,
          m.media_url,
          m.media_mime
        FROM wa_messages m
        LEFT JOIN wa_chats c ON c.jid = m.chat_jid AND c.connector_id = m.connector_id
        WHERE m.connector_id = $1
      `;
      const params: any[] = [connectorId];
      let paramIdx = 2;

      if (chat_jid) {
        sql += ` AND m.chat_jid = $${paramIdx}`;
        params.push(chat_jid);
        paramIdx++;
      }

      if (since) {
        sql += ` AND m.timestamp > $${paramIdx}`;
        params.push(since);
        paramIdx++;
      }

      sql += ` ORDER BY m.timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`;
      params.push(limit, offset);

      const { rows } = await pool.query(sql, params);

      // Get total count for pagination
      let countSql = `SELECT count(*) AS cnt FROM wa_messages WHERE connector_id = $1`;
      const countParams: any[] = [connectorId];
      let cIdx = 2;
      if (chat_jid) {
        countSql += ` AND chat_jid = $${cIdx}`;
        countParams.push(chat_jid);
        cIdx++;
      }
      if (since) {
        countSql += ` AND timestamp > $${cIdx}`;
        countParams.push(since);
      }
      const { rows: countRows } = await pool.query(countSql, countParams);

      return {
        rows: rows.map(r => ({
          id: r.id,
          chat_jid: r.chat_jid,
          chat_name: r.chat_name,
          sender_jid: r.sender_jid,
          sender_name: r.sender_name,
          timestamp: r.timestamp,
          message_type: r.message_type,
          text: r.text,
          quoted_msg_id: r.quoted_msg_id,
          media_url: r.media_url,
          media_mime: r.media_mime,
        })),
        row_count: parseInt(countRows[0]?.cnt || '0'),
        limit,
        offset,
      };
    }
  );

  // Schema endpoint — returns WhatsApp message field definitions
  app.get<{ Params: { connectorId: string } }>(
    '/sessions/:connectorId/schema',
    async (req) => {
      const { connectorId } = req.params;

      // Get sample rows
      const { rows: sampleRows } = await pool.query(
        `SELECT id, chat_jid, sender_jid, sender_name, timestamp, message_type, text, media_mime
         FROM wa_messages WHERE connector_id = $1
         ORDER BY timestamp DESC LIMIT 5`,
        [connectorId]
      );

      return {
        schema: {
          source: 'whatsapp',
          object_type: 'message',
          fields: {
            id: { type: 'string', label: 'Message ID' },
            chat_jid: { type: 'string', label: 'Chat ID' },
            chat_name: { type: 'string', label: 'Chat Name' },
            sender_jid: { type: 'string', label: 'Sender ID' },
            sender_name: { type: 'string', label: 'Sender Name' },
            timestamp: { type: 'datetime', label: 'Timestamp' },
            message_type: { type: 'string', label: 'Type (text, image, video, audio, document, location)' },
            text: { type: 'string', label: 'Message Text / Caption' },
            quoted_msg_id: { type: 'string', label: 'Replied-to Message ID' },
            media_url: { type: 'string', label: 'Media URL' },
            media_mime: { type: 'string', label: 'Media MIME Type' },
          },
          total_properties: 11,
        },
        sample_rows: sampleRows,
      };
    }
  );
}
