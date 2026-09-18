import { z } from 'zod';

// z.coerce.boolean() uses JS `Boolean(value)`, so the *string* "false" coerces to true —
// a real footgun for env vars. This treats "false"/"0"/"" as false, everything else by
// normal truthiness.
const boolFromEnv = (fallback: boolean) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    if (['false', '0', ''].includes(value.trim().toLowerCase())) return false;
    return true;
  }, z.boolean()).default(fallback);

const schema = z.object({
  ROLE: z.enum(['api', 'worker', 'scheduler', 'all']).default('all'),
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: z.string().default('http://localhost:8080'),

  DATABASE_URL: z.string(),
  DATABASE_POOL_MAX: z.coerce.number().default(10),
  REDIS_URL: z.string(),

  SESSION_TTL_HOURS: z.coerce.number().default(24 * 14),
  COOKIE_SECURE: boolFromEnv(false),

  WORKER_CONCURRENCY: z.coerce.number().default(20),
  SCHEDULER_TICK_MS: z.coerce.number().default(5000),
  CHECK_ATTEMPTS: z.coerce.number().default(2),
  CHECK_BACKOFF_MS: z.coerce.number().default(750),
  MAX_REDIRECTS: z.coerce.number().default(5),
  MAX_RESPONSE_BYTES: z.coerce.number().default(512 * 1024),
  DNS_CACHE_TTL_MS: z.coerce.number().default(30_000),
  KEEPALIVE_MS: z.coerce.number().default(30_000),
  MAX_SOCKETS_PER_HOST: z.coerce.number().default(4),

  // Circuit breaker for the monitoring workers themselves (not the targets).
  BREAKER_FAILURES: z.coerce.number().default(10),
  BREAKER_RESET_MS: z.coerce.number().default(60_000),

  ALLOW_PRIVATE_TARGETS: boolFromEnv(false),
  ALLOWED_PRIVATE_CIDRS: z.string().default(''),
  ROLLUP_RETAIN_DAYS: z.coerce.number().default(730),

  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('pulsewatch@localhost'),

  SEED_EMAIL: z.string().default('demo@pulsewatch.local'),
  SEED_PASSWORD: z.string().default('pulsewatch'),
  LOG_LEVEL: z.string().default('info')
});

export type Config = z.infer<typeof schema>;

export const config: Config = schema.parse(process.env);
export const isProd = config.NODE_ENV === 'production';
