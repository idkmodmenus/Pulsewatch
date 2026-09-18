/**
 * Target validation for user-supplied hosts.
 *
 * Every check resolves the hostname first, validates each resolved address against the
 * blocklist, and then connects to that exact address. Because the socket never re-resolves,
 * a name that flips to an internal address between validation and connect cannot be reached
 * (DNS rebinding). Nothing here scans: it only inspects the hosts a user configured.
 */
import { isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';
import { config } from '../config.js';

export class TargetBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetBlockedError';
  }
}

type Cidr = { bytes: Uint8Array; bits: number; family: 4 | 6; label: string };

function v4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i])) return null;
    const n = Number(parts[i]);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

function v6ToBytes(ip: string): Uint8Array | null {
  let address = ip.split('%')[0];
  let tail4: Uint8Array | null = null;
  const lastColon = address.lastIndexOf(':');
  const trailing = address.slice(lastColon + 1);
  if (trailing.includes('.')) {
    tail4 = v4ToBytes(trailing);
    if (!tail4) return null;
    address = address.slice(0, lastColon + 1) + '0:0';
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const groups = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (groups < 0) return null;
  const all = [...head, ...Array(groups).fill('0'), ...tail];
  if (all.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(all[i])) return null;
    const n = parseInt(all[i], 16);
    out[i * 2] = n >> 8;
    out[i * 2 + 1] = n & 0xff;
  }
  if (tail4) out.set(tail4, 12);
  return out;
}

export function ipToBytes(ip: string): { bytes: Uint8Array; family: 4 | 6 } | null {
  const family = isIP(ip);
  if (family === 4) {
    const b = v4ToBytes(ip);
    return b ? { bytes: b, family: 4 } : null;
  }
  if (family === 6) {
    const b = v6ToBytes(ip);
    return b ? { bytes: b, family: 6 } : null;
  }
  return null;
}

export function parseCidr(cidr: string, label = cidr): Cidr | null {
  const [ip, bitsRaw] = cidr.split('/');
  const parsed = ipToBytes(ip);
  if (!parsed) return null;
  const maxBits = parsed.family === 4 ? 32 : 128;
  const bits = bitsRaw === undefined ? maxBits : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return null;
  return { bytes: parsed.bytes, bits, family: parsed.family, label };
}

function inCidr(bytes: Uint8Array, cidr: Cidr): boolean {
  let remaining = cidr.bits;
  for (let i = 0; i < bytes.length && remaining > 0; i++) {
    const take = Math.min(8, remaining);
    const mask = take === 8 ? 0xff : (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (cidr.bytes[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

const BLOCKED_V4: Cidr[] = [
  ['0.0.0.0/8', 'unspecified'],
  ['10.0.0.0/8', 'private'],
  ['100.64.0.0/10', 'carrier-grade NAT / cloud metadata'],
  ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local / cloud metadata'],
  ['172.16.0.0/12', 'private'],
  ['192.0.0.0/24', 'IETF protocol assignments'],
  ['192.0.2.0/24', 'documentation'],
  ['192.168.0.0/16', 'private'],
  ['198.18.0.0/15', 'benchmarking'],
  ['198.51.100.0/24', 'documentation'],
  ['203.0.113.0/24', 'documentation'],
  ['224.0.0.0/4', 'multicast'],
  ['240.0.0.0/4', 'reserved']
].map(([c, l]) => parseCidr(c, l)!);

const BLOCKED_V6: Cidr[] = [
  ['::/128', 'unspecified'],
  ['::1/128', 'loopback'],
  ['fc00::/7', 'unique local / cloud metadata'],
  ['fe80::/10', 'link-local'],
  ['ff00::/8', 'multicast'],
  ['2001:db8::/32', 'documentation'],
  ['100::/64', 'discard-only']
].map(([c, l]) => parseCidr(c, l)!);

const V4_MAPPED = parseCidr('::ffff:0:0/96')!;
const NAT64 = parseCidr('64:ff9b::/96')!;

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'metadata'
]);

const allowList: Cidr[] = config.ALLOWED_PRIVATE_CIDRS.split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => parseCidr(s))
  .filter((c): c is Cidr => c !== null);

/** Returns a human-readable reason when the address must not be contacted. */
export function blockReason(ip: string): string | null {
  const parsed = ipToBytes(ip);
  if (!parsed) return 'not a valid IP address';
  if (config.ALLOW_PRIVATE_TARGETS) return null;
  if (allowList.some((c) => c.family === parsed.family && inCidr(parsed.bytes, c))) return null;

  if (parsed.family === 4) {
    const hit = BLOCKED_V4.find((c) => inCidr(parsed.bytes, c));
    return hit ? `${ip} is in a blocked range (${hit.label})` : null;
  }
  if (inCidr(parsed.bytes, V4_MAPPED) || inCidr(parsed.bytes, NAT64)) {
    const embedded = Array.from(parsed.bytes.slice(12)).join('.');
    const reason = blockReason(embedded);
    return reason ? `${ip} embeds ${reason}` : null;
  }
  const hit = BLOCKED_V6.find((c) => inCidr(parsed.bytes, c));
  return hit ? `${ip} is in a blocked range (${hit.label})` : null;
}

export const isBlockedIp = (ip: string): boolean => blockReason(ip) !== null;

export function assertHostnameAllowed(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.internal')) {
    if (!config.ALLOW_PRIVATE_TARGETS) {
      throw new TargetBlockedError(`Host "${hostname}" is not an allowed monitoring target.`);
    }
  }
}

export type ResolvedTarget = {
  hostname: string;
  addresses: { address: string; family: 4 | 6 }[];
  dnsMs: number;
  cached: boolean;
};

type CacheEntry = { value: ResolvedTarget; expires: number };
const dnsCache = new Map<string, CacheEntry>();

export function clearDnsCache(): void {
  dnsCache.clear();
}

/**
 * Resolve a hostname to validated addresses. Literal IPs skip DNS entirely.
 * Results are cached for DNS_CACHE_TTL_MS so a 30s check interval does not hammer resolvers.
 */
export async function resolveTarget(
  hostname: string,
  opts: { family?: 4 | 6 | 0; timeoutMs?: number; useCache?: boolean } = {}
): Promise<ResolvedTarget> {
  const family = opts.family ?? 0;
  const useCache = opts.useCache ?? true;
  assertHostnameAllowed(hostname);

  const literal = isIP(hostname);
  if (literal) {
    const reason = blockReason(hostname);
    if (reason) throw new TargetBlockedError(`Blocked target: ${reason}.`);
    return {
      hostname,
      addresses: [{ address: hostname, family: literal as 4 | 6 }],
      dnsMs: 0,
      cached: false
    };
  }

  const cacheKey = `${hostname}|${family}`;
  const hit = dnsCache.get(cacheKey);
  if (useCache && hit && hit.expires > Date.now()) {
    return { ...hit.value, cached: true };
  }

  const resolver = new Resolver({ timeout: opts.timeoutMs ?? 5000, tries: 2 });
  const started = process.hrtime.bigint();
  const addresses: { address: string; family: 4 | 6 }[] = [];
  const errors: string[] = [];

  if (family !== 6) {
    try {
      for (const a of await resolver.resolve4(hostname)) addresses.push({ address: a, family: 4 });
    } catch (err) {
      errors.push(`A: ${(err as Error).message}`);
    }
  }
  if (family !== 4) {
    try {
      for (const a of await resolver.resolve6(hostname)) addresses.push({ address: a, family: 6 });
    } catch (err) {
      errors.push(`AAAA: ${(err as Error).message}`);
    }
  }
  const dnsMs = Number(process.hrtime.bigint() - started) / 1e6;

  if (addresses.length === 0) {
    throw new Error(`DNS resolution failed for ${hostname} (${errors.join('; ') || 'no records'})`);
  }
  for (const a of addresses) {
    const reason = blockReason(a.address);
    if (reason) {
      throw new TargetBlockedError(`Blocked target: ${hostname} resolves to ${reason}.`);
    }
  }

  const value: ResolvedTarget = { hostname, addresses, dnsMs, cached: false };
  dnsCache.set(cacheKey, { value, expires: Date.now() + config.DNS_CACHE_TTL_MS });
  return value;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TargetBlockedError(`"${raw}" is not a valid URL.`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new TargetBlockedError('Only http and https targets can be monitored.');
  }
  if (url.username || url.password) {
    throw new TargetBlockedError('Credentials in the URL are not supported. Use a header instead.');
  }
  assertHostnameAllowed(url.hostname);
  return url;
}
