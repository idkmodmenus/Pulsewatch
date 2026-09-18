import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { issueToken } from '../../lib/crypto.js';
import { audit, principalOf, requireRole } from '../auth.js';

export default async function apiKeyRoutes(app: FastifyInstance) {
  app.get('/api-keys', { preHandler: requireRole('admin') }, async (req) => {
    const { orgId } = principalOf(req);
    const keys = await query(
      `SELECT id, name, prefix, role, last_used_at, expires_at, revoked_at, created_at
         FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId]
    );
    return { keys };
  });

  app.post('/api-keys', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId, id: actorId, kind } = principalOf(req);
    const body = z
      .object({
        name: z.string().min(1).max(80),
        role: z.enum(['admin', 'member', 'viewer']).default('member'),
        expiresInDays: z.number().int().min(1).max(730).nullable().default(null)
      })
      .parse(req.body);
    const { token, prefix, hash } = issueToken('pw');
    const key = await one(
      `INSERT INTO api_keys (org_id, name, prefix, token_hash, role, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END)
       RETURNING id, name, prefix, role, expires_at, created_at`,
      [orgId, body.name, prefix, hash, body.role, kind === 'user' ? actorId : null, body.expiresInDays]
    );
    await audit(req, 'api_key.created', key!.id, { role: body.role });
    // The plaintext token is returned exactly once.
    return reply.code(201).send({ key, token });
  });

  app.delete('/api-keys/:id', { preHandler: requireRole('admin') }, async (req, reply) => {
    const { orgId } = principalOf(req);
    const { id } = req.params as { id: string };
    await query('UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND org_id = $2', [id, orgId]);
    await audit(req, 'api_key.revoked', id);
    return reply.code(204).send();
  });
}
