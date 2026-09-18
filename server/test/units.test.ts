import './env.js';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { evaluateAssertion, readJsonPath, statusMatches } from '../src/checks/assertions.js';
import { isOpen, recordOutcome, resetBreakers } from '../src/engine/circuitBreaker.js';
import { hashPassword, issueToken, safeEqualHex, sha256, verifyPassword } from '../src/lib/crypto.js';
import { formatDuration } from '../src/engine/results.js';

describe('status code matching', () => {
  test('literals, wildcards and ranges', () => {
    assert.equal(statusMatches(200, [200]), true);
    assert.equal(statusMatches(204, ['2xx']), true);
    assert.equal(statusMatches(301, ['2xx']), false);
    assert.equal(statusMatches(418, ['400-499']), true);
    assert.equal(statusMatches(500, ['400-499', '2xx']), false);
  });
});

describe('json path assertions', () => {
  const body = { a: { b: [{ c: 7 }] }, name: 'pulse', list: [1, 2, 3] };
  test('reads nested values', () => {
    assert.equal(readJsonPath(body, '$.a.b[0].c'), 7);
    assert.equal(readJsonPath(body, 'name'), 'pulse');
    assert.equal(readJsonPath(body, '$.missing.deep'), undefined);
  });
  test('operators behave', () => {
    assert.equal(evaluateAssertion(body, { path: '$.a.b[0].c', operator: 'eq', value: 7 }), null);
    assert.notEqual(evaluateAssertion(body, { path: '$.a.b[0].c', operator: 'gt', value: 10 }), null);
    assert.equal(evaluateAssertion(body, { path: '$.list', operator: 'contains', value: 2 }), null);
    assert.equal(evaluateAssertion(body, { path: '$.nope', operator: 'absent' }), null);
    assert.notEqual(evaluateAssertion(body, { path: '$.nope', operator: 'exists' }), null);
  });
});

describe('circuit breaker', () => {
  test('opens after the threshold and half-opens after the reset window', () => {
    resetBreakers();
    const cfg = { threshold: 3, resetMs: 1000 };
    const now = 1_000_000;
    for (let i = 0; i < 2; i++) recordOutcome('target', false, cfg, now);
    assert.equal(isOpen('target', cfg, now), false);
    recordOutcome('target', false, cfg, now);
    assert.equal(isOpen('target', cfg, now), true);
    assert.equal(isOpen('target', cfg, now + 999), true);
    assert.equal(isOpen('target', cfg, now + 1001), false, 'half-open probe allowed');
  });

  test('a success closes it immediately', () => {
    resetBreakers();
    const cfg = { threshold: 2, resetMs: 1000 };
    recordOutcome('t2', false, cfg);
    recordOutcome('t2', false, cfg);
    assert.equal(isOpen('t2', cfg), true);
    recordOutcome('t2', true, cfg);
    assert.equal(isOpen('t2', cfg), false);
  });
});

describe('credentials', () => {
  test('password hashes verify and reject', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(await verifyPassword('correct horse battery staple', hash), true);
    assert.equal(await verifyPassword('wrong password entirely', hash), false);
    assert.match(hash, /^scrypt\$[0-9a-f]+\$[0-9a-f]+$/);
  });

  test('two hashes of the same password differ', async () => {
    assert.notEqual(await hashPassword('same input'), await hashPassword('same input'));
  });

  test('issued tokens carry a lookup prefix and verify by hash', () => {
    const { token, prefix, hash } = issueToken('pw');
    assert.ok(token.startsWith(`${prefix}.`));
    assert.equal(hash, sha256(token));
    assert.equal(safeEqualHex(hash, sha256(token)), true);
    assert.equal(safeEqualHex(hash, sha256(`${token}x`)), false);
  });
});

describe('formatting', () => {
  test('durations read naturally', () => {
    assert.equal(formatDuration(45), '45s');
    assert.equal(formatDuration(261), '4m 21s');
    assert.equal(formatDuration(3_725), '1h 2m 5s');
  });
});
