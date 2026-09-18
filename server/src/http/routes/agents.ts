import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { notFound, unauthorized } from '../../lib/errors.js';
import { issueToken, parseTokenPrefix, safeEqualHex, sha256 } from '../../lib/crypto.js';
import { dispatchAlert } from '../../alerts/dispatcher.js';
import { publishEvent } from '../../realtime/events.js';
import { audit, principalOf, requireAuth, requireRole } from '../auth.js';

const telemetry = z.object({
  hostname: z.string().max(255).optional(),
  cpu: z.number().min(0).max(100).nullable().optional(),
  memory: z.number().min(0).max(100).nullable().optional(),
  disk: z.number().min(0).max(100).nullable().optional(),
  load1: z.number().min(0).nullable().optional(),
  load5: z.number().min(0).nullable().optional(),
  load15: z.number().min(0).nullable().optional(),
  uptime: z.number().min(0).nullable().optional(),
  netRxBytes: z.number().min(0).nullable().optional(),
  netTxBytes: z.number().min(0).nullable().optional(),
  ipv4: z.array(z.string().max(45)).max(16).default([]),
  ipv6: z.array(z.string().max(45)).max(16).default([]),
  os: z.record(z.any()).optional(),
  processes: z
    .array(z.object({ name: z.string().max(120), running: z.boolean(), detail: z.string().max(200).optional() }))
    .max(50)
    .optional(),
  timestamp: z.string().datetime().optional()
});

async function agentFromToken(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized('Send the agent token as a bearer token.');
  const token = header.slice(7).trim();
  const prefix = parseTokenPrefix(token);
  if (!prefix) throw unauthorized('That agent token is malformed.');
  const agent = await one<{ id: string; org_id: string; name: string; token_hash: string; thresholds: Record<string, number> }>(
    'SELECT id, org_id, name, token_hash, thresholds FROM server_agents WHERE token_prefix = $1',
    [prefix]
  );
  if (!agent || !safeEqualHex(agent.token_hash, sha256(token))) throw unauthorized('That agent token is not valid.');
  return agent;
}

export default async function agentRoutes(app: FastifyInstance) {
  app.get('/servers', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const agents = await query(
      `SELECT a.id, a.name, a.hostname, a.status, a.last_seen_at, a.os, a.ipv4, a.ipv6, a.thresholds,
              a.heartbeat_timeout_seconds, a.token_prefix, a.created_at,
              m.cpu, m.memory, m.disk, m.load1, m.load5, m.load15, m.uptime_seconds, m.created_at AS metric_at
         FROM server_agents a
         LEFT JOIN LATERAL (
           SELECT * FROM server_metrics WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1
         ) m ON true
        WHERE a.org_id = $1 ORDER BY a.name`,
      [orgId]
    );
    return { agents };
  });

  app.post('/servers', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        heartbeatTimeoutSeconds: z.number().int().min(30).max(3600).default(120),
        thresholds: z.object({ cpu: z.number(), memory: z.number(), disk: z.number() }).partial().default({})
      })
      .parse(req.body);
    const { token, prefix, hash } = issueToken('agent');
    const agent = await one(
      `INSERT INTO server_agents (org_id, name, token_prefix, token_hash, heartbeat_timeout_seconds, thresholds)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6,'{}'::jsonb) || '{"cpu":90,"memory":90,"disk":90}'::jsonb)
       RETURNING id, name, status, heartbeat_timeout_seconds, thresholds, created_at`,
      [orgId, body.name, prefix, hash, body.heartbeatTimeoutSeconds, body.thresholds]
    );
    await audit(req, 'agent.created', agent!.id, { name: body.name });
    return reply.code(201).send({ agent, token });
  });

  app.get('/servers/:id', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const { window = '24h' } = req.query as Record<string, string>;
    const agent = await one('SELECT * FROM server_agents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!agent) throw notFound('That server does not exist.');
    const spans: Record<string, string> = { '1h': '1 hour', '6h': '6 hours', '24h': '24 hours', '7d': '7 days' };
    const series = await query(
      `SELECT to_timestamp(floor(extract(epoch FROM created_at) / 300) * 300) AS bucket,
              avg(cpu)::numeric(5,2) AS cpu, avg(memory)::numeric(5,2) AS memory,
              avg(disk)::numeric(5,2) AS disk, avg(load1)::numeric(8,2) AS load1,
              max(net_rx_bytes) - min(net_rx_bytes) AS rx_delta,
              max(net_tx_bytes) - min(net_tx_bytes) AS tx_delta
         FROM server_metrics
        WHERE agent_id = $1 AND created_at > now() - ($2)::interval
        GROUP BY 1 ORDER BY 1`,
      [id, spans[window] ?? '24 hours']
    );
    const latest = await one('SELECT * FROM server_metrics WHERE agent_id = $1 ORDER BY created_at DESC LIMIT 1', [id]);
    return { agent, series, latest };
  });

  app.delete('/servers/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await query('DELETE FROM server_agents WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.code(204).send();
  });

  // --- agent-facing endpoints (token auth, tighter rate limit) ---

  app.post(
    '/agent/telemetry',
    { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (req) => {
      const agent = await agentFromToken(req);
      const body = telemetry.parse(req.body);

      await query(`SELECT ensure_month_partition('server_metrics', now())`);
      await query(
        `INSERT INTO server_metrics
           (agent_id, org_id, cpu, memory, disk, load1, load5, load15, uptime_seconds, net_rx_bytes, net_tx_bytes, processes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          agent.id, agent.org_id, body.cpu ?? null, body.memory ?? null, body.disk ?? null,
          body.load1 ?? null, body.load5 ?? null, body.load15 ?? null, body.uptime ?? null,
          body.netRxBytes ?? null, body.netTxBytes ?? null, body.processes ?? null
        ]
      );
      await query(
        `UPDATE server_agents
            SET status = 'online', last_seen_at = now(), hostname = COALESCE($2, hostname),
                os = COALESCE($3, os), ipv4 = $4, ipv6 = $5
          WHERE id = $1`,
        [agent.id, body.hostname ?? null, body.os ?? null, body.ipv4, body.ipv6]
      );

      await publishEvent({
        type: 'agent.telemetry',
        orgId: agent.org_id,
        data: { agentId: agent.id, name: agent.name, cpu: body.cpu, memory: body.memory, disk: body.disk }
      });

      const thresholds = agent.thresholds ?? {};
      const breaches: [string, number | null | undefined, number, string][] = [
        ['agent.cpu', body.cpu, thresholds.cpu ?? 90, 'CPU'],
        ['agent.memory', body.memory, thresholds.memory ?? 90, 'Memory'],
        ['agent.disk', body.disk, thresholds.disk ?? 90, 'Disk']
      ];
      for (const [eventType, value, limit, label] of breaches) {
        if (typeof value === 'number' && value >= limit) {
          await dispatchAlert({
            orgId: agent.org_id,
            eventType: eventType as 'agent.cpu',
            subjectId: agent.id,
            agentId: agent.id,
            severity: value >= limit + 5 ? 'critical' : 'warning',
            title: `${label} on ${agent.name} is at ${value.toFixed(1)}%`,
            message: `Above the ${limit}% threshold.`,
            fields: [{ label: 'Host', value: body.hostname ?? agent.name }]
          });
        }
      }

      const down = (body.processes ?? []).filter((p) => !p.running);
      if (down.length) {
        await dispatchAlert({
          orgId: agent.org_id,
          eventType: 'agent.disconnected',
          subjectId: `${agent.id}:processes`,
          agentId: agent.id,
          severity: 'critical',
          title: `Services stopped on ${agent.name}`,
          message: down.map((p) => p.name).join(', '),
          fields: down.slice(0, 5).map((p) => ({ label: p.name, value: p.detail ?? 'not running' }))
        });
      }

      // The agent only ever receives configuration, never commands.
      return { ok: true, nextIntervalSeconds: 30 };
    }
  );

  app.get('/agent/heartbeat', async (req) => {
    const agent = await agentFromToken(req);
    await query(`UPDATE server_agents SET last_seen_at = now(), status = 'online' WHERE id = $1`, [agent.id]);
    return { ok: true, serverTime: new Date().toISOString() };
  });
}
