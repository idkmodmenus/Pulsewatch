import type { FastifyInstance } from 'fastify';
import { query, one } from '../../db/pool.js';
import { principalOf, requireAuth } from '../auth.js';

export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/dashboard', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);

    const summary = await one<Record<string, number>>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'up')::int AS up,
              count(*) FILTER (WHERE status = 'down')::int AS down,
              count(*) FILTER (WHERE status = 'degraded')::int AS degraded,
              count(*) FILTER (WHERE status = 'paused' OR NOT enabled)::int AS paused,
              count(*) FILTER (WHERE status = 'pending')::int AS pending
         FROM monitors WHERE org_id = $1`,
      [orgId]
    );

    const latency = await one(
      `SELECT count(*)::int AS samples,
              avg(latency_ms)::numeric(10,1) AS avg_ms,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p50_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p95_ms,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p99_ms
         FROM monitor_checks
        WHERE org_id = $1 AND ok AND created_at > now() - interval '24 hours'`,
      [orgId]
    );

    const uptime = await one<{ uptime: number; checks: number; failures: number }>(
      `SELECT COALESCE(avg((ok)::int) * 100, 100)::numeric(7,3) AS uptime,
              count(*)::int AS checks,
              count(*) FILTER (WHERE NOT ok)::int AS failures
         FROM monitor_checks WHERE org_id = $1 AND created_at > now() - interval '30 days'`,
      [orgId]
    );

    const series = await query(
      `SELECT to_timestamp(floor(extract(epoch FROM created_at) / 900) * 900) AS bucket,
              avg(latency_ms)::numeric(10,1) AS avg_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p95_ms,
              count(*) FILTER (WHERE NOT ok)::int AS failures
         FROM monitor_checks
        WHERE org_id = $1 AND created_at > now() - interval '24 hours'
        GROUP BY 1 ORDER BY 1`,
      [orgId]
    );

    const incidents = await query(
      `SELECT i.id, i.status, i.severity, i.started_at, i.resolved_at, i.duration_seconds, i.cause,
              i.detected_after_failures, m.id AS monitor_id, m.name AS monitor_name, m.type AS monitor_type
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        WHERE i.org_id = $1 ORDER BY i.started_at DESC LIMIT 8`,
      [orgId]
    );

    const lastChecks = await one(
      `SELECT max(created_at) FILTER (WHERE ok) AS last_success,
              max(created_at) FILTER (WHERE NOT ok) AS last_failure,
              max(created_at) AS last_check
         FROM monitor_checks WHERE org_id = $1`,
      [orgId]
    );

    const agents = await query(
      `SELECT a.id, a.name, a.hostname, a.status, a.last_seen_at,
              m.cpu, m.memory, m.disk, m.load1, m.uptime_seconds
         FROM server_agents a
         LEFT JOIN LATERAL (
           SELECT cpu, memory, disk, load1, uptime_seconds FROM server_metrics
            WHERE agent_id = a.id ORDER BY created_at DESC LIMIT 1
         ) m ON true
        WHERE a.org_id = $1 ORDER BY a.name`,
      [orgId]
    );

    const slowest = await query(
      `SELECT m.id, m.name, m.type, m.status, m.last_latency_ms,
              avg(c.latency_ms)::numeric(10,1) AS avg_ms
         FROM monitors m
         JOIN monitor_checks c ON c.monitor_id = m.id AND c.created_at > now() - interval '1 hour' AND c.ok
        WHERE m.org_id = $1
        GROUP BY m.id ORDER BY avg_ms DESC NULLS LAST LIMIT 5`,
      [orgId]
    );

    return { summary, latency, uptime, series, incidents, lastChecks, agents, slowest };
  });
}
