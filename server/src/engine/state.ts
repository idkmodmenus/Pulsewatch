/**
 * Monitor state machine. Pure and side-effect free so the thresholds can be tested directly.
 *
 * A monitor is declared DOWN only after `failureThreshold` consecutive failures, and RECOVERED
 * only after `recoveryThreshold` consecutive successes, which is what keeps a single dropped
 * packet or a one-off 502 from paging anybody.
 */
export type MonitorStatus = 'pending' | 'up' | 'degraded' | 'down' | 'paused';

export type StateInput = {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  failureThreshold: number;
  recoveryThreshold: number;
};

export type Transition = 'none' | 'went_down' | 'recovered' | 'degraded' | 'undegraded';

export type StateOutput = {
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  transition: Transition;
};

export function nextState(state: StateInput, result: { ok: boolean; degraded?: boolean }): StateOutput {
  if (state.status === 'paused') {
    return {
      status: 'paused',
      consecutiveFailures: state.consecutiveFailures,
      consecutiveSuccesses: state.consecutiveSuccesses,
      transition: 'none'
    };
  }

  if (!result.ok) {
    const consecutiveFailures = state.consecutiveFailures + 1;
    const reached = consecutiveFailures >= state.failureThreshold;
    const status: MonitorStatus = reached ? 'down' : state.status === 'pending' ? 'pending' : state.status;
    return {
      status,
      consecutiveFailures,
      consecutiveSuccesses: 0,
      transition: reached && state.status !== 'down' ? 'went_down' : 'none'
    };
  }

  const consecutiveSuccesses = state.consecutiveSuccesses + 1;
  const target: MonitorStatus = result.degraded ? 'degraded' : 'up';

  if (state.status === 'down') {
    if (consecutiveSuccesses < state.recoveryThreshold) {
      return { status: 'down', consecutiveFailures: 0, consecutiveSuccesses, transition: 'none' };
    }
    return { status: target, consecutiveFailures: 0, consecutiveSuccesses, transition: 'recovered' };
  }

  let transition: Transition = 'none';
  if (state.status !== target) {
    if (target === 'degraded') transition = 'degraded';
    else if (state.status === 'degraded') transition = 'undegraded';
    else if (state.status === 'pending') transition = 'recovered';
  }
  return { status: target, consecutiveFailures: 0, consecutiveSuccesses, transition };
}

/** Uptime percentage from raw counts, rounded to three decimals. */
export function uptimePercent(checks: number, failures: number): number {
  if (checks <= 0) return 100;
  return Math.round(((checks - failures) / checks) * 100_000) / 1000;
}
