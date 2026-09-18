export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { field: string; message: string }[]) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    ...init
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body.message ?? 'The request failed.', body.details);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' })
};

export type MonitorStatus = 'up' | 'down' | 'degraded' | 'pending' | 'paused';

export type Monitor = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: MonitorStatus;
  interval_seconds: number;
  timeout_ms: number;
  failure_threshold: number;
  recovery_threshold: number;
  degraded_latency_ms: number | null;
  config: Record<string, any>;
  last_check_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_latency_ms: number | null;
  last_error: string | null;
  last_resolved_ip: string | null;
  ssl_expires_at: string | null;
  consecutive_failures: number;
  sparkline?: { t: string; ms: number; ok: boolean }[];
};

export type Check = {
  id: number;
  created_at: string;
  ok: boolean;
  degraded: boolean;
  status_code: number | null;
  latency_ms: number | null;
  timings: { dns?: number; tcp?: number; tls?: number; ttfb?: number; download?: number; total: number } | null;
  resolved_ip: string | null;
  error: string | null;
  meta: Record<string, any> | null;
};

export type Incident = {
  id: number;
  status: 'open' | 'acknowledged' | 'resolved';
  severity: string;
  started_at: string;
  resolved_at: string | null;
  duration_seconds: number | null;
  cause: string | null;
  detected_after_failures: number;
  monitor_id?: string;
  monitor_name?: string;
  monitor_type?: string;
};
