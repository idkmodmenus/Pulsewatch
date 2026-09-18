/**
 * Applies a check result: stores it, advances the state machine, opens/resolves incidents,
 * tracks resolved IPs and certificate expiry, and raises alerts.
 */
import { dispatchAlert } from '../alerts/dispatcher.js';
import { query, tx } from '../db/pool.js';
import { log } from '../lib/logger.js';
import { publishEvent } from '../realtime/events.js';
import type { CheckResult } from '../checks/types.js';
import { nextState, type MonitorStatus } from './state.js';

export type MonitorRow = {
  id: string;
  org_id: string;
  name: string;
  type: string;
  status: MonitorStatus;
  consecutive_failures: number;
  consecutive_successes: number;
  failure_threshold: number;
  recovery_threshold: number;
  interval_seconds: number;
  timeout_ms: number;
  degraded_latency_ms: number | null;
  config: Record<string, any>;
  last_resolved_ip: string | null;
  last_latency_ms: number | null;
};

const SSL_WARN_DAYS = [30, 14, 7, 3, 1];

export async function applyCheckResult(monitor: MonitorRow, result: CheckResult): Promise<void> {
  const state = nextState(
    {
      status: monitor.status,
      consecutiveFailures: monitor.consecutive_failures,
      consecutiveSuccesses: monitor.consecutive_successes,
      failureThreshold: monitor.failure_threshold,
      recoveryThreshold: monitor.recovery_threshold
    },
    { ok: result.ok, degraded: result.degraded }
  );

  const sslExpiresAt = (result.meta?.sslExpiresAt as string | undefined) ?? null;

  const { incidentOpened, incidentResolved } = await tx(async (client) => {
    await client.query(
      `SELECT ensure_month_partition('monitor_checks', now())`
    );
    await client.query(
      `INSERT INTO monitor_checks
         (monitor_id, org_id, ok, degraded, status_code, latency_ms, timings, resolved_ip, error, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        monitor.id,
        monitor.org_id,
        result.ok,
        !!result.degraded,
        result.statusCode ?? null,
        result.latencyMs,
        result.timings ?? null,
        result.resolvedIp ?? null,
        result.error ? result.error.slice(0, 1000) : null,
        result.meta ?? null
      ]
    );

    await client.query(
      `UPDATE monitors SET
         status = $2,
         consecutive_failures = $3,
         consecutive_successes = $4,
         last_check_at = now(),
         last_success_at = CASE WHEN $5 THEN now() ELSE last_success_at END,
         last_failure_at = CASE WHEN $5 THEN last_failure_at ELSE now() END,
         last_status_change_at = CASE WHEN status <> $2 THEN now() ELSE last_status_change_at END,
         last_latency_ms = $6,
         last_error = $7,
         last_resolved_ip = COALESCE($8, last_resolved_ip),
         ssl_expires_at = COALESCE($9::timestamptz, ssl_expires_at),
         next_run_at = now() + make_interval(secs => interval_seconds),
         updated_at = now()
       WHERE id = $1`,
      [
        monitor.id,
        state.status,
        state.consecutiveFailures,
        state.consecutiveSuccesses,
        result.ok,
        result.latencyMs,
        result.error ? result.error.slice(0, 1000) : null,
        result.resolvedIp ?? null,
        sslExpiresAt
      ]
    );

    if (result.resolvedIp) {
      await client.query(
        `INSERT INTO monitor_ip_history (monitor_id, ip, family)
         VALUES ($1,$2,$3)
         ON CONFLICT (monitor_id, ip) DO UPDATE SET last_seen = now()`,
        [monitor.id, result.resolvedIp, result.resolvedIp.includes(':') ? 6 : 4]
      );
    }

    let opened: { id: number } | null = null;
    let resolved: { id: number; duration: number } | null = null;

    if (state.transition === 'went_down') {
      const row = (
        await client.query(
          `INSERT INTO incidents
             (org_id, monitor_id, status, severity, detected_after_failures, cause, last_success_latency_ms)
           VALUES ($1,$2,'open','down',$3,$4,$5)
           ON CONFLICT (monitor_id) WHERE status <> 'resolved' DO NOTHING
           RETURNING id`,
          [
            monitor.org_id,
            monitor.id,
            state.consecutiveFailures,
            result.error ?? 'Check failed',
            monitor.last_latency_ms
          ]
        )
      ).rows[0] as { id: number } | undefined;
      if (row) {
        opened = row;
        await client.query(
          `INSERT INTO incident_events (incident_id, kind, message, data)
           VALUES ($1,'opened',$2,$3)`,
          [
            row.id,
            `Declared down after ${state.consecutiveFailures} consecutive failed checks`,
            { error: result.error, statusCode: result.statusCode, timings: result.timings }
          ]
        );
      }
    }

    if (state.transition === 'recovered') {
      const row = (
        await client.query(
          `UPDATE incidents
              SET status = 'resolved',
                  resolved_at = now(),
                  duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (now() - started_at))::int)
            WHERE monitor_id = $1 AND status <> 'resolved'
            RETURNING id, duration_seconds`,
          [monitor.id]
        )
      ).rows[0] as { id: number; duration_seconds: number } | undefined;
      if (row) {
        resolved = { id: row.id, duration: row.duration_seconds };
        await client.query(
          `INSERT INTO incident_events (incident_id, kind, message, data)
           VALUES ($1,'resolved',$2,$3)`,
          [
            row.id,
            `Recovered after ${state.consecutiveSuccesses} consecutive successful checks`,
            { latencyMs: result.latencyMs, timings: result.timings }
          ]
        );
      }
    }

    return { incidentOpened: opened, incidentResolved: resolved };
  });

  await publishEvent({
    type: 'check.completed',
    orgId: monitor.org_id,
    data: {
      monitorId: monitor.id,
      name: monitor.name,
      ok: result.ok,
      status: state.status,
      latencyMs: result.latencyMs,
      statusCode: result.statusCode ?? null,
      timings: result.timings ?? null,
      error: result.error ?? null
    }
  });

  if (state.transition !== 'none') {
    await publishEvent({
      type: 'monitor.status',
      orgId: monitor.org_id,
      data: { monitorId: monitor.id, name: monitor.name, status: state.status, transition: state.transition }
    });
  }

  if (incidentOpened) {
    await publishEvent({
      type: 'incident.opened',
      orgId: monitor.org_id,
      data: { incidentId: incidentOpened.id, monitorId: monitor.id, name: monitor.name }
    });
    await dispatchAlert({
      orgId: monitor.org_id,
      eventType: 'monitor.down',
      subjectId: monitor.id,
      monitorId: monitor.id,
      severity: 'critical',
      title: `${monitor.name} is down`,
      message: result.error ?? 'The check failed.',
      fields: [
        { label: 'Incident', value: `#${incidentOpened.id}` },
        { label: 'Failed checks', value: String(state.consecutiveFailures) },
        { label: 'Last good response', value: monitor.last_latency_ms ? `${monitor.last_latency_ms} ms` : 'unknown' }
      ]
    });
  }

  if (incidentResolved) {
    await publishEvent({
      type: 'incident.resolved',
      orgId: monitor.org_id,
      data: {
        incidentId: incidentResolved.id,
        monitorId: monitor.id,
        name: monitor.name,
        durationSeconds: incidentResolved.duration
      }
    });
    await dispatchAlert({
      orgId: monitor.org_id,
      eventType: 'monitor.recovered',
      subjectId: monitor.id,
      monitorId: monitor.id,
      severity: 'info',
      title: `${monitor.name} is back up`,
      message: `Recovered after ${formatDuration(incidentResolved.duration)}.`,
      fields: [
        { label: 'Incident', value: `#${incidentResolved.id}` },
        { label: 'Response time', value: `${result.latencyMs} ms` }
      ]
    });
  }

  if (state.transition === 'degraded') {
    await dispatchAlert({
      orgId: monitor.org_id,
      eventType: 'monitor.degraded',
      subjectId: monitor.id,
      monitorId: monitor.id,
      severity: 'warning',
      title: `${monitor.name} is slow`,
      message: `Responded in ${result.latencyMs} ms, above the ${monitor.degraded_latency_ms} ms threshold.`,
      fields: [{ label: 'Response time', value: `${result.latencyMs} ms` }]
    });
  }

  const loss = result.meta?.packetLossPercent as number | undefined;
  if (typeof loss === 'number' && loss > 0) {
    await dispatchAlert({
      orgId: monitor.org_id,
      eventType: 'monitor.packet_loss',
      subjectId: monitor.id,
      monitorId: monitor.id,
      severity: loss >= 50 ? 'critical' : 'warning',
      title: `${monitor.name} is losing packets`,
      message: `${loss}% packet loss across the last probe.`,
      fields: [{ label: 'Packet loss', value: `${loss}%` }]
    });
  }

  await maybeAlertSslExpiry(monitor, result);
  await maybeAlertIpChange(monitor, result);
}

async function maybeAlertSslExpiry(monitor: MonitorRow, result: CheckResult): Promise<void> {
  const days = result.meta?.sslDaysRemaining as number | undefined;
  if (typeof days !== 'number') return;
  const bucket = SSL_WARN_DAYS.find((d) => days <= d);
  if (bucket === undefined) return;
  await dispatchAlert({
    orgId: monitor.org_id,
    eventType: 'ssl.expiring',
    subjectId: `${monitor.id}:${bucket}`,
    monitorId: monitor.id,
    severity: days <= 7 ? 'critical' : 'warning',
    title: `TLS certificate for ${monitor.name} expires in ${days} days`,
    message: `Renew before ${result.meta?.sslExpiresAt}.`,
    fields: [{ label: 'Issuer', value: String(result.meta?.sslIssuer ?? 'unknown') }]
  });
}

async function maybeAlertIpChange(monitor: MonitorRow, result: CheckResult): Promise<void> {
  if (!result.resolvedIp || !monitor.last_resolved_ip) return;
  if (result.resolvedIp === monitor.last_resolved_ip) return;
  log.info('resolved address changed', {
    monitorId: monitor.id,
    from: monitor.last_resolved_ip,
    to: result.resolvedIp
  });
  await dispatchAlert({
    orgId: monitor.org_id,
    eventType: 'dns.changed',
    subjectId: `${monitor.id}:${result.resolvedIp}`,
    monitorId: monitor.id,
    severity: 'warning',
    title: `${monitor.name} resolves to a new address`,
    message: `${monitor.last_resolved_ip} is now ${result.resolvedIp}.`,
    fields: [
      { label: 'Previous', value: monitor.last_resolved_ip },
      { label: 'Current', value: result.resolvedIp }
    ]
  });
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ${s}s`;
}
