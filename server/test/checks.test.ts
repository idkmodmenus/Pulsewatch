import './env-local-targets.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test, { after, before, describe } from 'node:test';
import { runHttpCheck, destroyAgents } from '../src/checks/http.js';
import { runTcpCheck } from '../src/checks/tcp.js';
import { runDnsCheck } from '../src/checks/dns.js';
import { clearDnsCache } from '../src/checks/ssrf.js';

let server: http.Server;
let base: string;
let requestCount = 0;

before(async () => {
  server = http.createServer((req, res) => {
    requestCount++;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/slow') {
      setTimeout(() => res.end('late'), 400);
      return;
    }
    if (url.pathname === '/boom') {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('service unavailable');
      return;
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { location: `${base}/ok` });
      res.end();
      return;
    }
    if (url.pathname === '/redirect-loopback') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
      return;
    }
    if (url.pathname === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', queue: { depth: 3 }, nodes: ['a', 'b'] }));
      return;
    }
    if (url.pathname === '/flaky') {
      if (requestCount % 2 === 1) return req.socket.destroy();
      res.end('recovered');
      return;
    }
    if (url.pathname === '/huge') {
      res.writeHead(200);
      res.end(Buffer.alloc(2 * 1024 * 1024, 'x'));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>all systems operational</body></html>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  clearDnsCache();
});

after(async () => {
  destroyAgents();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('HTTP monitoring', () => {
  test('a healthy endpoint reports up with a phase breakdown', async () => {
    const result = await runHttpCheck({ url: `${base}/ok` }, 5000);
    assert.equal(result.ok, true);
    assert.equal(result.statusCode, 200);
    assert.ok(result.timings);
    for (const phase of ['dns', 'tcp', 'tls', 'ttfb', 'download', 'total'] as const) {
      assert.equal(typeof result.timings![phase], 'number', `${phase} should be measured`);
      assert.ok(result.timings![phase]! >= 0);
    }
    assert.ok(result.timings!.total >= result.timings!.ttfb!);
    assert.equal(result.timings!.tls, 0, 'plain HTTP has no handshake');
  });

  test('an unexpected status fails the check', async () => {
    const result = await runHttpCheck({ url: `${base}/boom`, expectedStatus: ['2xx'] }, 5000);
    assert.equal(result.ok, false);
    assert.equal(result.statusCode, 503);
    assert.match(result.error ?? '', /503/);
  });

  test('a status code can be expected explicitly', async () => {
    const result = await runHttpCheck({ url: `${base}/boom`, expectedStatus: [503] }, 5000);
    assert.equal(result.ok, true);
  });

  test('keyword matching works in both directions', async () => {
    const present = await runHttpCheck({ url: `${base}/ok`, keyword: 'operational' }, 5000);
    assert.equal(present.ok, true);
    const missing = await runHttpCheck({ url: `${base}/ok`, keyword: 'catastrophe' }, 5000);
    assert.equal(missing.ok, false);
    const absent = await runHttpCheck({ url: `${base}/ok`, keyword: 'catastrophe', keywordMode: 'absent' }, 5000);
    assert.equal(absent.ok, true);
  });

  test('JSON assertions evaluate against the body', async () => {
    const result = await runHttpCheck(
      {
        url: `${base}/json`,
        assertions: [
          { path: '$.status', operator: 'eq', value: 'healthy' },
          { path: '$.queue.depth', operator: 'lt', value: 10 },
          { path: '$.nodes[1]', operator: 'eq', value: 'b' }
        ]
      },
      5000
    );
    assert.equal(result.ok, true);

    const failing = await runHttpCheck(
      { url: `${base}/json`, assertions: [{ path: '$.queue.depth', operator: 'lt', value: 1 }] },
      5000
    );
    assert.equal(failing.ok, false);
    assert.match(failing.error ?? '', /queue\.depth/);
  });

  test('redirects are followed and recorded', async () => {
    const result = await runHttpCheck({ url: `${base}/redirect` }, 5000);
    assert.equal(result.ok, true);
    assert.equal((result.meta?.redirects as string[]).length, 1);
  });

  test('a redirect into link-local space is refused', async () => {
    const result = await runHttpCheck({ url: `${base}/redirect-loopback` }, 5000);
    assert.equal(result.ok, false);
    assert.equal(result.meta?.blocked, true);
    assert.match(result.error ?? '', /169\.254\.169\.254/);
  });

  test('timeouts are reported rather than hanging', async () => {
    const result = await runHttpCheck({ url: `${base}/slow` }, 1200);
    assert.equal(result.ok, true); // 400ms response inside a 1.2s budget
    const tight = await runHttpCheck({ url: `${base}/slow`, connectTimeoutMs: 1000 }, 1000);
    assert.ok(tight.latencyMs <= 1500);
  });

  test('oversized bodies are truncated, not buffered whole', async () => {
    const result = await runHttpCheck({ url: `${base}/huge` }, 5000);
    assert.equal(result.meta?.truncated, true);
    assert.ok((result.meta?.contentLength as number) <= 512 * 1024);
  });

  test('a degraded threshold marks slow-but-working responses', async () => {
    const result = await runHttpCheck({ url: `${base}/slow`, degradedLatencyMs: 50 }, 3000);
    assert.equal(result.ok, true);
    assert.equal(result.degraded, true);
  });
});

describe('TCP monitoring', () => {
  test('an open port reports the connect latency', async () => {
    const port = (server.address() as net.AddressInfo).port;
    const result = await runTcpCheck({ host: '127.0.0.1', port }, 3000);
    assert.equal(result.ok, true);
    assert.equal(typeof result.timings?.tcp, 'number');
  });

  test('a closed port fails with the socket error code', async () => {
    const result = await runTcpCheck({ host: '127.0.0.1', port: 9 }, 2000);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /ECONNREFUSED|ETIMEDOUT|timed out/);
  });
});

describe('DNS monitoring', () => {
  test('a private resolver is refused', async () => {
    const result = await runDnsCheck({ domain: 'example.com', resolver: '127.0.0.53' }, 2000);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /Resolver rejected/);
  });

  test('a non-address resolver is refused', async () => {
    const result = await runDnsCheck({ domain: 'example.com', resolver: 'ns1.example.com' }, 2000);
    assert.equal(result.ok, false);
    assert.match(result.error ?? '', /must be an IP address/);
  });
});
