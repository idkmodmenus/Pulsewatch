import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config, isProd } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { apiRequests } from '../lib/metrics.js';
import { redis } from '../lib/redis.js';
import authRoutes from './routes/auth.js';
import monitorRoutes from './routes/monitors.js';
import dashboardRoutes from './routes/dashboard.js';
import incidentRoutes from './routes/incidents.js';
import notificationRoutes from './routes/notifications.js';
import apiKeyRoutes from './routes/apiKeys.js';
import statusPageRoutes from './routes/statusPages.js';
import agentRoutes from './routes/agents.js';
import systemRoutes from './routes/system.js';
import streamRoutes from './routes/stream.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    trustProxy: true,
    bodyLimit: 256 * 1024,
    disableRequestLogging: true
  });

  await app.register(cors, {
    origin: isProd ? [config.PUBLIC_URL] : true,
    credentials: true
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    redis,
    keyGenerator: (req) => `${req.ip}:${(req as any).principal?.orgId ?? 'anon'}`
  });

  app.addHook('onResponse', async (req, reply) => {
    apiRequests.inc({
      method: req.method,
      route: (req.routeOptions?.url ?? 'unknown') as string,
      status: `${Math.floor(reply.statusCode / 100)}xx`
    });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'Some fields need attention.',
        details: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }))
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if ((err as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: 'Too many requests. Slow down and try again.' });
    }
    log.error('unhandled request error', { url: req.url, err: String(err), stack: (err as Error).stack });
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong on our side.' });
  });

  app.setNotFoundHandler((_req, reply) =>
    reply.code(404).send({ error: 'not_found', message: 'No such endpoint.' })
  );

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(monitorRoutes);
      await api.register(dashboardRoutes);
      await api.register(incidentRoutes);
      await api.register(notificationRoutes);
      await api.register(apiKeyRoutes);
      await api.register(statusPageRoutes);
      await api.register(agentRoutes);
      await api.register(streamRoutes);
      await api.register(systemRoutes);
    },
    { prefix: '/api' }
  );

  // Kubernetes-style probes are also served unprefixed.
  await app.register(systemRoutes);

  return app;
}
