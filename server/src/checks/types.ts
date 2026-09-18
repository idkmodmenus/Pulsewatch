export type Timings = {
  dns?: number;
  tcp?: number;
  tls?: number;
  ttfb?: number;
  download?: number;
  total: number;
};

export type CheckResult = {
  ok: boolean;
  degraded?: boolean;
  statusCode?: number | null;
  latencyMs: number;
  timings?: Timings;
  resolvedIp?: string | null;
  error?: string | null;
  meta?: Record<string, unknown>;
};

export type RunContext = {
  monitorId: string;
  timeoutMs: number;
  config: Record<string, any>;
};

export interface MonitorRunner {
  /** Monitor type discriminator, e.g. "http". */
  readonly type: string;
  /** Throws with a readable message when the stored config cannot be executed. */
  validate(config: Record<string, any>): void;
  run(ctx: RunContext): Promise<CheckResult>;
}

export const ms = (start: bigint, end: bigint = process.hrtime.bigint()): number =>
  Math.round((Number(end - start) / 1e6) * 100) / 100;
