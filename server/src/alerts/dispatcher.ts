import { config } from '../config.js';
import { query } from '../db/pool.js';
import { log } from '../lib/logger.js';
import { alertsSent } from '../lib/metrics.js';
import { getChannel, type AlertPayload } from './channels.js';

export type AlertEventType =
  | 'monitor.down'
  | 'monitor.recovered'
  | 'monitor.degraded'
  | 'monitor.high_latency'
  | 'monitor.packet_loss'
  | 'ssl.expiring'
  | 'dns.changed'
  | 'agent.cpu'
  | 'agent.memory'
  | 'agent.disk'
  | 'agent.disconnected';

export type AlertEvent = {
  orgId: string;
  eventType: AlertEventType;
  subjectId: string;
  monitorId?: string | null;
  agentId?: string | null;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  fields?: { label: string; value: string }[];
};

type RuleRow = {
  id: string;
  channel_id: string;
  cooldown_seconds: number;
  channel_type: string;
  channel_config: Record<string, any>;
  channel_enabled: boolean;
};

async function inMaintenance(orgId: string, monitorId: string | null | undefined): Promise<boolean> {
  const rows = await query(
    `SELECT 1 FROM maintenance_windows
      WHERE org_id = $1 AND now() BETWEEN starts_at AND ends_at
        AND (monitor_ids IS NULL OR $2::uuid = ANY(monitor_ids))
      LIMIT 1`,
    [orgId, monitorId ?? null]
  );
  return rows.length > 0;
}

/** Fan an event out to every matching rule, honouring cooldowns and maintenance windows. */
export async function dispatchAlert(event: AlertEvent): Promise<void> {
  const rules = await query<RuleRow>(
    `SELECT r.id, r.channel_id, r.cooldown_seconds,
            c.type AS channel_type, c.config AS channel_config, c.enabled AS channel_enabled
       FROM alert_rules r
       JOIN notification_channels c ON c.id = r.channel_id
      WHERE r.org_id = $1 AND r.enabled
        AND $2 = ANY(r.event_types)
        AND (r.monitor_ids IS NULL OR $3::uuid = ANY(r.monitor_ids))
        AND (r.agent_ids IS NULL OR $4::uuid = ANY(r.agent_ids))`,
    [event.orgId, event.eventType, event.monitorId ?? null, event.agentId ?? null]
  );
  if (rules.length === 0) return;

  const maintenance = await inMaintenance(event.orgId, event.monitorId);
  const payload: AlertPayload = {
    eventType: event.eventType,
    title: event.title,
    message: event.message,
    severity: event.severity,
    url: `${config.PUBLIC_URL}${event.monitorId ? `/monitors/${event.monitorId}` : '/dashboard'}`,
    fields: event.fields ?? [],
    occurredAt: new Date().toISOString()
  };

  for (const rule of rules) {
    const record = (status: 'sent' | 'failed' | 'suppressed', error?: string) =>
      query(
        `INSERT INTO alert_deliveries (org_id, rule_id, channel_id, subject_id, event_type, status, error, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [event.orgId, rule.id, rule.channel_id, event.subjectId, event.eventType, status, error ?? null, payload]
      ).catch((err) => log.warn('alert delivery not recorded', { err: String(err) }));

    if (maintenance) {
      await record('suppressed', 'inside a maintenance window');
      alertsSent.inc({ channel: rule.channel_type, status: 'suppressed' });
      continue;
    }
    if (!rule.channel_enabled) {
      await record('suppressed', 'channel is turned off');
      continue;
    }

    const recent = await query<{ created_at: Date }>(
      `SELECT created_at FROM alert_deliveries
        WHERE rule_id = $1 AND subject_id = $2 AND event_type = $3 AND status = 'sent'
          AND created_at > now() - make_interval(secs => $4)
        ORDER BY created_at DESC LIMIT 1`,
      [rule.id, event.subjectId, event.eventType, rule.cooldown_seconds]
    );
    if (recent.length > 0) {
      await record('suppressed', 'cooldown');
      alertsSent.inc({ channel: rule.channel_type, status: 'suppressed' });
      continue;
    }

    try {
      await getChannel(rule.channel_type).send(rule.channel_config ?? {}, payload);
      await record('sent');
      alertsSent.inc({ channel: rule.channel_type, status: 'sent' });
    } catch (err) {
      await record('failed', String((err as Error).message).slice(0, 500));
      alertsSent.inc({ channel: rule.channel_type, status: 'failed' });
      log.warn('alert delivery failed', { channel: rule.channel_type, err: String(err) });
    }
  }
}
