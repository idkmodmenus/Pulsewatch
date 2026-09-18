import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { one, query, tx } from '../../db/pool.js';
import { badRequest, conflict, unauthorized } from '../../lib/errors.js';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../lib/crypto.js';
import { log } from '../../lib/logger.js';
import {
  audit,
  authenticate,
  createSession,
  destroySession,
  requireAuth,
  SESSION_COOKIE,
  setSessionCookie
} from '../auth.js';

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Use at least 10 characters.'),
  name: z.string().min(1).max(120).optional(),
  organization: z.string().min(1).max(120).optional()
});

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'org';

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (req, reply) => {
    const body = credentials.parse(req.body);
    const existing = await one('SELECT id FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (existing) throw conflict('An account with that email already exists.');

    const result = await tx(async (client) => {
      const user = (
        await client.query(
          `INSERT INTO users (email, password_hash, name) VALUES ($1,$2,$3) RETURNING id, email, name`,
          [body.email, await hashPassword(body.password), body.name ?? body.email.split('@')[0]]
        )
      ).rows[0];
      const base = slugify(body.organization ?? body.email.split('@')[1] ?? 'workspace');
      const org = (
        await client.query(
          `INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id, name, slug`,
          [body.organization ?? `${user.name}'s workspace`, `${base}-${randomToken(3).toLowerCase()}`]
        )
      ).rows[0];
      await client.query(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,'owner')`, [
        user.id,
        org.id
      ]);
      const verification = randomToken(24);
      await client.query(
        `INSERT INTO user_tokens (user_id, kind, token_hash, expires_at)
         VALUES ($1,'email_verify',$2, now() + interval '2 days')`,
        [user.id, sha256(verification)]
      );
      return { user, org, verification };
    });

    log.info('verification token issued', { userId: result.user.id });
    const session = await createSession(result.user.id, req);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.code(201).send({ user: result.user, organization: result.org });
  });

  app.post('/auth/login', async (req, reply) => {
    const body = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
    const user = await one<{ id: string; email: string; name: string; password_hash: string }>(
      'SELECT id, email, name, password_hash FROM users WHERE lower(email) = lower($1)',
      [body.email]
    );
    // Constant-ish work on both paths so a missing account is not obviously faster.
    const ok = user ? await verifyPassword(body.password, user.password_hash) : await verifyPassword(body.password, 'scrypt$00$00');
    if (!user || !ok) throw unauthorized('That email and password do not match.');

    const session = await createSession(user.id, req);
    setSessionCookie(reply, session.token, session.expiresAt);
    return { user: { id: user.id, email: user.email, name: user.name } };
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (req) => {
    const principal = await authenticate(req);
    const org = await one('SELECT id, name, slug, retention_days FROM organizations WHERE id = $1', [
      principal.orgId
    ]);
    return {
      principal: { id: principal.id, kind: principal.kind, role: principal.role, email: principal.email, name: principal.name },
      organization: org
    };
  });

  app.post('/auth/password-reset/request', async (req) => {
    const body = z.object({ email: z.string().email() }).parse(req.body);
    const user = await one<{ id: string }>('SELECT id FROM users WHERE lower(email) = lower($1)', [body.email]);
    if (user) {
      const token = randomToken(24);
      await query(
        `INSERT INTO user_tokens (user_id, kind, token_hash, expires_at)
         VALUES ($1,'password_reset',$2, now() + interval '1 hour')`,
        [user.id, sha256(token)]
      );
      log.info('password reset token issued', { userId: user.id });
    }
    // Always the same answer: this endpoint must not reveal which emails exist.
    return { ok: true, message: 'If that address has an account, a reset link is on its way.' };
  });

  app.post('/auth/password-reset/confirm', async (req) => {
    const body = z.object({ token: z.string(), password: z.string().min(10) }).parse(req.body);
    const row = await one<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM user_tokens
        WHERE kind = 'password_reset' AND token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256(body.token)]
    );
    if (!row) throw badRequest('That reset link has expired. Request a new one.');
    await tx(async (client) => {
      await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [
        row.user_id,
        await hashPassword(body.password)
      ]);
      await client.query('UPDATE user_tokens SET used_at = now() WHERE id = $1', [row.id]);
      await client.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
    });
    await audit(req, 'user.password_reset', row.user_id);
    return { ok: true };
  });

  app.post('/auth/verify-email', async (req) => {
    const body = z.object({ token: z.string() }).parse(req.body);
    const row = await one<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM user_tokens
        WHERE kind = 'email_verify' AND token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [sha256(body.token)]
    );
    if (!row) throw badRequest('That verification link is no longer valid.');
    await query('UPDATE users SET email_verified_at = now() WHERE id = $1', [row.user_id]);
    await query('UPDATE user_tokens SET used_at = now() WHERE id = $1', [row.id]);
    return { ok: true };
  });
}
