import './env.js';
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { nextState, uptimePercent, type StateInput } from '../src/engine/state.js';

const base: StateInput = {
  status: 'up',
  consecutiveFailures: 0,
  consecutiveSuccesses: 5,
  failureThreshold: 3,
  recoveryThreshold: 2
};

describe('failure threshold', () => {
  test('stays up until the threshold is reached', () => {
    let state = { ...base };
    for (let i = 1; i <= 2; i++) {
      const out = nextState(state, { ok: false });
      assert.equal(out.status, 'up');
      assert.equal(out.transition, 'none');
      assert.equal(out.consecutiveFailures, i);
      state = { ...state, ...out };
    }
    const third = nextState(state, { ok: false });
    assert.equal(third.status, 'down');
    assert.equal(third.transition, 'went_down');
    assert.equal(third.consecutiveFailures, 3);
  });

  test('a single success resets the failure streak', () => {
    const after = nextState({ ...base, consecutiveFailures: 2 }, { ok: true });
    assert.equal(after.consecutiveFailures, 0);
    assert.equal(after.status, 'up');
  });

  test('going down twice only transitions once', () => {
    const state = { ...base, status: 'down' as const, consecutiveFailures: 3 };
    assert.equal(nextState(state, { ok: false }).transition, 'none');
  });
});

describe('recovery threshold', () => {
  test('stays down until enough successes accumulate', () => {
    let state: StateInput = { ...base, status: 'down', consecutiveFailures: 4, consecutiveSuccesses: 0 };
    const first = nextState(state, { ok: true });
    assert.equal(first.status, 'down');
    assert.equal(first.transition, 'none');
    state = { ...state, ...first };
    const second = nextState(state, { ok: true });
    assert.equal(second.status, 'up');
    assert.equal(second.transition, 'recovered');
  });

  test('a failure during recovery restarts the count', () => {
    const state: StateInput = { ...base, status: 'down', consecutiveSuccesses: 1, consecutiveFailures: 0 };
    const out = nextState(state, { ok: false });
    assert.equal(out.consecutiveSuccesses, 0);
    assert.equal(out.status, 'down');
  });

  test('recovering into a slow response lands on degraded', () => {
    const state: StateInput = { ...base, status: 'down', consecutiveSuccesses: 1, recoveryThreshold: 2 };
    const out = nextState(state, { ok: true, degraded: true });
    assert.equal(out.status, 'degraded');
    assert.equal(out.transition, 'recovered');
  });
});

describe('degradation and pausing', () => {
  test('up to degraded and back', () => {
    const down = nextState(base, { ok: true, degraded: true });
    assert.equal(down.status, 'degraded');
    assert.equal(down.transition, 'degraded');
    const back = nextState({ ...base, status: 'degraded' }, { ok: true });
    assert.equal(back.status, 'up');
    assert.equal(back.transition, 'undegraded');
  });

  test('a paused monitor never changes state', () => {
    const out = nextState({ ...base, status: 'paused' }, { ok: false });
    assert.equal(out.status, 'paused');
    assert.equal(out.transition, 'none');
  });

  test('a brand new monitor reports up on the first success', () => {
    const out = nextState({ ...base, status: 'pending', consecutiveSuccesses: 0 }, { ok: true });
    assert.equal(out.status, 'up');
    assert.equal(out.transition, 'recovered');
  });
});

describe('uptime maths', () => {
  test('counts failures against the total', () => {
    assert.equal(uptimePercent(1000, 1), 99.9);
    assert.equal(uptimePercent(0, 0), 100);
    assert.equal(uptimePercent(4, 4), 0);
  });
});
