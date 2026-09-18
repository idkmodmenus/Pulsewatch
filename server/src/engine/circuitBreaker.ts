/**
 * Per-target circuit breaker for the *worker*: when a target has failed repeatedly we stop
 * paying the full timeout on every cycle and record a fast, explicit "circuit open" failure
 * instead. It protects our own worker pool; it never changes what the target sees beyond
 * fewer requests.
 */
type Breaker = { failures: number; openedAt: number | null };

const breakers = new Map<string, Breaker>();

export type BreakerConfig = { threshold: number; resetMs: number };

export function isOpen(key: string, cfg: BreakerConfig, now = Date.now()): boolean {
  const breaker = breakers.get(key);
  if (!breaker?.openedAt) return false;
  if (now - breaker.openedAt >= cfg.resetMs) {
    // Half-open: allow one probe through.
    breaker.openedAt = null;
    breaker.failures = cfg.threshold - 1;
    return false;
  }
  return true;
}

export function recordOutcome(key: string, ok: boolean, cfg: BreakerConfig, now = Date.now()): void {
  const breaker = breakers.get(key) ?? { failures: 0, openedAt: null };
  if (ok) {
    breakers.delete(key);
    return;
  }
  breaker.failures += 1;
  if (breaker.failures >= cfg.threshold) breaker.openedAt = now;
  breakers.set(key, breaker);
}

export function resetBreakers(): void {
  breakers.clear();
}
