import './env.js';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { blockReason, isBlockedIp, parseHttpUrl, resolveTarget, TargetBlockedError } from '../src/checks/ssrf.js';

describe('private and special-purpose address blocking', () => {
  const blocked = [
    '127.0.0.1', '127.9.9.9', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.100.100.200', '0.0.0.0', '224.0.0.1', '240.0.0.1',
    '::1', 'fd00::1', 'fe80::1', 'fc00:ec2::254', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
    '64:ff9b::a00:1'
  ];
  for (const ip of blocked) {
    test(`blocks ${ip}`, () => {
      assert.equal(isBlockedIp(ip), true, `${ip} should be blocked: ${blockReason(ip)}`);
    });
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '2606:4700::1111'];
  for (const ip of allowed) {
    test(`allows ${ip}`, () => {
      assert.equal(isBlockedIp(ip), false, `${ip} should be allowed but got: ${blockReason(ip)}`);
    });
  }

  test('rejects malformed addresses', () => {
    assert.notEqual(blockReason('999.1.1.1'), null);
    assert.notEqual(blockReason('not-an-ip'), null);
  });
});

describe('URL validation', () => {
  test('rejects non-http protocols', () => {
    assert.throws(() => parseHttpUrl('file:///etc/passwd'), TargetBlockedError);
    assert.throws(() => parseHttpUrl('gopher://example.com'), TargetBlockedError);
  });
  test('rejects embedded credentials', () => {
    assert.throws(() => parseHttpUrl('https://user:pass@example.com'), TargetBlockedError);
  });
  test('rejects internal hostnames', () => {
    assert.throws(() => parseHttpUrl('http://localhost:8080/admin'), TargetBlockedError);
    assert.throws(() => parseHttpUrl('http://metadata.google.internal/'), TargetBlockedError);
  });
  test('accepts a normal https URL', () => {
    assert.equal(parseHttpUrl('https://example.com/health?x=1').hostname, 'example.com');
  });
});

describe('literal targets', () => {
  test('a loopback literal is refused before any socket is opened', async () => {
    await assert.rejects(() => resolveTarget('127.0.0.1'), TargetBlockedError);
  });
  test('a public literal resolves without DNS', async () => {
    const result = await resolveTarget('1.1.1.1');
    assert.deepEqual(result.addresses, [{ address: '1.1.1.1', family: 4 }]);
    assert.equal(result.dnsMs, 0);
  });
});
