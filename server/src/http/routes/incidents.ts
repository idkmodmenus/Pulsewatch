import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { audit, principalOf, requireAuth, requireRole } from '../auth.js';

export default async function incidentRoutes(app: FastifyInstance) {
  app.get('/incidents', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { status, limit = '50' } = req.query as Record<string, string>;
    const incidents = await query(
      `SELECT i.*, m.name AS monitor_name, m.type AS monitor_type
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        WHERE i.org_id = $1 AND ($2::text IS NULL OR i.status = $2)
        ORDER BY i.started_at DESC LIMIT $3`,
      [orgId, status ?? null, Math.min(Number(limit) || 50, 200)]
    );
    return { incidents };
  });

  app.get('/incidents/:id', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const incident = await one(
      `SELECT i.*, m.name AS monitor_name, m.type AS monitor_type
         FROM incidents i JOIN monitors m ON m.id = i.monitor_id
        WHERE i.id = $1 AND i.org_id = $2`,
      [id, orgId]
    );
    if (!incident) throw notFound('That incident does not exist.');
    const events = await query(
      `SELECT at, kind, message, data FROM incident_events WHERE incident_id = $1 ORDER BY at`,
      [id]
    );
    return { incident, events };
  });

  app.post('/incidents/:id/acknowledge', { preHandler: requireRole('member') }, async (req) => {
    const { orgId, id: actorId } = principalOf(req);
    const { id } = req.params as { id: string };
    const body = z.object({ note: z.string().max(500).optional() }).parse(req.body ?? {});
    const incident = await one(
      `UPDATE incidents SET status = 'acknowledged'
        WHERE id = $1 AND org_id = $2 AND status = 'open' RETURNING *`,
      [id, orgId]
    );
    if (!incident) throw notFound('That incident is not open.');
    await query(
      `INSERT INTO incident_events (incident_id, kind, message, data) VALUES ($1,'acknowledged',$2,$3)`,
      [id, body.note ?? 'Acknowledged', { actorId }]
    );
    await audit(req, 'incident.acknowledged', String(id));
    return { incident };
  });

  app.post('/incidents/:id/comment', { preHandler: requireRole('member') }, async (req, reply) => {
    const { orgId, id: actorId } = principalOf(req);
    const { id } = req.params as { id: string };
    const body = z.object({ message: z.string().min(1).max(1000) }).parse(req.body);
    const incident = await one('SELECT id FROM incidents WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!incident) throw notFound('That incident does not exist.');
    await query(
      `INSERT INTO incident_events (incident_id, kind, message, data) VALUES ($1,'comment',$2,$3)`,
      [id, body.message, { actorId }]
    );
    return reply.code(201).send({ ok: true });
  });
}
