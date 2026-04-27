import type { FastifyInstance } from 'fastify';
import { sessionManager } from '../sessions/manager.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  // Start a session (triggers QR code generation)
  app.post<{ Params: { connectorId: string }; Body: { tenantId?: string } }>(
    '/sessions/:connectorId/start',
    async (req, reply) => {
      const { connectorId } = req.params;
      let tenantId = req.headers['x-tenant-id'] as string || req.body?.tenantId || '';
      // If no tenant provided, look up the connector's tenant from connector-service
      if (!tenantId) {
        try {
          const CONNECTOR_URL = process.env.CONNECTOR_SERVICE_URL || 'http://connector-service:8001';
          const r = await fetch(`${CONNECTOR_URL}/connectors/${connectorId}`);
          if (r.ok) {
            const c = await r.json() as any;
            tenantId = c.tenant_id || '';
          }
        } catch {}
      }
      if (!tenantId) tenantId = 'tenant-001';
      const session = await sessionManager.startSession(connectorId, tenantId);
      return { status: session.status, connectorId };
    }
  );

  // Stop a session
  app.delete<{ Params: { connectorId: string } }>(
    '/sessions/:connectorId/stop',
    async (req, reply) => {
      await sessionManager.stopSession(req.params.connectorId);
      return { status: 'disconnected' };
    }
  );

  // Unlink: clear auth and restart. Use this when the user wants a fresh
  // QR (e.g. switching phones, suspecting stale creds). Plain start does
  // not regenerate a QR if the cached creds still work.
  app.post<{ Params: { connectorId: string }; Body: { tenantId?: string } }>(
    '/sessions/:connectorId/unlink',
    async (req, reply) => {
      const { connectorId } = req.params;
      let tenantId = req.headers['x-tenant-id'] as string || req.body?.tenantId || '';
      if (!tenantId) {
        try {
          const CONNECTOR_URL = process.env.CONNECTOR_SERVICE_URL || 'http://connector-service:8001';
          const r = await fetch(`${CONNECTOR_URL}/connectors/${connectorId}`);
          if (r.ok) {
            const c = await r.json() as any;
            tenantId = c.tenant_id || '';
          }
        } catch {}
      }
      if (!tenantId) tenantId = 'tenant-001';
      const session = await sessionManager.unlinkAndRestart(connectorId, tenantId);
      return { status: session.status, connectorId };
    }
  );

  // Get session status
  app.get<{ Params: { connectorId: string } }>(
    '/sessions/:connectorId/status',
    async (req, reply) => {
      return sessionManager.getStatus(req.params.connectorId);
    }
  );

  // QR code via SSE
  app.get<{ Params: { connectorId: string } }>(
    '/sessions/:connectorId/qr',
    async (req, reply) => {
      const { connectorId } = req.params;
      const session = sessionManager.getSession(connectorId);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });

      // Send current QR if available
      if (session?.qrDataUrl) {
        reply.raw.write(`data: ${JSON.stringify({ qr: session.qrDataUrl, status: session.status })}\n\n`);
      }

      const onQr = (qrDataUrl: string) => {
        reply.raw.write(`data: ${JSON.stringify({ qr: qrDataUrl, status: 'qr_pending' })}\n\n`);
      };
      const onConnected = (phone: string) => {
        reply.raw.write(`data: ${JSON.stringify({ status: 'connected', phoneNumber: phone })}\n\n`);
        cleanup();
      };
      const onDisconnected = (reason: string) => {
        reply.raw.write(`data: ${JSON.stringify({ status: 'disconnected', reason })}\n\n`);
      };

      const cleanup = () => {
        session?.off('qr', onQr);
        session?.off('connected', onConnected);
        session?.off('disconnected', onDisconnected);
      };

      if (session) {
        session.on('qr', onQr);
        session.on('connected', onConnected);
        session.on('disconnected', onDisconnected);
      }

      req.raw.on('close', cleanup);
    }
  );
}
