/**
 * Seed data: one organisation, an owner, a monitor of every type, a status page, an agent,
 * and 48 hours of synthetic history (including one resolved incident) so the dashboard has
 * something real to draw on a fresh install.
 */
import { config } from '../config.js';
import { hashPassword, issueToken } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { migrate } from './migrate.js';
import { pool, one, query, tx } from './pool.js';
import { rollupChecks } from '../engine/maintenance.js';

async function seed() {
  await migrate();

  const existing = await one<{ id: string }>('SELECT id FROM organizations WHERE slug = $1', ['demo']);
  if (existing) {
    log.info('seed skipped, demo organisation already exists');
    return;
  }

  const { orgId, monitorIds, agentToken } = await tx(async (client) => {
    const org = (
      await client.query(
        `INSERT INTO organizations (name, slug, retention_days) VALUES ('Demo Infrastructure','demo',30) RETURNING id`
      )
    ).rows[0];
    const user = (
      await client.query(
        `INSERT INTO users (email, password_hash, name, email_verified_at)
         VALUES ($1,$2,'Demo Owner', now()) RETURNING id`,
        [config.SEED_EMAIL, await hashPassword(config.SEED_PASSWORD)]
      )
    ).rows[0];
    await client.query(`INSERT INTO memberships (user_id, org_id, role) VALUES ($1,$2,'owner')`, [user.id, org.id]);

    const monitors = [
      {
        name: 'Marketing site',
        type: 'http',
        interval: 60,
        degraded: 800,
        config: { url: 'https://example.com', method: 'GET', expectedStatus: ['2xx'], keyword: 'Example Domain' }
      },
      {
        name: 'Public API',
        type: 'api',
        interval: 60,
        degraded: 1200,
        config: {
          url: 'https://api.github.com/zen',
          method: 'GET',
          expectedStatus: [200],
          headers: { accept: 'application/vnd.github+json' }
        }
      },
      {
        name: 'Edge TLS endpoint',
        type: 'tcp',
        interval: 300,
        degraded: 200,
        config: { host: 'one.one.one.one', port: 443 }
      },
      {
        name: 'Apex DNS record',
        type: 'dns',
        interval: 300,
        degraded: 300,
        config: { domain: 'example.com', recordType: 'A', resolver: '1.1.1.1' }
      },
      {
        name: 'Edge reachability',
        type: 'ping',
        interval: 60,
        degraded: 120,
        config: { host: '1.1.1.1', packets: 4, maxPacketLossPercent: 20, fallbackPort: 443 }
      }
    ];

    const ids: Record<string, string> = {};
    for (const m of monitors) {
      const row = (
        await client.query(
          `INSERT INTO monitors (org_id, name, type, interval_seconds, degraded_latency_ms, config, status, next_run_at)
           VALUES ($1,$2,$3,$4,$5,$6,'pending', now()) RETURNING id`,
          [org.id, m.name, m.type, m.interval, m.degraded, m.config]
        )
      ).rows[0];
      ids[m.name] = row.id;
    }

    const channel = (
      await client.query(
        `INSERT INTO notification_channels (org_id, type, name, config, enabled)
         VALUES ($1,'webhook','Ops webhook','{"url":"https://example.com/hooks/pulsewatch"}'::jsonb, false)
         RETURNING id`,
        [org.id]
      )
    ).rows[0];
    await client.query(
      `INSERT INTO alert_rules (org_id, name, event_types, channel_id, cooldown_seconds)
       VALUES ($1,'Page on outage', ARRAY['monitor.down','monitor.recovered','ssl.expiring','agent.disconnected'], $2, 900)`,
      [org.id, channel.id]
    );

    const page = (
      await client.query(
        `INSERT INTO status_pages (org_id, slug, title, description, branding)
         VALUES ($1,'demo','Demo Infrastructure','Live availability for our public services',
                 '{"accent":"#4fb6a8","footer":"Updated automatically every minute"}'::jsonb)
         RETURNING id`,
        [org.id]
      )
    ).rows[0];
    for (const [index, name] of ['Marketing site', 'Public API', 'Apex DNS record'].entries()) {
      await client.query(
        `INSERT INTO status_page_monitors (status_page_id, monitor_id, group_name, sort_order)
         VALUES ($1,$2,'Core services',$3)`,
        [page.id, ids[name], index]
      );
    }

    const { token, prefix, hash } = issueToken('agent');
    await client.query(
      `INSERT INTO server_agents (org_id, name, hostname, token_prefix, token_hash, status)
       VALUES ($1,'web-01','web-01.demo.internal',$2,$3,'pending')`,
      [org.id, prefix, hash]
    );

    return { orgId: org.id as string, monitorIds: ids, agentToken: token };
  });

  // Synthetic history: 48 h of checks at 5-minute spacing, with one 22-minute outage.
  const outageStart = Date.now() - 9 * 3600 * 1000;
  const outageEnd = outageStart + 22 * 60 * 1000;
  for (const [name, monitorId] of Object.entries(monitorIds)) {
    const base = { 'Marketing site': 160, 'Public API': 240, 'Edge TLS endpoint': 40, 'Apex DNS record': 28, 'Edge reachability': 14 }[name] ?? 120;
    const rows: unknown[][] = [];
    for (let i = 576; i >= 0; i--) {
      const at = new Date(Date.now() - i * 5 * 60 * 1000);
      const failing = name === 'Public API' && at.getTime() >= outageStart && at.getTime() <= outageEnd;
      const jitter = Math.sin(i / 9) * base * 0.18 + (Math.random() - 0.5) * base * 0.25;
      const latency = Math.max(4, Math.round(base + jitter));
      const dns = Math.round(latency * 0.09);
      const tcp = Math.round(latency * 0.16);
      const tls = Math.round(latency * 0.2);
      const ttfb = Math.round(latency * 0.48);
      rows.push([
        monitorId, orgId, at, !failing, !failing && latency > base * 1.6,
        failing ? null : 200, failing ? 0 : latency,
        JSON.stringify({ dns, tcp, tls, ttfb, download: Math.max(0, latency - dns - tcp - tls - ttfb), total: latency }),
        failing ? 'ETIMEDOUT: Request exceeded the 10000 ms timeout' : null
      ]);
    }
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const values = chunk
        .map((_, r) => `($${r * 9 + 1},$${r * 9 + 2},$${r * 9 + 3},$${r * 9 + 4},$${r * 9 + 5},$${r * 9 + 6},$${r * 9 + 7},$${r * 9 + 8},$${r * 9 + 9})`)
        .join(',');
      await query(
        `INSERT INTO monitor_checks (monitor_id, org_id, created_at, ok, degraded, status_code, latency_ms, timings, error)
         VALUES ${values}`,
        chunk.flat()
      );
    }
    await query(
      `UPDATE monitors SET status = 'up', last_check_at = now(), last_success_at = now(), last_latency_ms = $2 WHERE id = $1`,
      [monitorId, base]
    );
  }

  const incident = await one<{ id: number }>(
    `INSERT INTO incidents (org_id, monitor_id, status, severity, started_at, resolved_at, duration_seconds,
                            detected_after_failures, cause, last_success_latency_ms)
     VALUES ($1,$2,'resolved','down', to_timestamp($3/1000.0), to_timestamp($4/1000.0), $5, 3,
             'Connection timeout', 240) RETURNING id`,
    [orgId, monitorIds['Public API'], outageStart, outageEnd, Math.round((outageEnd - outageStart) / 1000)]
  );
  await query(
    `INSERT INTO incident_events (incident_id, at, kind, message) VALUES
       ($1, to_timestamp($2/1000.0), 'opened', 'Declared down after 3 consecutive failed checks'),
       ($1, to_timestamp($3/1000.0), 'resolved', 'Recovered after 2 consecutive successful checks')`,
    [incident!.id, outageStart, outageEnd]
  );

  await rollupChecks();

  log.info('seed complete');
  console.log(`\nSign in with ${config.SEED_EMAIL} / ${config.SEED_PASSWORD}`);
  console.log(`Public status page: /status/demo`);
  console.log(`Agent token for web-01: ${agentToken}\n`);
}

seed()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    log.error('seed failed', { err: String(err), stack: (err as Error).stack });
    process.exit(1);
  });
