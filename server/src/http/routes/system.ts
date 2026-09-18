import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { dbLatencyMs, one, query } from '../../db/pool.js';
import { redisLatencyMs } from '../../lib/redis.js';
import { dependencyLatency, registry } from '../../lib/metrics.js';
import { queueCounts } from '../../engine/queue.js';
import { schedulerState } from '../../engine/scheduler.js';
import { audit, principalOf, requireAuth, requireRole } from '../auth.js';

const startedAt = Date.now();

export default async function systemRoutes(app: FastifyInstance) {
  app.get('/health', { config: { rateLimit: false } }, async () => ({
    status: 'ok',
    role: config.ROLE,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000)
  }));

  /** Readiness fails when a dependency is unreachable, so orchestrators stop routing to it. */
  app.get('/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};
    for (const [name, probe] of [['postgres', dbLatencyMs], ['redis', redisLatencyMs]] as const) {
      try {
        const latencyMs = Math.round((await probe()) * 100) / 100;
        dependencyLatency.set({ dependency: name }, latencyMs);
        checks[name] = { ok: true, latencyMs };
      } catch (err) {
        checks[name] = { ok: false, error: String((err as Error).message) };
      }
    }
    const ready = Object.values(checks).every((c) => c.ok);
    return reply.code(ready ? 200 : 503).send({ ready, checks });
  });

  app.get('/metrics', { config: { rateLimit: false } }, async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  app.get('/system/status', { preHandler: requireAuth }, async () => {
    const counts = await queueCounts();
    const [dbMs, redisMs] = await Promise.all([dbLatencyMs(), redisLatencyMs()]);
    const monitors = await query<{ status: string; count: number }>(
      'SELECT status, count(*)::int AS count FROM monitors WHERE enabled GROUP BY status'
    );
    const throughput = await one<{ per_second: number }>(
      `SELECT (count(*)::numeric / 300)::numeric(10,3) AS per_second
         FROM monitor_checks WHERE created_at > now() - interval '5 minutes'`
    );
    return {
      queue: counts,
      dependencies: {
        postgresLatencyMs: Math.round(dbMs * 100) / 100,
        redisLatencyMs: Math.round(redisMs * 100) / 100
      },
      scheduler: { leader: schedulerState.leader, lastTickAt: schedulerState.lastTickAt },
      monitors,
      checksPerSecond: throughput?.per_second ?? 0
    };
  });

  app.get('/settings/organization', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const organization = await one('SELECT id, name, slug, retention_days, created_at FROM organizations WHERE id = $1', [orgId]);
    const members = await query(
      `SELECT u.id, u.email, u.name, m.role, m.created_at FROM memberships m
         JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY m.created_at`,
      [orgId]
    );
    return { organization, members };
  });

  app.patch('/settings/organization', { preHandler: requireRole('owner') }, async (req) => {
    const { orgId } = principalOf(req);
    const body = z
      .object({ name: z.string().min(1).max(120).optional(), retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(365)]).optional() })
      .parse(req.body);
    const organization = await one(
      `UPDATE organizations SET name = COALESCE($2, name), retention_days = COALESCE($3, retention_days)
        WHERE id = $1 RETURNING id, name, slug, retention_days`,
      [orgId, body.name ?? null, body.retentionDays ?? null]
    );
    await audit(req, 'organization.updated', orgId, body);
    return { organization };
  });

  app.get('/audit-logs', { preHandler: requireRole('admin') }, async (req) => {
    const { orgId } = principalOf(req);
    const logs = await query(
      'SELECT id, actor_type, actor_id, action, target, data, host(ip) AS ip, created_at FROM audit_logs WHERE org_id = $1 ORDER BY created_at DESC LIMIT 200',
      [orgId]
    );
    return { logs };
  });
}
