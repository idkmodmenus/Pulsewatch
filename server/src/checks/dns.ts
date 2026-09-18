import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { blockReason } from './ssrf.js';
import { ms, type CheckResult, type MonitorRunner, type RunContext } from './types.js';

export type DnsConfig = {
  domain: string;
  recordType?: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SOA' | 'SRV' | 'CAA';
  expectedValue?: string;
  matchMode?: 'any' | 'all' | 'exact';
  resolver?: string;
  degradedLatencyMs?: number;
};

function flatten(records: unknown): string[] {
  if (!Array.isArray(records)) return [JSON.stringify(records)];
  return records.map((r) => {
    if (typeof r === 'string') return r;
    if (Array.isArray(r)) return r.join('');
    if (r && typeof r === 'object') {
      const o = r as Record<string, unknown>;
      if ('exchange' in o) return `${o.priority} ${o.exchange}`;
      if ('name' in o) return `${o.priority ?? ''} ${o.weight ?? ''} ${o.port ?? ''} ${o.name}`.trim();
      return JSON.stringify(o);
    }
    return String(r);
  });
}

export async function runDnsCheck(cfg: DnsConfig, timeoutMs: number): Promise<CheckResult> {
  const startedAt = process.hrtime.bigint();
  const recordType = cfg.recordType ?? 'A';
  const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
  // A custom resolver must itself be a public address.
  if (cfg.resolver) {
    if (!isIP(cfg.resolver)) return fail('The resolver must be an IP address.', startedAt, cfg, recordType);
    const reason = blockReason(cfg.resolver);
    if (reason) return fail(`Resolver rejected: ${reason}.`, startedAt, cfg, recordType);
    resolver.setServers([cfg.resolver]);
  }

  try {
    const lookupStart = process.hrtime.bigint();
    const records = flatten(await resolver.resolve(cfg.domain, recordType));
    const lookupMs = ms(lookupStart);
    const total = Math.round(ms(startedAt));

    let ok = records.length > 0;
    let error: string | null = records.length ? null : 'no records returned';
    if (ok && cfg.expectedValue) {
      const expected = cfg.expectedValue.trim();
      const mode = cfg.matchMode ?? 'any';
      const normalised = records.map((r) => r.trim().replace(/\.$/, ''));
      const want = expected.replace(/\.$/, '');
      const matches =
        mode === 'all' ? normalised.every((r) => r.includes(want))
        : mode === 'exact' ? normalised.length === 1 && normalised[0] === want
        : normalised.some((r) => r.includes(want));
      if (!matches) {
        ok = false;
        error = `expected ${recordType} to match "${expected}", got [${normalised.join(', ')}]`;
      }
    }

    return {
      ok,
      degraded: ok && !!cfg.degradedLatencyMs && total > cfg.degradedLatencyMs,
      statusCode: null,
      latencyMs: total,
      timings: { dns: lookupMs, total },
      resolvedIp: records.find((r) => isIP(r)) ?? null,
      error,
      meta: {
        recordType,
        records,
        resolver: cfg.resolver ?? resolver.getServers()[0] ?? 'system'
      }
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return fail(`${error.code ?? 'dns_error'}: ${error.message}`, startedAt, cfg, recordType);
  }
}

function fail(message: string, startedAt: bigint, cfg: DnsConfig, recordType: string): CheckResult {
  const total = Math.round(ms(startedAt));
  return {
    ok: false,
    statusCode: null,
    latencyMs: total,
    timings: { dns: total, total },
    resolvedIp: null,
    error: message,
    meta: { recordType, resolver: cfg.resolver ?? 'system' }
  };
}

export const dnsRunner: MonitorRunner = {
  type: 'dns',
  validate(raw) {
    if (!raw.domain || typeof raw.domain !== 'string') throw new Error('A domain is required.');
    if (!/^[a-z0-9._-]+$/i.test(raw.domain)) throw new Error('That domain contains invalid characters.');
  },
  run: (ctx: RunContext) => runDnsCheck(ctx.config as DnsConfig, ctx.timeoutMs)
};
