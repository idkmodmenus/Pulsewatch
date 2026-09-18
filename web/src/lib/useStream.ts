import { useEffect, useRef } from 'react';

type StreamEvent = { type: string; orgId: string; at: string; data: Record<string, unknown> };

/**
 * Subscribes to the server-sent event stream. The browser reconnects on its own; this hook only
 * has to keep the latest callback and tear the connection down on unmount.
 */
export function useStream(onEvent: (event: StreamEvent) => void, events: string[]) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const source = new EventSource('/api/stream', { withCredentials: true });
    const listeners = events.map((name) => {
      const listener = (message: MessageEvent) => {
        try {
          handler.current({ type: name, ...JSON.parse(message.data) });
        } catch {
          /* ignore malformed frames */
        }
      };
      source.addEventListener(name, listener);
      return [name, listener] as const;
    });
    return () => {
      for (const [name, listener] of listeners) source.removeEventListener(name, listener);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events.join(',')]);
}
