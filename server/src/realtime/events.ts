import { redisPub, redisSub } from '../lib/redis.js';
import { log } from '../lib/logger.js';

export type RealtimeEvent = {
  type:
    | 'check.completed'
    | 'monitor.status'
    | 'incident.opened'
    | 'incident.resolved'
    | 'agent.telemetry'
    | 'agent.offline';
  orgId: string;
  at: string;
  data: Record<string, unknown>;
};

const CHANNEL = 'pulsewatch:events';
type Listener = (event: RealtimeEvent) => void;
const listeners = new Set<Listener>();
let subscribed = false;

export async function publishEvent(event: Omit<RealtimeEvent, 'at'>): Promise<void> {
  const payload: RealtimeEvent = { ...event, at: new Date().toISOString() };
  try {
    await redisPub.publish(CHANNEL, JSON.stringify(payload));
  } catch (err) {
    log.warn('event publish failed', { err: String(err) });
  }
}

export async function subscribeEvents(listener: Listener): Promise<() => void> {
  listeners.add(listener);
  if (!subscribed) {
    subscribed = true;
    await redisSub.subscribe(CHANNEL);
    redisSub.on('message', (_channel, message) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(message) as RealtimeEvent;
      } catch {
        return;
      }
      for (const l of listeners) {
        try {
          l(event);
        } catch (err) {
          log.warn('event listener threw', { err: String(err) });
        }
      }
    });
  }
  return () => listeners.delete(listener);
}
