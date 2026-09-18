/**
 * PulseWatch — api.js
 * Centralized API client. All fetch() calls go through here.
 * Base URL is read from window.PW_API_BASE (set per-environment) or defaults to /api.
 */

'use strict';

// ─── Configuration ────────────────────────────────────────────────────────────
// Override by setting window.PW_API_BASE before this script loads.
// e.g.  <script>window.PW_API_BASE = 'http://localhost:4000/api';</script>
const BASE = () => (window.PW_API_BASE ?? '/api').replace(/\/$/, '');

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES        = 2;
const RETRY_DELAY_MS     = 1_000;

// ─── Error type ───────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name    = 'ApiError';
    this.status  = status;
    this.code    = code;
    this.details = details ?? [];
  }
  get isUnauthorized() { return this.status === 401; }
  get isForbidden()    { return this.status === 403; }
  get isNotFound()     { return this.status === 404; }
  get isRateLimit()    { return this.status === 429; }
}

// ─── Core request ─────────────────────────────────────────────────────────────
async function request(method, path, body, options = {}) {
  const url     = BASE() + path;
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? MAX_RETRIES;

  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

  let attempt = 0;
  while (true) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        method,
        credentials: 'include',           // send session cookie
        headers,
        body:  body != null ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);

      // 204 No Content
      if (res.status === 204) return null;

      let data;
      const ct = res.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        data = await res.json();
      } else {
        data = { message: await res.text() };
      }

      if (!res.ok) {
        throw new ApiError(res.status, data?.error ?? 'error', data?.message ?? 'Request failed', data?.details);
      }
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof ApiError) throw err;

      const isAbort   = err.name === 'AbortError';
      const isNetwork = err instanceof TypeError;
      if ((isAbort || isNetwork) && attempt <= retries) {
        await sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      if (isAbort) throw new ApiError(0, 'timeout', 'Request timed out after ' + timeout + 'ms');
      throw new ApiError(0, 'network_error', err.message ?? 'Network error');
    }
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const get    = (path, opts)       => request('GET',    path, undefined, opts);
const post   = (path, body, opts) => request('POST',   path, body, opts);
const patch  = (path, body, opts) => request('PATCH',  path, body, opts);
const put    = (path, body, opts) => request('PUT',    path, body, opts);
const del    = (path, opts)       => request('DELETE', path, undefined, opts);

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const Auth = {
  me:              ()           => get('/auth/me'),
  login:           (email, pw)  => post('/auth/login',           { email, password: pw }),
  register:        (email, pw, name, org) => post('/auth/register', { email, password: pw, name, organization: org }),
  logout:          ()           => post('/auth/logout'),
  requestReset:    (email)      => post('/auth/password-reset/request', { email }),
  confirmReset:    (token, pw)  => post('/auth/password-reset/confirm', { token, password: pw }),
  verifyEmail:     (token)      => post('/auth/verify-email', { token }),
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
export const Dashboard = {
  get: () => get('/dashboard'),
};

// ─── Monitors ─────────────────────────────────────────────────────────────────
export const Monitors = {
  list:     ()           => get('/monitors'),
  get:      (id)         => get(`/monitors/${id}`),
  create:   (data)       => post('/monitors', data),
  update:   (id, data)   => patch(`/monitors/${id}`, data),
  delete:   (id)         => del(`/monitors/${id}`),
  run:      (id)         => post(`/monitors/${id}/run`),

  checks:   (id, params = {}) => {
    const qs = new URLSearchParams();
    if (params.limit)        qs.set('limit', params.limit);
    if (params.before)       qs.set('before', params.before);
    if (params.onlyFailures) qs.set('onlyFailures', 'true');
    const q = qs.toString();
    return get(`/monitors/${id}/checks${q ? '?' + q : ''}`);
  },

  latency:  (id, window = '24h') => get(`/monitors/${id}/latency?window=${window}`),
  incidents:(id)         => get(`/monitors/${id}/incidents`),
};

// ─── Servers / Agents ─────────────────────────────────────────────────────────
export const Servers = {
  list:     ()              => get('/servers'),
  get:      (id, window)    => get(`/servers/${id}${window ? '?window=' + window : ''}`),
  create:   (data)          => post('/servers', data),
  delete:   (id)            => del(`/servers/${id}`),
};

// ─── Incidents ────────────────────────────────────────────────────────────────
export const Incidents = {
  list:        (params = {}) => {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.limit)  qs.set('limit', params.limit);
    const q = qs.toString();
    return get(`/incidents${q ? '?' + q : ''}`);
  },
  get:         (id)  => get(`/incidents/${id}`),
  acknowledge: (id, note) => post(`/incidents/${id}/acknowledge`, { note }),
  comment:     (id, message) => post(`/incidents/${id}/comment`, { message }),
};

// ─── Notification Channels ────────────────────────────────────────────────────
export const Notifications = {
  listChannels:   ()            => get('/notification-channels'),
  createChannel:  (data)        => post('/notification-channels', data),
  deleteChannel:  (id)          => del(`/notification-channels/${id}`),
  testChannel:    (id)          => post(`/notification-channels/${id}/test`),

  listRules:      ()            => get('/alert-rules'),
  createRule:     (data)        => post('/alert-rules', data),
  deleteRule:     (id)          => del(`/alert-rules/${id}`),

  listDeliveries: ()            => get('/alert-deliveries'),
};

// ─── Maintenance Windows ──────────────────────────────────────────────────────
export const Maintenance = {
  list:   ()     => get('/maintenance-windows'),
  create: (data) => post('/maintenance-windows', data),
  delete: (id)   => del(`/maintenance-windows/${id}`),
};

// ─── Status Pages ─────────────────────────────────────────────────────────────
export const StatusPages = {
  list:       ()           => get('/status-pages'),
  get:        (id)         => get(`/status-pages/${id}`),
  create:     (data)       => post('/status-pages', data),
  update:     (id, data)   => patch(`/status-pages/${id}`, data),
  delete:     (id)         => del(`/status-pages/${id}`),
  getPublic:  (slug)       => get(`/public/status-pages/${slug}`),
};

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const ApiKeys = {
  list:   ()     => get('/api-keys'),
  create: (data) => post('/api-keys', data),
  revoke: (id)   => del(`/api-keys/${id}`),
};

// ─── System ───────────────────────────────────────────────────────────────────
export const System = {
  health: () => get('/health', { retries: 0, timeout: 5_000 }),
};
