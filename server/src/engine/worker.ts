import { Worker } from 'bullmq';
import { config } from '../config.js';
import { getRunner } from '../checks/registry.js';
import { one } from '../db/pool.js';
import { log } from '../lib/logger.js';
import { bullConnection } from '../lib/redis.js';
import { checkDuration, checksTotal, workerFailures } from '../lib/metrics.js';
import { isOpen, recordOutcome } from './circuitBreaker.js';
import { CHECK_QUEUE, type CheckJob } from './queue.js';
import { applyCheckResult, type MonitorRow } from './results.js';
import type { CheckResult } from '../checks/types.js';

const breakerConfig = { threshold: config.BREAKER_FAILURES, resetMs: config.BREAKER_RESET_MS };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Transient network faults get a retry with exponential backoff; assertion failures do not. */
function worthRetrying(result: CheckResult): boolean {
  if (result.ok) return false;
  if (result.meta?.blocked) return false;
  if (result.statusCode) return false; // the server answered; that is a real result
  return true;
}

export async function runCheckForMonitor(monitorId: string): Promise<CheckResult | null> {
  const monitor = await one<MonitorRow>(
    `SELECT id, org_id, name, type, status, consecutive_failures, consecutive_successes,
            failure_threshold, recovery_threshold, interval_seconds, timeout_ms,
            degraded_latency_ms, config, host(last_resolved_ip) AS last_resolved_ip, last_latency_ms
       FROM monitors WHERE id = $1`,
    [monitorId]
  );
  if (!monitor) return null;
  if (monitor.status === 'paused') return null;

  const suppressed = await one(
    `SELECT 1 FROM maintenance_windows
      WHERE org_id = $1 AND suppress_checks AND now() BETWEEN starts_at AND ends_at
        AND (monitor_ids IS NULL OR $2::uuid = ANY(monitor_ids)) LIMIT 1`,
    [monitor.org_id, monitor.id]
  );
  if (suppressed) {
    log.debug('check skipped for maintenance', { monitorId });
    return null;
  }

  const runner = getRunner(monitor.type);
  const breakerKey = `${monitor.type}:${monitor.id}`;
  const stopTimer = checkDuration.startTimer({ type: monitor.type });

  let result: CheckResult;
  if (isOpen(breakerKey, breakerConfig)) {
    result = {
      ok: false,
      statusCode: null,
      latencyMs: 0,
      timings: { total: 0 },
      error: 'circuit open: the target has failed repeatedly, backing off before the next attempt',
      meta: { circuitOpen: true }
    };
  } else {
    const ctx = {
      monitorId: monitor.id,
      timeoutMs: monitor.timeout_ms,
      config: { degradedLatencyMs: monitor.degraded_latency_ms ?? undefined, ...monitor.config }
    };
    result = await runner.run(ctx);
    for (let attempt = 1; attempt < config.CHECK_ATTEMPTS && worthRetrying(result); attempt++) {
      await sleep(config.CHECK_BACKOFF_MS * 2 ** (attempt - 1));
      const retry = await runner.run(ctx);
      result = { ...retry, meta: { ...(retry.meta ?? {}), retries: attempt } };
    }
    recordOutcome(breakerKey, result.ok, breakerConfig);
  }

  stopTimer();
  checksTotal.inc({ type: monitor.type, outcome: result.ok ? (result.degraded ? 'degraded' : 'ok') : 'fail' });
  await applyCheckResult(monitor, result);
  return result;
}

export function startCheckWorker(): Worker<CheckJob> {
  const worker = new Worker<CheckJob>(
    CHECK_QUEUE,
    async (job) => {
      try {
        await runCheckForMonitor(job.data.monitorId);
      } catch (err) {
        workerFailures.inc({ type: 'unknown' });
        log.error('check job failed', { monitorId: job.data.monitorId, err: String(err) });
        throw err;
      }
    },
    {
      connection: bullConnection,
      concurrency: config.WORKER_CONCURRENCY,
      lockDuration: 90_000
    }
  );

  worker.on('failed', (job, err) => log.warn('job failed', { id: job?.id, err: String(err) }));
  log.info('check worker started', { concurrency: config.WORKER_CONCURRENCY });
  return worker;
}
