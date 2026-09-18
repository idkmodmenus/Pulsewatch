import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { monitorTypes, validateMonitorConfig } from '../../checks/registry.js';
import { enqueueCheck } from '../../engine/queue.js';
import { audit, principalOf, requireAuth, requireRole } from '../auth.js';

const ALLOWED_INTERVALS = [30, 60, 300, 600, 1800, 3600];

const monitorInput = z.object({
  name: z.string().min(1).max(120),
  type: z.enum(monitorTypes as [string, ...string[]]),
  enabled: z.boolean().default(true),
  intervalSeconds: z.number().int().refine((v) => ALLOWED_INTERVALS.includes(v), {
    message: `Interval must be one of ${ALLOWED_INTERVALS.join(', ')} seconds.`
  }),
  timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
  failureThreshold: z.number().int().min(1).max(10).default(3),
  recoveryThreshold: z.number().int().min(1).max(10).default(2),
  degradedLatencyMs: z.number().int().min(1).max(60_000).nullable().optional(),
  config: z.record(z.any())
});

const SELECT_MONITOR = `
  SELECT id, org_id, name, type, enabled, interval_seconds, timeout_ms, failure_threshold,
         recovery_threshold, degraded_latency_ms, config, status, consecutive_failures,
         consecutive_successes, last_check_at, last_success_at, last_failure_at,
         last_status_change_at, last_latency_ms, last_error, host(last_resolved_ip) AS last_resolved_ip,
         ssl_expires_at, created_at, updated_at
    FROM monitors`;

async function loadMonitor(orgId: string, id: string) {
  const monitor = await one(`${SELECT_MONITOR} WHERE id = $1 AND org_id = $2`, [id, orgId]);
  if (!monitor) throw notFound('That monitor does not exist.');
  return monitor;
}

export default async function monitorRoutes(app: FastifyInstance) {
  app.get('/monitors', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const monitors = await query(`${SELECT_MONITOR} WHERE org_id = $1 ORDER BY name`, [orgId]);
    const sparklines = await query<{ monitor_id: string; points: { t: string; ms: number; ok: boolean }[] }>(
      `SELECT monitor_id,
              json_agg(json_build_object('t', created_at, 'ms', latency_ms, 'ok', ok) ORDER BY created_at) AS points
         FROM (
           SELECT monitor_id, created_at, latency_ms, ok,
                  row_number() OVER (PARTITION BY monitor_id ORDER BY created_at DESC) AS rn
             FROM monitor_checks
            WHERE org_id = $1 AND created_at > now() - interval '6 hours'
         ) recent
        WHERE rn <= 40
        GROUP BY monitor_id`,
      [orgId]
    );
    const byMonitor = new Map(sparklines.map((s) => [s.monitor_id, s.points]));
    return { monitors: monitors.map((m) => ({ ...m, sparkline: byMonitor.get(m.id) ?? [] })) };
  });

  app.post('/monitors', { preHandler: requireRole('member') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const body = monitorInput.parse(req.body);
    try {
      validateMonitorConfig(body.type, body.config);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    const monitor = await one(
      `INSERT INTO monitors
         (org_id, name, type, enabled, interval_seconds, timeout_ms, failure_threshold,
          recovery_threshold, degraded_latency_ms, config, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       RETURNING *`,
      [
        orgId, body.name, body.type, body.enabled, body.intervalSeconds, body.timeoutMs,
        body.failureThreshold, body.recoveryThreshold, body.degradedLatencyMs ?? null, body.config
      ]
    );
    await audit(req, 'monitor.created', monitor!.id, { name: body.name, type: body.type });
    return reply.code(201).send({ monitor });
  });

  app.get('/monitors/:id', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const monitor = await loadMonitor(orgId, id);

    const [uptime] = await query<{ day: number; week: number; month: number }>(
      `SELECT
         COALESCE(avg(CASE WHEN created_at > now() - interval '1 day' THEN (ok)::int END) * 100, 100) AS day,
         COALESCE(avg(CASE WHEN created_at > now() - interval '7 days' THEN (ok)::int END) * 100, 100) AS week,
         COALESCE(avg((ok)::int) * 100, 100) AS month
       FROM monitor_checks WHERE monitor_id = $1 AND created_at > now() - interval '30 days'`,
      [id]
    );
    const [latency] = await query(
      `SELECT count(*)::int AS samples,
              avg(latency_ms)::numeric(10,1) AS avg_ms,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p50_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p95_ms,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p99_ms
         FROM monitor_checks WHERE monitor_id = $1 AND ok AND created_at > now() - interval '24 hours'`,
      [id]
    );
    const addresses = await query(
      `SELECT host(ip) AS ip, family, first_seen, last_seen FROM monitor_ip_history
        WHERE monitor_id = $1 ORDER BY last_seen DESC LIMIT 20`,
      [id]
    );
    const incidents = await query(
      `SELECT id, status, severity, started_at, resolved_at, duration_seconds, cause, detected_after_failures
         FROM incidents WHERE monitor_id = $1 ORDER BY started_at DESC LIMIT 10`,
      [id]
    );
    const checks = await query(
      `SELECT id, created_at, ok, degraded, status_code, latency_ms, timings, host(resolved_ip) AS resolved_ip, error, meta
         FROM monitor_checks WHERE monitor_id = $1 ORDER BY created_at DESC LIMIT 25`,
      [id]
    );
    return { monitor, uptime, latency, addresses, incidents, checks };
  });

  app.patch('/monitors/:id', { preHandler: requireRole('member') }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await loadMonitor(orgId, id);
    const body = monitorInput.partial().parse(req.body);
    if (body.config && body.type) {
      try {
        validateMonitorConfig(body.type, body.config);
      } catch (err) {
        throw badRequest((err as Error).message);
      }
    }
    const columns: Record<string, unknown> = {
      name: body.name,
      enabled: body.enabled,
      interval_seconds: body.intervalSeconds,
      timeout_ms: body.timeoutMs,
      failure_threshold: body.failureThreshold,
      recovery_threshold: body.recoveryThreshold,
      degraded_latency_ms: body.degradedLatencyMs,
      config: body.config
    };
    const entries = Object.entries(columns).filter(([, v]) => v !== undefined);
    if (entries.length === 0) throw badRequest('Nothing to update.');
    const sets = entries.map(([k], i) => `${k} = $${i + 3}`).join(', ');
    const monitor = await one(
      `UPDATE monitors SET ${sets}, updated_at = now(),
              status = CASE WHEN $${entries.length + 3}::boolean IS FALSE THEN 'paused'
                            WHEN status = 'paused' THEN 'pending' ELSE status END
        WHERE id = $1 AND org_id = $2 RETURNING *`,
      [id, orgId, ...entries.map(([, v]) => v), body.enabled ?? null]
    );
    await audit(req, 'monitor.updated', id, body as Record<string, unknown>);
    return { monitor };
  });

  app.delete('/monitors/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await loadMonitor(orgId, id);
    await query('DELETE FROM monitors WHERE id = $1 AND org_id = $2', [id, orgId]);
    await audit(req, 'monitor.deleted', id);
    return reply.code(204).send();
  });

  app.post('/monitors/:id/run', { preHandler: requireRole('member') }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await loadMonitor(orgId, id);
    await enqueueCheck(id, new Date(), 'manual');
    return { queued: true };
  });

  app.get('/monitors/:id/checks', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const { limit = '100', before, onlyFailures } = req.query as Record<string, string>;
    await loadMonitor(orgId, id);
    const checks = await query(
      `SELECT id, created_at, ok, degraded, status_code, latency_ms, timings,
              host(resolved_ip) AS resolved_ip, error, meta
         FROM monitor_checks
        WHERE monitor_id = $1
          AND ($2::timestamptz IS NULL OR created_at < $2)
          AND ($3::boolean IS NOT TRUE OR NOT ok)
        ORDER BY created_at DESC
        LIMIT $4`,
      [id, before ?? null, onlyFailures === 'true', Math.min(Number(limit) || 100, 500)]
    );
    return { checks };
  });

  app.get('/monitors/:id/latency', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const { window = '24h' } = req.query as Record<string, string>;
    await loadMonitor(orgId, id);
    const spans: Record<string, { interval: string; bucket: string }> = {
      '1h': { interval: '1 hour', bucket: '1 minute' },
      '6h': { interval: '6 hours', bucket: '5 minutes' },
      '24h': { interval: '24 hours', bucket: '15 minutes' },
      '7d': { interval: '7 days', bucket: '1 hour' },
      '30d': { interval: '30 days', bucket: '6 hours' }
    };
    const span = spans[window] ?? spans['24h'];
    const series = await query(
      `SELECT to_timestamp(floor(extract(epoch FROM created_at) / extract(epoch FROM $2::interval))
                           * extract(epoch FROM $2::interval)) AS bucket,
              count(*)::int AS checks,
              count(*) FILTER (WHERE NOT ok)::int AS failures,
              avg(latency_ms)::numeric(10,1) AS avg_ms,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p50_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p95_ms,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,1) AS p99_ms,
              avg((timings->>'dns')::numeric)::numeric(10,1) AS dns_ms,
              avg((timings->>'tcp')::numeric)::numeric(10,1) AS tcp_ms,
              avg((timings->>'tls')::numeric)::numeric(10,1) AS tls_ms,
              avg((timings->>'ttfb')::numeric)::numeric(10,1) AS ttfb_ms,
              avg((timings->>'download')::numeric)::numeric(10,1) AS download_ms
         FROM monitor_checks
        WHERE monitor_id = $1 AND created_at > now() - $3::interval
        GROUP BY 1 ORDER BY 1`,
      [id, span.bucket, span.interval]
    );
    return { window, series };
  });

  app.get('/monitors/:id/incidents', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await loadMonitor(orgId, id);
    const incidents = await query(
      `SELECT i.*, (SELECT json_agg(json_build_object('at', e.at, 'kind', e.kind, 'message', e.message, 'data', e.data)
                                    ORDER BY e.at)
                      FROM incident_events e WHERE e.incident_id = i.id) AS events
         FROM incidents i WHERE i.monitor_id = $1 ORDER BY i.started_at DESC LIMIT 50`,
      [id]
    );
    return { incidents };
  });
}
