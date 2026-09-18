import { collectDefaultMetrics, Counter, Gauge, Histogram, Registry } from 'prom-client';

export const registry = new Registry();
registry.setDefaultLabels({ service: 'pulsewatch' });
collectDefaultMetrics({ register: registry });

export const checksTotal = new Counter({
  name: 'pulsewatch_checks_total',
  help: 'Checks executed, by monitor type and outcome',
  labelNames: ['type', 'outcome'],
  registers: [registry]
});

export const checkDuration = new Histogram({
  name: 'pulsewatch_check_duration_seconds',
  help: 'Wall-clock duration of a check execution',
  labelNames: ['type'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry]
});

export const workerFailures = new Counter({
  name: 'pulsewatch_worker_failures_total',
  help: 'Check jobs that threw instead of returning a result',
  labelNames: ['type'],
  registers: [registry]
});

export const alertsSent = new Counter({
  name: 'pulsewatch_alerts_total',
  help: 'Alert deliveries by channel type and status',
  labelNames: ['channel', 'status'],
  registers: [registry]
});

export const queueDepth = new Gauge({
  name: 'pulsewatch_queue_depth',
  help: 'Jobs in the check queue by state',
  labelNames: ['state'],
  registers: [registry]
});

export const activeMonitors = new Gauge({
  name: 'pulsewatch_active_monitors',
  help: 'Enabled monitors by status',
  labelNames: ['status'],
  registers: [registry]
});

export const dependencyLatency = new Gauge({
  name: 'pulsewatch_dependency_latency_ms',
  help: 'Round-trip latency to a backing service',
  labelNames: ['dependency'],
  registers: [registry]
});

export const schedulerTicks = new Counter({
  name: 'pulsewatch_scheduler_ticks_total',
  help: 'Scheduler loop iterations, by outcome',
  labelNames: ['outcome'],
  registers: [registry]
});

export const apiRequests = new Counter({
  name: 'pulsewatch_api_requests_total',
  help: 'HTTP API requests by method, route and status class',
  labelNames: ['method', 'route', 'status'],
  registers: [registry]
});
