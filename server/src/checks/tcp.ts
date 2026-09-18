import net from 'node:net';
import { resolveTarget, TargetBlockedError } from './ssrf.js';
import { ms, type CheckResult, type MonitorRunner, type RunContext } from './types.js';

export type TcpConfig = {
  host: string;
  port: number;
  ipFamily?: 0 | 4 | 6;
  sendPayload?: string;
  expectPayload?: string;
  degradedLatencyMs?: number;
};

export async function runTcpCheck(cfg: TcpConfig, timeoutMs: number): Promise<CheckResult> {
  const startedAt = process.hrtime.bigint();
  try {
    const resolved = await resolveTarget(cfg.host, { family: cfg.ipFamily ?? 0, timeoutMs });
    const target =
      resolved.addresses.find((a) => (cfg.ipFamily ? a.family === cfg.ipFamily : true)) ??
      resolved.addresses[0];
    const dns = resolved.cached ? 0 : Math.round(resolved.dnsMs * 100) / 100;

    const outcome = await new Promise<{ connectMs: number; banner: string }>((resolve, reject) => {
      const connectStart = process.hrtime.bigint();
      const socket = net.connect({ host: target.address, port: cfg.port, family: target.family });
      let banner = '';
      let connectMs = 0;
      const done = (err?: Error) => {
        socket.removeAllListeners();
        socket.destroy();
        err ? reject(err) : resolve({ connectMs, banner });
      };
      socket.setTimeout(timeoutMs, () => done(new Error(`TCP connect timed out after ${timeoutMs} ms`)));
      socket.once('error', (err) => done(err));
      socket.once('connect', () => {
        connectMs = ms(connectStart);
        if (!cfg.sendPayload && !cfg.expectPayload) return done();
        if (cfg.sendPayload) socket.write(cfg.sendPayload);
        if (!cfg.expectPayload) return done();
        socket.on('data', (chunk) => {
          banner += chunk.toString('utf8');
          if (banner.includes(cfg.expectPayload!) || banner.length > 4096) done();
        });
      });
    });

    const total = Math.round(ms(startedAt));
    const bannerOk = !cfg.expectPayload || outcome.banner.includes(cfg.expectPayload);
    return {
      ok: bannerOk,
      degraded: bannerOk && !!cfg.degradedLatencyMs && total > cfg.degradedLatencyMs,
      statusCode: null,
      latencyMs: total,
      timings: { dns, tcp: outcome.connectMs, total },
      resolvedIp: target.address,
      error: bannerOk ? null : `expected "${cfg.expectPayload}" in the banner`,
      meta: { port: cfg.port, banner: outcome.banner.slice(0, 200) || null }
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    return {
      ok: false,
      statusCode: null,
      latencyMs: Math.round(ms(startedAt)),
      timings: { total: Math.round(ms(startedAt)) },
      resolvedIp: null,
      error: err instanceof TargetBlockedError ? error.message : `${error.code ?? 'connect_failed'}: ${error.message}`,
      meta: { port: cfg.port, blocked: err instanceof TargetBlockedError }
    };
  }
}

export const tcpRunner: MonitorRunner = {
  type: 'tcp',
  validate(raw) {
    if (!raw.host) throw new Error('A host or IP address is required.');
    const port = Number(raw.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535.');
  },
  run: (ctx: RunContext) => runTcpCheck(ctx.config as TcpConfig, ctx.timeoutMs)
};
