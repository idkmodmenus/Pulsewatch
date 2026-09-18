import { apiRunner, httpRunner } from './http.js';
import { dnsRunner } from './dns.js';
import { pingRunner } from './ping.js';
import { tcpRunner } from './tcp.js';
import type { MonitorRunner } from './types.js';

/** Adding a monitor type means adding a runner here and a config form in the UI. */
const runners = new Map<string, MonitorRunner>(
  [httpRunner, apiRunner, tcpRunner, dnsRunner, pingRunner].map((r) => [r.type, r])
);

export const monitorTypes = [...runners.keys()];

export function getRunner(type: string): MonitorRunner {
  const runner = runners.get(type);
  if (!runner) throw new Error(`Unknown monitor type "${type}".`);
  return runner;
}

export function validateMonitorConfig(type: string, config: Record<string, any>): void {
  getRunner(type).validate(config);
}
