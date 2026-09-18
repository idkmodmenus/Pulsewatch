import { Queue, QueueEvents } from 'bullmq';
import { bullConnection } from '../lib/redis.js';

export const CHECK_QUEUE = 'pulsewatch:checks';

export type CheckJob = { monitorId: string; scheduledFor: string; reason: 'scheduled' | 'manual' };

export const checkQueue = new Queue<CheckJob>(CHECK_QUEUE, {
  connection: bullConnection,
  defaultJobOptions: {
    removeOnComplete: { age: 3600, count: 5000 },
    removeOnFail: { age: 86_400, count: 1000 },
    attempts: 1
  }
});

export const checkQueueEvents = new QueueEvents(CHECK_QUEUE, { connection: bullConnection });

/**
 * Deterministic job id per monitor per due-time, so a scheduler restart (or two schedulers
 * racing for the lock) cannot double-enqueue the same check.
 */
export async function enqueueCheck(monitorId: string, dueAt: Date, reason: CheckJob['reason'] = 'scheduled') {
  const bucket = Math.floor(dueAt.getTime() / 1000);
  return checkQueue.add(
    'check',
    { monitorId, scheduledFor: dueAt.toISOString(), reason },
    { jobId: `${monitorId}:${reason === 'manual' ? `m${Date.now()}` : bucket}` }
  );
}

export async function queueCounts() {
  return checkQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
}
