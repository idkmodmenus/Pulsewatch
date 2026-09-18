import type { FastifyInstance } from 'fastify';
import { subscribeEvents } from '../../realtime/events.js';
import { principalOf, requireAuth } from '../auth.js';

/**
 * Server-sent events. SSE rather than WebSockets: the dashboard only consumes, and SSE
 * survives proxies, reconnects on its own and rides the existing session cookie.
 */
export default async function streamRoutes(app: FastifyInstance) {
  app.get('/stream', { preHandler: requireAuth, config: { rateLimit: false } }, async (req, reply) => {
    const { orgId } = principalOf(req);

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    reply.raw.write(`event: ready\ndata: ${JSON.stringify({ orgId })}\n\n`);

    const unsubscribe = await subscribeEvents((event) => {
      if (event.orgId !== orgId) return;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    const heartbeat = setInterval(() => reply.raw.write(': keep-alive\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });
}
