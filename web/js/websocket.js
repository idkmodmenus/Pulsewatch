/**
 * PulseWatch — websocket.js
 * Server-Sent Events client.
 * The backend uses SSE at GET /api/stream (not WebSockets).
 * Reconnects automatically with exponential back-off.
 * Emits typed events to registered handlers.
 */

'use strict';

const SSE_PATH = '/api/stream';

// ─── Connection states ────────────────────────────────────────────────────────
export const STATE = {
  CONNECTING: 'connecting',
  LIVE:       'live',
  OFFLINE:    'offline',
};

class PulseStream {
  constructor() {
    this._es          = null;
    this._state       = STATE.OFFLINE;
    this._handlers    = {};   // { eventType: Set<fn> }
    this._stateWatchers = new Set();
    this._retryCount  = 0;
    this._retryTimer  = null;
    this._maxRetries  = Infinity;  // keep trying forever while the page is open
    this._retryDelays = [1_000, 2_000, 5_000, 10_000, 30_000]; // back-off steps
    this._started     = false;
    this._lastEvent   = null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────
  start() {
    if (this._started) return;
    this._started = true;
    this._connect();
  }

  stop() {
    this._started = false;
    clearTimeout(this._retryTimer);
    this._closeEs();
    this._setState(STATE.OFFLINE);
  }

  on(eventType, handler) {
    if (!this._handlers[eventType]) this._handlers[eventType] = new Set();
    this._handlers[eventType].add(handler);
    return () => this._handlers[eventType]?.delete(handler);
  }

  onStateChange(fn) {
    this._stateWatchers.add(fn);
    fn(this._state);  // immediate
    return () => this._stateWatchers.delete(fn);
  }

  get state()     { return this._state; }
  get lastEvent() { return this._lastEvent; }

  // ─── Internal ─────────────────────────────────────────────────────────────
  _connect() {
    if (!this._started) return;
    this._setState(STATE.CONNECTING);
    this._closeEs();

    const base = (window.PW_API_BASE ?? '/api').replace(/\/$/, '');
    const url  = base.replace('/api', '') + SSE_PATH;

    try {
      const es = new EventSource(url, { withCredentials: true });
      this._es = es;

      es.addEventListener('ready', (e) => {
        this._retryCount = 0;
        this._setState(STATE.LIVE);
        this._dispatch('ready', this._parse(e.data));
      });

      // Known SSE event types from backend
      const knownTypes = [
        'check.completed', 'monitor.status', 'incident.opened',
        'incident.resolved', 'agent.telemetry', 'agent.offline',
      ];
      for (const type of knownTypes) {
        es.addEventListener(type, (e) => {
          this._lastEvent = new Date();
          const data = this._parse(e.data);
          this._dispatch(type, data);
          this._dispatch('*', { type, data });
        });
      }

      es.onerror = () => {
        this._closeEs();
        this._setState(STATE.OFFLINE);
        this._scheduleRetry();
      };
    } catch (err) {
      this._setState(STATE.OFFLINE);
      this._scheduleRetry();
    }
  }

  _closeEs() {
    if (this._es) {
      this._es.close();
      this._es = null;
    }
  }

  _setState(s) {
    if (this._state === s) return;
    this._state = s;
    for (const fn of this._stateWatchers) {
      try { fn(s); } catch {}
    }
  }

  _scheduleRetry() {
    if (!this._started) return;
    this._retryCount++;
    const delay = this._retryDelays[Math.min(this._retryCount - 1, this._retryDelays.length - 1)];
    this._retryTimer = setTimeout(() => this._connect(), delay);
  }

  _dispatch(type, data) {
    const handlers = this._handlers[type];
    if (!handlers) return;
    for (const fn of handlers) {
      try { fn(data); } catch (err) { console.warn('[PulseStream] handler error', err); }
    }
  }

  _parse(raw) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────
export const stream = new PulseStream();

// ─── Connection indicator helper ─────────────────────────────────────────────
// Updates any element with id="connection-indicator" automatically.
export function bindConnectionIndicator(elementOrId) {
  const getEl = () => typeof elementOrId === 'string'
    ? document.getElementById(elementOrId)
    : elementOrId;

  stream.onStateChange((state) => {
    const el = getEl();
    if (!el) return;
    const labels = {
      [STATE.CONNECTING]: { text: 'Connecting', cls: 'indicator--connecting' },
      [STATE.LIVE]:       { text: 'Live',        cls: 'indicator--live'       },
      [STATE.OFFLINE]:    { text: 'Offline',     cls: 'indicator--offline'    },
    };
    const cfg = labels[state] ?? labels[STATE.OFFLINE];
    el.className = `connection-indicator ${cfg.cls}`;
    el.setAttribute('aria-label', cfg.text);
    const dot  = el.querySelector('.indicator__dot');
    const text = el.querySelector('.indicator__text');
    if (dot)  dot.className  = 'indicator__dot';
    if (text) text.textContent = cfg.text;
  });
}

// ─── Polling fallback helper ─────────────────────────────────────────────────
// If SSE is unavailable, use this to poll at a given interval.
// Returns a stop function.
export function startPolling(fn, intervalMs = 30_000) {
  let timer;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try { await fn(); } catch {}
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };

  tick();
  return () => { stopped = true; clearTimeout(timer); };
}
