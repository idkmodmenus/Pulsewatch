import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { one, query } from '../db/pool.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { parseTokenPrefix, randomToken, safeEqualHex, sha256 } from '../lib/crypto.js';

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
const RANK: Record<Role, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export type Principal = {
  kind: 'user' | 'api_key';
  id: string;
  orgId: string;
  role: Role;
  email?: string;
  name?: string;
};

export const SESSION_COOKIE = 'pw_session';

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export async function createSession(userId: string, req: FastifyRequest): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);
  await query(
    `INSERT INTO sessions (user_id, token_hash, user_agent, ip, expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [userId, sha256(token), req.headers['user-agent'] ?? null, req.ip, expiresAt]
  );
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.COOKIE_SECURE,
    path: '/',
    expires: expiresAt
  });
}

async function principalFromSession(token: string): Promise<Principal | null> {
  const row = await one<{ user_id: string; email: string; name: string; org_id: string; role: Role }>(
    `SELECT s.user_id, u.email, u.name, m.org_id, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      ORDER BY m.created_at
      LIMIT 1`,
    [sha256(token)]
  );
  if (!row) return null;
  return { kind: 'user', id: row.user_id, orgId: row.org_id, role: row.role, email: row.email, name: row.name };
}

async function principalFromApiKey(token: string): Promise<Principal | null> {
  const prefix = parseTokenPrefix(token);
  if (!prefix) return null;
  const row = await one<{ id: string; org_id: string; role: Role; token_hash: string; name: string }>(
    `SELECT id, org_id, role, token_hash, name FROM api_keys
      WHERE prefix = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
    [prefix]
  );
  if (!row || !safeEqualHex(row.token_hash, sha256(token))) return null;
  await query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.id]);
  return { kind: 'api_key', id: row.id, orgId: row.org_id, role: row.role, name: row.name };
}

export async function authenticate(req: FastifyRequest): Promise<Principal> {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const principal = await principalFromApiKey(header.slice(7).trim());
    if (!principal) throw unauthorized('That API key is not valid.');
    return principal;
  }
  const cookie = req.cookies?.[SESSION_COOKIE];
  if (cookie) {
    const principal = await principalFromSession(cookie);
    if (principal) return principal;
  }
  throw unauthorized();
}

/** Fastify preHandler: authenticates and enforces a minimum role. */
export function requireRole(minimum: Role) {
  return async (req: FastifyRequest) => {
    const principal = req.principal ?? (await authenticate(req));
    req.principal = principal;
    if (RANK[principal.role] < RANK[minimum]) {
      throw forbidden(`This action needs the ${minimum} role or higher.`);
    }
  };
}

export const requireAuth = requireRole('viewer');

export function principalOf(req: FastifyRequest): Principal {
  if (!req.principal) throw unauthorized();
  return req.principal;
}

export async function audit(
  req: FastifyRequest,
  action: string,
  target: string | null,
  data?: Record<string, unknown>
): Promise<void> {
  const principal = req.principal;
  await query(
    `INSERT INTO audit_logs (org_id, actor_type, actor_id, action, target, data, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [principal?.orgId ?? null, principal?.kind ?? 'system', principal?.id ?? null, action, target, data ?? null, req.ip]
  ).catch(() => undefined);
}
