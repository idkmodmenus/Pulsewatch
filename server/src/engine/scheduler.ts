import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { log } from '../lib/logger.js';
import { acquireLock } from '../lib/redis.js';
import { activeMonitors, queueDepth, schedulerTicks } from '../lib/metrics.js';
import { enqueueCheck, queueCounts } from './queue.js';
import { applyRetention, detectDeadAgents, ensurePartitions, rollupChecks } from './maintenance.js';

const LOCK_KEY = 'pulsewatch:scheduler:leader';
const holder = randomUUID();
let lastHousekeeping = 0;
let lastHeartbeat = 0;
export const schedulerState = { leader: false, lastTickAt: 0 };

/** Claim due monitors and push them onto the queue. Returns how many were enqueued. */
export async function tick(now = new Date()): Promise<number> {
  const due = await query<{ id: string; interval_seconds: number }>(
    `UPDATE monitors SET next_run_at = now() + make_interval(secs => interval_seconds)
      WHERE id IN (
        SELECT id FROM monitors
         WHERE enabled AND status <> 'paused' AND next_run_at <= now()
         ORDER BY next_run_at
         LIMIT 500
         FOR UPDATE SKIP LOCKED
      )
      RETURNING id, interval_seconds`
  );
  for (const monitor of due) await enqueueCheck(monitor.id, now);
  return due.length;
}

async function housekeeping(): Promise<void> {
  await ensurePartitions();
  await detectDeadAgents();
  await rollupChecks();
  await applyRetention();
  log.info('housekeeping completed');
}

async function refreshGauges(): Promise<void> {
  const counts = await queueCounts();
  for (const [state, value] of Object.entries(counts)) queueDepth.set({ state }, Number(value));
  const rows = await query<{ status: string; count: number }>(
    `SELECT status, count(*)::int AS count FROM monitors WHERE enabled GROUP BY status`
  );
  activeMonitors.reset();
  for (const row of rows) activeMonitors.set({ status: row.status }, row.count);
}

export function startScheduler(): () => void {
  let stopped = false;
  log.info('scheduler starting', { holder, tickMs: config.SCHEDULER_TICK_MS });

  const loop = async () => {
    while (!stopped) {
      try {
        const leader = await acquireLock(LOCK_KEY, config.SCHEDULER_TICK_MS * 4, holder);
        schedulerState.leader = leader;
        schedulerState.lastTickAt = Date.now();
        if (leader) {
          const enqueued = await tick();
          schedulerTicks.inc({ outcome: 'leader' });
          if (enqueued > 0) log.debug('checks enqueued', { enqueued });
          if (Date.now() - lastHeartbeat > 15_000) {
            lastHeartbeat = Date.now();
            await refreshGauges();
          }
          if (Date.now() - lastHousekeeping > 5 * 60_000) {
            lastHousekeeping = Date.now();
            await housekeeping();
          }
        } else {
          schedulerTicks.inc({ outcome: 'standby' });
        }
      } catch (err) {
        schedulerTicks.inc({ outcome: 'error' });
        log.error('scheduler tick failed', { err: String(err) });
      }
      await new Promise((r) => setTimeout(r, config.SCHEDULER_TICK_MS));
    }
  };

  void loop();
  return () => {
    stopped = true;
  };
}
