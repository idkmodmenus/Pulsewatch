/**
 * HTTP/HTTPS + API checks.
 *
 * Uses node:http / node:https directly so socket events give a true phase breakdown:
 *   DNS -> TCP connect -> TLS handshake -> request sent -> first byte -> body download.
 * The hostname is resolved and validated up front and the socket is pinned to that address,
 * with Host/SNI kept as the original name, so the connection can only reach a vetted IP.
 */
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { TLSSocket, PeerCertificate } from 'node:tls';
import { config } from '../config.js';
import { evaluateAssertion, statusMatches, type JsonAssertion } from './assertions.js';
import { parseHttpUrl, resolveTarget, TargetBlockedError } from './ssrf.js';
import { ms, type CheckResult, type MonitorRunner, type RunContext, type Timings } from './types.js';

export type HttpConfig = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  expectedStatus?: (number | string)[];
  keyword?: string;
  keywordMode?: 'contains' | 'absent';
  followRedirects?: boolean;
  maxRedirects?: number;
  verifySsl?: boolean;
  ipFamily?: 0 | 4 | 6;
  assertions?: JsonAssertion[];
  connectTimeoutMs?: number;
  readTimeoutMs?: number;
  degradedLatencyMs?: number;
};

const agents = new Map<string, http.Agent | https.Agent>();

/** One pooled, keep-alive agent per origin: connection reuse without unbounded sockets. */
function agentFor(origin: string, secure: boolean): http.Agent | https.Agent {
  const existing = agents.get(origin);
  if (existing) return existing;
  const options = {
    keepAlive: true,
    keepAliveMsecs: config.KEEPALIVE_MS,
    maxSockets: config.MAX_SOCKETS_PER_HOST,
    maxFreeSockets: 2,
    scheduling: 'lifo' as const
  };
  const agent = secure ? new https.Agent(options) : new http.Agent(options);
  agents.set(origin, agent);
  return agent;
}

export function destroyAgents(): void {
  for (const agent of agents.values()) agent.destroy();
  agents.clear();
}

type Hop = {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  truncated: boolean;
  timings: Timings;
  address: string;
  certificate: { validTo: string | null; issuer: string | null; subject: string | null } | null;
};

async function singleRequest(
  url: URL,
  cfg: HttpConfig,
  totalTimeoutMs: number
): Promise<Hop> {
  const secure = url.protocol === 'https:';
  const family = cfg.ipFamily ?? 0;
  const resolved = await resolveTarget(url.hostname, { family, timeoutMs: totalTimeoutMs });
  const preferred =
    resolved.addresses.find((a) => (family === 0 ? true : a.family === family)) ?? resolved.addresses[0];

  // Pin the connection to the address we just validated.
  const lookup: LookupFunction = (_hostname, _options, callback) => {
    (callback as (e: null, a: string, f: number) => void)(null, preferred.address, preferred.family);
  };

  const started = process.hrtime.bigint();
  const marks: { connect?: bigint; secure?: bigint; response?: bigint; end?: bigint } = {};
  const payload =
    cfg.body === undefined || cfg.body === null
      ? null
      : Buffer.from(typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body));

  const headers: http.OutgoingHttpHeaders = {
    'user-agent': 'Pulsewatch/1.0 (+uptime monitor)',
    accept: '*/*',
    'accept-encoding': 'identity',
    ...Object.fromEntries(
      Object.entries(cfg.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])
    )
  };
  if (payload) {
    headers['content-length'] = payload.length;
    if (!headers['content-type']) headers['content-type'] = 'application/json';
  }

  return new Promise<Hop>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(overallTimer);
      fn();
    };

    const request = (secure ? https : http).request(
      {
        protocol: url.protocol,
        host: url.hostname,
        servername: secure ? url.hostname : undefined,
        port: url.port || (secure ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: (cfg.method ?? 'GET').toUpperCase(),
        headers,
        lookup,
        agent: agentFor(`${url.protocol}//${url.host}`, secure),
        rejectUnauthorized: cfg.verifySsl !== false,
        timeout: cfg.connectTimeoutMs ?? totalTimeoutMs
      },
      (res) => {
        marks.response = process.hrtime.bigint();
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;

        res.on('data', (chunk: Buffer) => {
          if (truncated) return;
          size += chunk.length;
          if (size > config.MAX_RESPONSE_BYTES) {
            truncated = true;
            chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - config.MAX_RESPONSE_BYTES))));
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });

        const complete = () => {
          marks.end = marks.end ?? process.hrtime.bigint();
          const socket = res.socket as TLSSocket | undefined;
          let certificate: Hop['certificate'] = null;
          if (secure && socket && typeof socket.getPeerCertificate === 'function') {
            const cert = socket.getPeerCertificate() as PeerCertificate;
            if (cert && cert.valid_to) {
              certificate = {
                validTo: cert.valid_to,
                issuer: (cert.issuer?.O ?? cert.issuer?.CN ?? null) as string | null,
                subject: (cert.subject?.CN ?? null) as string | null
              };
            }
          }
          const dns = resolved.cached ? 0 : Math.round(resolved.dnsMs * 100) / 100;
          const connectAt = marks.connect ? ms(started, marks.connect) : 0;
          const secureAt = marks.secure ? ms(started, marks.secure) : connectAt;
          const responseAt = ms(started, marks.response!);
          const total = ms(started, marks.end);
          const timings: Timings = {
            dns,
            tcp: Math.max(0, Math.round((connectAt - dns) * 100) / 100),
            tls: secure ? Math.max(0, Math.round((secureAt - connectAt) * 100) / 100) : 0,
            ttfb: Math.max(0, Math.round((responseAt - secureAt) * 100) / 100),
            download: Math.max(0, Math.round((total - responseAt) * 100) / 100),
            total
          };
          finish(() =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks),
              truncated,
              timings,
              address: preferred.address,
              certificate
            })
          );
        };

        res.on('end', complete);
        res.on('close', complete);
        res.on('error', (err) => finish(() => reject(err)));
        res.setTimeout(cfg.readTimeoutMs ?? totalTimeoutMs, () => {
          res.destroy(new Error('Read timeout while downloading the response body'));
        });
      }
    );

    const overallTimer = setTimeout(() => {
      request.destroy(new Error(`Request exceeded the ${totalTimeoutMs} ms timeout`));
    }, totalTimeoutMs);

    request.on('socket', (socket) => {
      if (!socket.connecting) {
        marks.connect = marks.connect ?? process.hrtime.bigint(); // reused keep-alive socket
        marks.secure = marks.secure ?? marks.connect;
        return;
      }
      socket.once('connect', () => {
        marks.connect = process.hrtime.bigint();
      });
      socket.once('secureConnect', () => {
        marks.secure = process.hrtime.bigint();
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('Connection timeout'));
    });
    request.on('error', (err) => finish(() => reject(err)));

    if (payload) request.write(payload);
    request.end();
  });
}

function sumTimings(hops: Timings[]): Timings {
  return hops.reduce<Timings>(
    (acc, t) => ({
      dns: round((acc.dns ?? 0) + (t.dns ?? 0)),
      tcp: round((acc.tcp ?? 0) + (t.tcp ?? 0)),
      tls: round((acc.tls ?? 0) + (t.tls ?? 0)),
      ttfb: round((acc.ttfb ?? 0) + (t.ttfb ?? 0)),
      download: round((acc.download ?? 0) + (t.download ?? 0)),
      total: round(acc.total + t.total)
    }),
    { dns: 0, tcp: 0, tls: 0, ttfb: 0, download: 0, total: 0 }
  );
}
const round = (n: number) => Math.round(n * 100) / 100;

export async function runHttpCheck(cfg: HttpConfig, timeoutMs: number): Promise<CheckResult> {
  const startedAt = process.hrtime.bigint();
  let url = parseHttpUrl(cfg.url);
  const maxRedirects = cfg.followRedirects === false ? 0 : Math.min(cfg.maxRedirects ?? config.MAX_REDIRECTS, config.MAX_REDIRECTS);
  const hops: Timings[] = [];
  const redirectChain: string[] = [];
  let hop: Hop;
  let method = (cfg.method ?? 'GET').toUpperCase();
  let body = cfg.body;

  try {
    for (let redirect = 0; ; redirect++) {
      const budget = Math.max(1000, timeoutMs - Math.round(ms(startedAt)));
      hop = await singleRequest(url, { ...cfg, method, body }, budget);
      hops.push(hop.timings);

      const location = hop.headers.location;
      const isRedirect = hop.status >= 300 && hop.status < 400 && typeof location === 'string';
      if (!isRedirect || redirect >= maxRedirects) break;

      // Re-validate every hop: a redirect is user-influenced input too.
      const next = parseHttpUrl(new URL(location, url).toString());
      redirectChain.push(next.toString());
      if (hop.status === 303 || ((hop.status === 301 || hop.status === 302) && method === 'POST')) {
        method = 'GET';
        body = undefined;
      }
      url = next;
    }

    const timings = sumTimings(hops);
    const text = hop!.body.toString('utf8');
    const expected = cfg.expectedStatus?.length ? cfg.expectedStatus : ['2xx', '3xx'];
    const failures: string[] = [];

    if (!statusMatches(hop!.status, expected)) {
      failures.push(`status ${hop!.status} is not in [${expected.join(', ')}]`);
    }
    if (cfg.keyword) {
      const present = text.includes(cfg.keyword);
      if (cfg.keywordMode === 'absent' && present) failures.push(`keyword "${cfg.keyword}" was present`);
      if (cfg.keywordMode !== 'absent' && !present) failures.push(`keyword "${cfg.keyword}" was not found`);
    }
    if (cfg.assertions?.length) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        failures.push('response body is not valid JSON');
      }
      if (parsed !== undefined) {
        for (const assertion of cfg.assertions) {
          const problem = evaluateAssertion(parsed, assertion);
          if (problem) failures.push(problem);
        }
      }
    }

    let sslExpiresAt: string | null = null;
    let sslDaysRemaining: number | null = null;
    if (hop!.certificate?.validTo) {
      const expiry = new Date(hop!.certificate.validTo);
      if (!Number.isNaN(expiry.getTime())) {
        sslExpiresAt = expiry.toISOString();
        sslDaysRemaining = Math.floor((expiry.getTime() - Date.now()) / 86_400_000);
      }
    }

    const degradedAt = cfg.degradedLatencyMs;
    return {
      ok: failures.length === 0,
      degraded: failures.length === 0 && !!degradedAt && timings.total > degradedAt,
      statusCode: hop!.status,
      latencyMs: Math.round(timings.total),
      timings,
      resolvedIp: hop!.address,
      error: failures.length ? failures.join('; ') : null,
      meta: {
        redirects: redirectChain,
        contentLength: hop!.body.length,
        truncated: hop!.truncated,
        contentType: hop!.headers['content-type'] ?? null,
        server: hop!.headers['server'] ?? null,
        sslExpiresAt,
        sslDaysRemaining,
        sslIssuer: hop!.certificate?.issuer ?? null
      }
    };
  } catch (err) {
    const error = err as Error;
    return {
      ok: false,
      statusCode: null,
      latencyMs: Math.round(ms(startedAt)),
      timings: hops.length ? sumTimings(hops) : { total: Math.round(ms(startedAt)) },
      resolvedIp: null,
      error:
        err instanceof TargetBlockedError
          ? error.message
          : `${(error as NodeJS.ErrnoException).code ?? 'request_failed'}: ${error.message}`,
      meta: { blocked: err instanceof TargetBlockedError }
    };
  }
}

function validateHttpConfig(raw: Record<string, any>): asserts raw is HttpConfig {
  if (!raw.url || typeof raw.url !== 'string') throw new Error('A URL is required.');
  parseHttpUrl(raw.url);
  if (raw.method && !/^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/i.test(raw.method)) {
    throw new Error(`Unsupported HTTP method "${raw.method}".`);
  }
}

export const httpRunner: MonitorRunner = {
  type: 'http',
  validate: validateHttpConfig,
  run: (ctx: RunContext) => runHttpCheck(ctx.config as HttpConfig, ctx.timeoutMs)
};

export const apiRunner: MonitorRunner = {
  type: 'api',
  validate: validateHttpConfig,
  run: (ctx: RunContext) =>
    runHttpCheck({ method: 'GET', expectedStatus: ['2xx'], ...(ctx.config as HttpConfig) }, ctx.timeoutMs)
};
