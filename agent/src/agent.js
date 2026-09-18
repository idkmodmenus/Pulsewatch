#!/usr/bin/env node
/**
 * Pulsewatch server agent.
 *
 * Reads host telemetry and POSTs it to the monitoring server. It has no dependencies, opens no
 * listening socket, and never executes anything the server sends back: the response is parsed
 * only for a reporting interval, and nothing else is honoured.
 *
 *   PULSEWATCH_URL=https://monitor.example.com \
 *   PULSEWATCH_TOKEN=agent_xxx.yyy \
 *   node src/agent.js
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const SERVER = (process.env.PULSEWATCH_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const TOKEN = process.env.PULSEWATCH_TOKEN;
const WATCH_PROCESSES = (process.env.PULSEWATCH_PROCESSES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const DISK_PATH = process.env.PULSEWATCH_DISK_PATH ?? '/';
const MIN_INTERVAL_MS = 10_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const QUEUE_LIMIT = 120;

if (!TOKEN) {
  console.error('PULSEWATCH_TOKEN is required. Create an agent in the dashboard to get one.');
  process.exit(1);
}

let intervalMs = Number(process.env.PULSEWATCH_INTERVAL_MS ?? 30_000);
let backoffMs = 0;
const queue = [];

let previousCpu = os.cpus();
function cpuPercent() {
  const current = os.cpus();
  let idle = 0;
  let total = 0;
  for (let i = 0; i < current.length; i++) {
    const before = previousCpu[i]?.times ?? current[i].times;
    const after = current[i].times;
    const deltaIdle = after.idle - before.idle;
    const deltaTotal =
      after.user - before.user + (after.nice - before.nice) + (after.sys - before.sys) +
      (after.irq - before.irq) + deltaIdle;
    idle += deltaIdle;
    total += deltaTotal;
  }
  previousCpu = current;
  if (total <= 0) return null;
  return Math.max(0, Math.min(100, ((total - idle) / total) * 100));
}

async function diskPercent() {
  try {
    const { stdout } = await exec('df', ['-Pk', DISK_PATH], { timeout: 5000 });
    const line = stdout.trim().split('\n').pop() ?? '';
    const used = Number(line.split(/\s+/)[4]?.replace('%', ''));
    return Number.isFinite(used) ? used : null;
  } catch {
    return null;
  }
}

async function networkCounters() {
  try {
    const raw = await readFile('/proc/net/dev', 'utf8');
    let rx = 0;
    let tx = 0;
    for (const line of raw.split('\n').slice(2)) {
      const [name, rest] = line.split(':');
      if (!rest || name.trim() === 'lo') continue;
      const fields = rest.trim().split(/\s+/).map(Number);
      rx += fields[0] || 0;
      tx += fields[8] || 0;
    }
    return { rx, tx };
  } catch {
    return { rx: null, tx: null };
  }
}

async function processHealth() {
  if (WATCH_PROCESSES.length === 0) return undefined;
  const results = [];
  for (const name of WATCH_PROCESSES) {
    if (!/^[A-Za-z0-9._@-]+$/.test(name)) continue; // never pass odd strings to a process lookup
    try {
      await exec('pgrep', ['-x', name], { timeout: 5000 });
      results.push({ name, running: true });
    } catch {
      results.push({ name, running: false, detail: 'no matching process' });
    }
  }
  return results;
}

function addresses() {
  const ipv4 = [];
  const ipv6 = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal) continue;
      (entry.family === 'IPv4' || entry.family === 4 ? ipv4 : ipv6).push(entry.address);
    }
  }
  return { ipv4, ipv6 };
}

async function collect() {
  const totalMem = os.totalmem();
  const { rx, tx } = await networkCounters();
  const { ipv4, ipv6 } = addresses();
  return {
    hostname: os.hostname(),
    cpu: round(cpuPercent()),
    memory: round(((totalMem - os.freemem()) / totalMem) * 100),
    disk: round(await diskPercent()),
    load1: round(os.loadavg()[0]),
    load5: round(os.loadavg()[1]),
    load15: round(os.loadavg()[2]),
    uptime: Math.floor(os.uptime()),
    netRxBytes: rx,
    netTxBytes: tx,
    ipv4,
    ipv6,
    os: { platform: os.platform(), release: os.release(), arch: os.arch(), cpus: os.cpus().length },
    processes: await processHealth(),
    timestamp: new Date().toISOString()
  };
}

const round = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

async function send(payload) {
  const response = await fetch(`${SERVER}/api/agent/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000)
  });

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 30);
    throw Object.assign(new Error('rate limited by server'), { retryAfterMs: retryAfter * 1000 });
  }
  if (response.status === 401 || response.status === 403) {
    console.error('Agent token rejected. Check PULSEWATCH_TOKEN.');
    process.exit(2);
  }
  if (!response.ok) throw new Error(`server responded ${response.status}`);

  // The only instruction accepted from the server is how often to report.
  const body = await response.json().catch(() => ({}));
  const next = Number(body?.nextIntervalSeconds);
  if (Number.isFinite(next) && next > 0) {
    intervalMs = Math.max(MIN_INTERVAL_MS, next * 1000);
  }
}

async function cycle() {
  try {
    queue.push(await collect());
    if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT);
  } catch (err) {
    console.error('collection failed:', err.message);
  }

  while (queue.length) {
    const payload = queue[0];
    try {
      await send(payload);
      queue.shift();
      backoffMs = 0;
    } catch (err) {
      backoffMs = err.retryAfterMs ?? Math.min(MAX_BACKOFF_MS, backoffMs ? backoffMs * 2 : 5_000);
      console.error(`upload failed (${err.message}); ${queue.length} report(s) held, retrying in ${Math.round(backoffMs / 1000)}s`);
      break;
    }
  }

  setTimeout(() => void cycle(), backoffMs || intervalMs).unref?.();
}

console.log(`Pulsewatch agent reporting to ${SERVER} every ${intervalMs / 1000}s`);
cycle();

const stop = () => {
  console.log('agent stopping');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
