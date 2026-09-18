import { Redis } from 'ioredis';
import { config } from '../config.js';
import { log } from './logger.js';

function make(name: string, opts: Record<string, unknown> = {}): Redis {
  const client = new Redis(config.REDIS_URL, { lazyConnect: false, ...opts });
  client.on('error', (err) => log.warn(`redis ${name} error`, { err: String(err) }));
  return client;
}

/** General command connection. BullMQ needs maxRetriesPerRequest: null on its own clients. */
export const redis = make('main');
export const redisSub = make('sub');
export const redisPub = make('pub');
export const bullConnection = { url: config.REDIS_URL, maxRetriesPerRequest: null as null };

export async function redisLatencyMs(): Promise<number> {
  const started = process.hrtime.bigint();
  await redis.ping();
  return Number(process.hrtime.bigint() - started) / 1e6;
}

/** Best-effort leader lock used by the scheduler so only one replica schedules. */
export async function acquireLock(key: string, ttlMs: number, holder: string): Promise<boolean> {
  const current = await redis.get(key);
  if (current === holder) {
    await redis.pexpire(key, ttlMs);
    return true;
  }
  const res = await redis.set(key, holder, 'PX', ttlMs, 'NX');
  return res === 'OK';
}
