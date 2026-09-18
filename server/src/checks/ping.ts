/**
 * ICMP ping.
 *
 * Node has no ICMP socket, so this shells out to the system `ping` with execFile and a fixed
 * argument array — never a shell string — and only after the host has been resolved to a literal,
 * validated IP address. Where ICMP is not permitted (common in containers without
 * net.ipv4.ping_group_range or CAP_NET_RAW) it degrades to a TCP reachability probe and says so.
 */
import { execFile } from 'node:child_process';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import { runTcpCheck } from './tcp.js';
import { resolveTarget, TargetBlockedError } from './ssrf.js';
import { ms, type CheckResult, type MonitorRunner, type RunContext } from './types.js';

const exec = promisify(execFile);

export type PingConfig = {
  host: string;
  ipFamily?: 4 | 6;
  packets?: number;
  maxPacketLossPercent?: number;
  fallbackPort?: number;
  degradedLatencyMs?: number;
};

type PingStats = { sent: number; received: number; min: number; avg: number; max: number };

function parsePingOutput(output: string, sent: number): PingStats {
  const received = Number(output.match(/(\d+)\s+(?:packets\s+)?received/i)?.[1] ?? 0);
  const rtt = output.match(/=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/);
  const times = [...output.matchAll(/time[=<]([\d.]+)\s*ms/gi)].map((m) => Number(m[1]));
  const min = rtt ? Number(rtt[1]) : times.length ? Math.min(...times) : 0;
  const avg = rtt ? Number(rtt[2]) : times.length ? times.reduce((a, b) => a + b, 0) / times.length : 0;
  const max = rtt ? Number(rtt[3]) : times.length ? Math.max(...times) : 0;
  return { sent, received: received || times.length, min, avg, max };
}

export async function runPingCheck(cfg: PingConfig, timeoutMs: number): Promise<CheckResult> {
  const startedAt = process.hrtime.bigint();
  const packets = Math.min(Math.max(cfg.packets ?? 4, 1), 10);
  const maxLoss = cfg.maxPacketLossPercent ?? 20;

  try {
    const resolved = await resolveTarget(cfg.host, { family: cfg.ipFamily ?? 0, timeoutMs });
    const target =
      resolved.addresses.find((a) => (cfg.ipFamily ? a.family === cfg.ipFamily : true)) ??
      resolved.addresses[0];
    if (!isIP(target.address)) throw new Error('resolver returned a non-address');
    const dns = resolved.cached ? 0 : Math.round(resolved.dnsMs * 100) / 100;

    const binary = target.family === 6 ? 'ping6' : 'ping';
    const deadline = Math.max(1, Math.ceil(timeoutMs / 1000));
    const args = ['-c', String(packets), '-w', String(deadline), '-n', target.address];

    let stdout = '';
    try {
      stdout = (await exec(binary, args, { timeout: timeoutMs + 2000, maxBuffer: 256 * 1024 })).stdout;
    } catch (err) {
      const e = err as { stdout?: string; code?: number | string; message?: string };
      // Exit code 1 means "no reply" and still carries usable statistics.
      if (typeof e.stdout === 'string' && e.stdout.includes('packets transmitted')) {
        stdout = e.stdout;
      } else if (e.code === 'ENOENT' || /Operation not permitted/i.test(e.message ?? '')) {
        const fallback = await runTcpCheck(
          { host: target.address, port: cfg.fallbackPort ?? 443, degradedLatencyMs: cfg.degradedLatencyMs },
          timeoutMs
        );
        return {
          ...fallback,
          meta: { ...(fallback.meta ?? {}), method: 'tcp-fallback', reason: 'ICMP is not available in this environment' }
        };
      } else {
        throw err;
      }
    }

    const stats = parsePingOutput(stdout, packets);
    const loss = stats.sent === 0 ? 100 : ((stats.sent - stats.received) / stats.sent) * 100;
    const total = Math.round(ms(startedAt));
    const ok = stats.received > 0 && loss <= maxLoss;

    return {
      ok,
      degraded: ok && ((!!cfg.degradedLatencyMs && stats.avg > cfg.degradedLatencyMs) || loss > 0),
      statusCode: null,
      latencyMs: Math.round(stats.avg),
      timings: { dns, total },
      resolvedIp: target.address,
      error: ok ? null : `packet loss ${loss.toFixed(0)}% (${stats.received}/${stats.sent} replies)`,
      meta: {
        method: 'icmp',
        packetsSent: stats.sent,
        packetsReceived: stats.received,
        packetLossPercent: Math.round(loss * 10) / 10,
        minMs: stats.min,
        avgMs: stats.avg,
        maxMs: stats.max
      }
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return {
      ok: false,
      statusCode: null,
      latencyMs: Math.round(ms(startedAt)),
      timings: { total: Math.round(ms(startedAt)) },
      resolvedIp: null,
      error: err instanceof TargetBlockedError ? error.message : `${error.code ?? 'ping_failed'}: ${error.message}`,
      meta: { blocked: err instanceof TargetBlockedError }
    };
  }
}

export const pingRunner: MonitorRunner = {
  type: 'ping',
  validate(raw) {
    if (!raw.host || typeof raw.host !== 'string') throw new Error('A host or IP address is required.');
    if (!isIP(raw.host) && !/^[a-z0-9._-]+$/i.test(raw.host)) throw new Error('That host contains invalid characters.');
  },
  run: (ctx: RunContext) => runPingCheck(ctx.config as PingConfig, ctx.timeoutMs)
};
