import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { audit, principalOf, requireAuth, requireRole } from '../auth.js';

const slugPattern = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export default async function statusPageRoutes(app: FastifyInstance) {
  app.get('/status-pages', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const pages = await query(
      `SELECT p.*, (SELECT count(*)::int FROM status_page_monitors s WHERE s.status_page_id = p.id) AS monitor_count
         FROM status_pages p WHERE p.org_id = $1 ORDER BY p.created_at`,
      [orgId]
    );
    return { pages };
  });

  app.post('/status-pages', { preHandler: requireRole('member') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const body = z
      .object({
        slug: z.string().regex(slugPattern, 'Use lowercase letters, numbers and hyphens.'),
        title: z.string().min(1).max(120),
        description: z.string().max(500).default(''),
        isPublic: z.boolean().default(true),
        branding: z
          .object({ accent: z.string().max(20).optional(), logoUrl: z.string().url().optional(), footer: z.string().max(200).optional() })
          .default({}),
        monitors: z
          .array(z.object({ monitorId: z.string().uuid(), displayName: z.string().max(80).optional(), group: z.string().max(60).default('Services') }))
          .default([])
      })
      .parse(req.body);

    const existing = await one('SELECT id FROM status_pages WHERE slug = $1', [body.slug]);
    if (existing) throw conflict('That address is already taken.');

    const page = await tx(async (client) => {
      const created = (
        await client.query(
          `INSERT INTO status_pages (org_id, slug, title, description, branding, is_public)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [orgId, body.slug, body.title, body.description, body.branding, body.isPublic]
        )
      ).rows[0];
      for (const [index, m] of body.monitors.entries()) {
        await client.query(
          `INSERT INTO status_page_monitors (status_page_id, monitor_id, display_name, group_name, sort_order)
           SELECT $1, id, $3, $4, $5 FROM monitors WHERE id = $2 AND org_id = $6`,
          [created.id, m.monitorId, m.displayName ?? null, m.group, index, orgId]
        );
      }
      return created;
    });
    await audit(req, 'status_page.created', page.id, { slug: body.slug });
    return reply.code(201).send({ page });
  });

  app.patch('/status-pages/:id', { preHandler: requireRole('member') }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        title: z.string().min(1).max(120).optional(),
        description: z.string().max(500).optional(),
        isPublic: z.boolean().optional(),
        branding: z.record(z.any()).optional(),
        monitors: z
          .array(z.object({ monitorId: z.string().uuid(), displayName: z.string().max(80).optional(), group: z.string().max(60).default('Services') }))
          .optional()
      })
      .parse(req.body);

    const page = await one('SELECT * FROM status_pages WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!page) throw notFound('That status page does not exist.');

    const updated = await tx(async (client) => {
      const row = (
        await client.query(
          `UPDATE status_pages SET
             title = COALESCE($3, title),
             description = COALESCE($4, description),
             is_public = COALESCE($5, is_public),
             branding = COALESCE($6, branding)
           WHERE id = $1 AND org_id = $2 RETURNING *`,
          [id, orgId, body.title ?? null, body.description ?? null, body.isPublic ?? null, body.branding ?? null]
        )
      ).rows[0];
      if (body.monitors) {
        await client.query('DELETE FROM status_page_monitors WHERE status_page_id = $1', [id]);
        for (const [index, m] of body.monitors.entries()) {
          await client.query(
            `INSERT INTO status_page_monitors (status_page_id, monitor_id, display_name, group_name, sort_order)
             SELECT $1, id, $3, $4, $5 FROM monitors WHERE id = $2 AND org_id = $6`,
            [id, m.monitorId, m.displayName ?? null, m.group, index, orgId]
          );
        }
      }
      return row;
    });
    return { page: updated };
  });

  app.get('/status-pages/:id', { preHandler: requireAuth }, async (req) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    const page = await one('SELECT * FROM status_pages WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (!page) throw notFound('That status page does not exist.');
    const monitors = await query(
      `SELECT s.monitor_id, COALESCE(s.display_name, m.name) AS name, s.group_name, s.sort_order, m.status, m.type
         FROM status_page_monitors s JOIN monitors m ON m.id = s.monitor_id
        WHERE s.status_page_id = $1 ORDER BY s.sort_order`,
      [id]
    );
    return { page, monitors };
  });

  app.delete('/status-pages/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await query('DELETE FROM status_pages WHERE id = $1 AND org_id = $2', [id, orgId]);
    return reply.code(204).send();
  });

  /** Public, unauthenticated read model. Exposes status only: no URLs, no error detail. */
  app.get('/public/status-pages/:slug', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const { slug } = req.params as { slug: string };
    const page = await one<{ id: string; title: string; description: string; branding: Record<string, string> }>(
      'SELECT id, title, description, branding FROM status_pages WHERE slug = $1 AND is_public',
      [slug]
    );
    if (!page) throw notFound('No status page lives at that address.');

    const services = await query(
      `SELECT COALESCE(s.display_name, m.name) AS name, s.group_name, m.status, m.last_status_change_at,
              COALESCE((
                SELECT round(avg((r.checks - r.failures)::numeric / NULLIF(r.checks,0)) * 100, 3)
                  FROM monitor_check_rollups r
                 WHERE r.monitor_id = m.id AND r.period = 'day' AND r.bucket > now() - interval '90 days'
              ), 100) AS uptime_90d,
              (
                SELECT json_agg(json_build_object('day', d.bucket::date, 'uptime',
                        round((d.checks - d.failures)::numeric / NULLIF(d.checks,0) * 100, 2)) ORDER BY d.bucket)
                  FROM monitor_check_rollups d
                 WHERE d.monitor_id = m.id AND d.period = 'day' AND d.bucket > now() - interval '90 days'
              ) AS history
         FROM status_page_monitors s JOIN monitors m ON m.id = s.monitor_id
        WHERE s.status_page_id = $1 ORDER BY s.sort_order`,
      [page.id]
    );

    const incidents = await query(
      `SELECT i.id, i.status, i.severity, i.started_at, i.resolved_at, i.duration_seconds,
              COALESCE(s.display_name, m.name) AS monitor_name
         FROM incidents i
         JOIN status_page_monitors s ON s.monitor_id = i.monitor_id AND s.status_page_id = $1
         JOIN monitors m ON m.id = i.monitor_id
        WHERE i.started_at > now() - interval '30 days'
        ORDER BY i.started_at DESC LIMIT 20`,
      [page.id]
    );

    const worst = services.some((s) => s.status === 'down')
      ? 'major_outage'
      : services.some((s) => s.status === 'degraded')
        ? 'degraded'
        : 'operational';

    return { page: { title: page.title, description: page.description, branding: page.branding }, overall: worst, services, incidents };
  });
}
