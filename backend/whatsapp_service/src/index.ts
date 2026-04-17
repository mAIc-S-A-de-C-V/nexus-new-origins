import Fastify from 'fastify';
import cors from '@fastify/cors';
import { pool, runMigrations } from './db/pool.js';
import { sessionManager } from './sessions/manager.js';
import { sessionRoutes } from './routes/sessions.js';
import { chatRoutes } from './routes/chats.js';
import { messageRoutes } from './routes/messages.js';

const PORT = parseInt(process.env.PORT || '8025');
const HOST = process.env.HOST || '0.0.0.0';

const app = Fastify({ logger: true });

await app.register(cors, { origin: true, credentials: true });

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'whatsapp-service' }));

// Register routes under /api/v1
app.register(async (api) => {
  await api.register(sessionRoutes);
  await api.register(chatRoutes);
  await api.register(messageRoutes);
}, { prefix: '/api/v1' });

// Startup
try {
  await runMigrations();
  await sessionManager.restoreAll();
  await app.listen({ port: PORT, host: HOST });
  console.log(`[whatsapp-service] listening on ${HOST}:${PORT}`);
} catch (err) {
  console.error('[whatsapp-service] startup error:', err);
  process.exit(1);
}

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`[whatsapp-service] ${sig} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
