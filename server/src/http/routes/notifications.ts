import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { channelTypes, getChannel } from '../../alerts/channels.js';
import { audit, principalOf, requireAuth, requireRole } from '../auth.js';

const EVENT_TYPES = [
  'monitor.down', 'monitor.recovered', 'monitor.degraded', 'monitor.high_latency',
  'monitor.packet_loss', 'ssl.expiring', 'dns.changed',
  'agent.cpu', 'agent.memory', 'agent.disk', 'agent.disconnected'
] as const;

export default async function notificationRoutes(app: FastifyInstance) {
  app.get('/notification-channels', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const channels = await query(
      `SELECT id, type, name, enabled, created_at,
              -- secrets never leave the server
              (config - 'secret' - 'webhookUrl' - 'url') AS config,
              (config ? 'webhookUrl') OR (config ? 'url') AS has_endpoint
         FROM notification_channels WHERE org_id = $1 ORDER BY created_at`,
      [orgId]
    );
    return { channels, types: channelTypes };
  });

  app.post('/notification-channels', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const body = z
      .object({
        type: z.enum(channelTypes as [string, ...string[]]),
        name: z.string().min(1).max(80),
        config: z.record(z.any()),
        enabled: z.boolean().default(true)
      })
      .parse(req.body);
    const channel = await one(
      `INSERT INTO notification_channels (org_id, type, name, config, enabled)
       VALUES ($1,$2,$3,$4,$5) RETURNING id, type, name, enabled, created_at`,
      [orgId, body.type, body.name, body.config, body.enabled]
    );
    await audit(req, 'channel.created', channel!.id, { type: body.type });
    return reply.code(201).send({ channel });
  });

  app.post('/notification-channels/:id/test', { preHandler: requireRole('admin') }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const channel = await one<{ type: string; config: Record<string, any> }>(
      'SELECT type, config FROM notification_channels WHERE id = $1 AND org_id = $2',
      [id, orgId]
    );
    if (!channel) throw notFound('That channel does not exist.');
    try {
      await getChannel(channel.type).send(channel.config, {
        eventType: 'test',
        title: 'Pulsewatch test notification',
        message: 'If you can read this, the channel works.',
        severity: 'info',
        fields: [{ label: 'Sent', value: new Date().toISOString() }],
        occurredAt: new Date().toISOString()
      });
      return { delivered: true };
    } catch (err) {
      return { delivered: false, error: (err as Error).message };
    }
  });

  app.delete('/notification-channels/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await query('DELETE FROM notification_channels WHERE id = $1 AND org_id = $2', [id, orgId]);
    await audit(req, 'channel.deleted', id);
    return reply.code(204).send();
  });

  app.get('/alert-rules', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const rules = await query(
      `SELECT r.*, c.name AS channel_name, c.type AS channel_type
         FROM alert_rules r JOIN notification_channels c ON c.id = r.channel_id
        WHERE r.org_id = $1 ORDER BY r.created_at`,
      [orgId]
    );
    return { rules, eventTypes: EVENT_TYPES };
  });

  app.post('/alert-rules', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        channelId: z.string().uuid(),
        eventTypes: z.array(z.enum(EVENT_TYPES)).min(1),
        monitorIds: z.array(z.string().uuid()).nullable().default(null),
        agentIds: z.array(z.string().uuid()).nullable().default(null),
        thresholds: z.record(z.any()).default({}),
        cooldownSeconds: z.number().int().min(0).max(86_400).default(900),
        enabled: z.boolean().default(true)
      })
      .parse(req.body);
    const channel = await one('SELECT id FROM notification_channels WHERE id = $1 AND org_id = $2', [
      body.channelId,
      orgId
    ]);
    if (!channel) throw notFound('That notification channel does not exist.');
    const rule = await one(
      `INSERT INTO alert_rules
         (org_id, name, event_types, channel_id, monitor_ids, agent_ids, thresholds, cooldown_seconds, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        orgId, body.name, body.eventTypes, body.channelId,
        body.monitorIds?.length ? body.monitorIds : null,
        body.agentIds?.length ? body.agentIds : null,
        body.thresholds, body.cooldownSeconds, body.enabled
      ]
    );
    await audit(req, 'alert_rule.created', rule!.id);
    return reply.code(201).send({ rule });
  });

  app.delete('/alert-rules/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await query('DELETE FROM alert_rules WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.code(204).send();
  });

  app.get('/alert-deliveries', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const deliveries = await query(
      `SELECT d.id, d.event_type, d.status, d.error, d.created_at, c.name AS channel_name, c.type AS channel_type
         FROM alert_deliveries d LEFT JOIN notification_channels c ON c.id = d.channel_id
        WHERE d.org_id = $1 ORDER BY d.created_at DESC LIMIT 100`,
      [orgId]
    );
    return { deliveries };
  });

  app.get('/maintenance-windows', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    return { windows: await query(
      'SELECT * FROM maintenance_windows WHERE org_id = $1 ORDER BY starts_at DESC LIMIT 100', [orgId]) };
  });

  app.post('/maintenance-windows', { preHandler: requireRole('member') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        monitorIds: z.array(z.string().uuid()).nullable().default(null),
        startsAt: z.string().datetime(),
        endsAt: z.string().datetime(),
        suppressChecks: z.boolean().default(false)
      })
      .parse(req.body);
    const window = await one(
      `INSERT INTO maintenance_windows (org_id, name, monitor_ids, starts_at, ends_at, suppress_checks)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [orgId, body.name, body.monitorIds?.length ? body.monitorIds : null, body.startsAt, body.endsAt, body.suppressChecks]
    );
    return reply.code(201).send({ window });
  });

  app.delete('/maintenance-windows/:id', { preHandler: requireRole('member') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await query('DELETE FROM maintenance_windows WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.code(204).send();
  });
}
