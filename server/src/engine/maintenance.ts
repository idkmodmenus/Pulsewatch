/** Housekeeping the scheduler runs: partitions, rollups, retention, dead-agent detection. */
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { log } from '../lib/logger.js';
import { dispatchAlert } from '../alerts/dispatcher.js';
import { publishEvent } from '../realtime/events.js';

export async function ensurePartitions(): Promise<void> {
  for (const table of ['monitor_checks', 'server_metrics']) {
    await query(`SELECT ensure_month_partition($1, now())`, [table]);
    await query(`SELECT ensure_month_partition($1, now() + interval '1 month')`, [table]);
  }
}

/**
 * Aggregate raw checks into hourly and daily buckets. Re-runs are idempotent: the last two
 * buckets are always recomputed so a partially-filled hour settles correctly.
 */
export async function rollupChecks(): Promise<number> {
  let written = 0;
  for (const period of ['hour', 'day'] as const) {
    const rows = await query<{ count: number }>(
      `WITH source AS (
         SELECT monitor_id,
                date_trunc($1, created_at) AS bucket,
                count(*)::int AS checks,
                count(*) FILTER (WHERE NOT ok)::int AS failures,
                avg(latency_ms)::numeric(10,2) AS avg_ms,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,2) AS p50_ms,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,2) AS p95_ms,
                percentile_cont(0.99) WITHIN GROUP (ORDER BY latency_ms)::numeric(10,2) AS p99_ms,
                min(latency_ms) AS min_ms,
                max(latency_ms) AS max_ms
           FROM monitor_checks
          WHERE created_at >= date_trunc($1, now()) - ($2)::interval
          GROUP BY 1, 2
       ), upserted AS (
         INSERT INTO monitor_check_rollups
           (monitor_id, period, bucket, checks, failures, avg_ms, p50_ms, p95_ms, p99_ms, min_ms, max_ms)
         SELECT monitor_id, $1, bucket, checks, failures, avg_ms, p50_ms, p95_ms, p99_ms, min_ms, max_ms
           FROM source
         ON CONFLICT (monitor_id, period, bucket) DO UPDATE SET
           checks = EXCLUDED.checks, failures = EXCLUDED.failures, avg_ms = EXCLUDED.avg_ms,
           p50_ms = EXCLUDED.p50_ms, p95_ms = EXCLUDED.p95_ms, p99_ms = EXCLUDED.p99_ms,
           min_ms = EXCLUDED.min_ms, max_ms = EXCLUDED.max_ms
         RETURNING 1
       )
       SELECT count(*)::int AS count FROM upserted`,
      [period, period === 'hour' ? '2 hours' : '2 days']
    );
    written += rows[0]?.count ?? 0;
  }
  return written;
}

/**
 * Retention. Raw rows expire per organisation policy; whole partitions are dropped once every
 * organisation's window has passed them, which is far cheaper than a bulk DELETE. Aggregated
 * uptime survives for ROLLUP_RETAIN_DAYS.
 */
export async function applyRetention(): Promise<void> {
  await query(
    `DELETE FROM monitor_checks c
      USING monitors m, organizations o
      WHERE c.monitor_id = m.id AND m.org_id = o.id
        AND c.created_at < now() - make_interval(days => o.retention_days)`
  );
  await query(
    `DELETE FROM server_metrics s
      USING server_agents a, organizations o
      WHERE s.agent_id = a.id AND a.org_id = o.id
        AND s.created_at < now() - make_interval(days => o.retention_days)`
  );
  await query(
    `DELETE FROM monitor_check_rollups WHERE bucket < now() - make_interval(days => $1)`,
    [config.ROLLUP_RETAIN_DAYS]
  );
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
  await query(`DELETE FROM user_tokens WHERE expires_at < now()`);
  await query(`DELETE FROM alert_deliveries WHERE created_at < now() - interval '90 days'`);

  const maxRetention = (
    await query<{ days: number }>(`SELECT COALESCE(max(retention_days), 30)::int AS days FROM organizations`)
  )[0]?.days ?? 30;
  const cutoff = new Date(Date.now() - (maxRetention + 45) * 86_400_000);
  const stale = await query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
       JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname IN ('monitor_checks','server_metrics')`
  );
  for (const { relname } of stale) {
    const stamp = relname.match(/_(\d{6})$/)?.[1];
    if (!stamp) continue;
    const partitionEnd = new Date(Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4)), 1));
    if (partitionEnd < cutoff) {
      log.info('dropping expired partition', { partition: relname });
      await query(`DROP TABLE IF EXISTS ${quoteIdent(relname)}`);
    }
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`refusing to drop suspicious relation ${name}`);
  return `"${name}"`;
}

/** Agents that stopped reporting flip to offline and alert once. */
export async function detectDeadAgents(): Promise<void> {
  const dead = await query<{ id: string; org_id: string; name: string; last_seen_at: string | null }>(
    `UPDATE server_agents SET status = 'offline'
      WHERE status = 'online'
        AND (last_seen_at IS NULL OR last_seen_at < now() - make_interval(secs => heartbeat_timeout_seconds))
      RETURNING id, org_id, name, last_seen_at`
  );
  for (const agent of dead) {
    await publishEvent({ type: 'agent.offline', orgId: agent.org_id, data: { agentId: agent.id, name: agent.name } });
    await dispatchAlert({
      orgId: agent.org_id,
      eventType: 'agent.disconnected',
      subjectId: agent.id,
      agentId: agent.id,
      severity: 'critical',
      title: `Agent ${agent.name} stopped reporting`,
      message: `No telemetry since ${agent.last_seen_at ?? 'the agent was created'}.`,
      fields: []
    });
  }
}
