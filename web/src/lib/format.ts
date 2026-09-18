export const ms = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;

export const percent = (value: number | string | null | undefined, digits = 2): string =>
  value === null || value === undefined ? '—' : `${Number(value).toFixed(digits)}%`;

export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${Math.round(seconds % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function since(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const delta = (Date.now() - new Date(iso).getTime()) / 1000;
  if (delta < 5) return 'just now';
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86_400)}d ago`;
}

export const clock = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }) : '—';

export const shortTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export const bytes = (value: number | null | undefined): string => {
  if (!value) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
};

export const statusLabel: Record<string, string> = {
  up: 'Operational',
  degraded: 'Degraded',
  down: 'Down',
  pending: 'Waiting for first check',
  paused: 'Paused'
};

export const statusColor: Record<string, string> = {
  up: 'text-up',
  degraded: 'text-degraded',
  down: 'text-down',
  pending: 'text-muted',
  paused: 'text-muted'
};

export const statusBg: Record<string, string> = {
  up: 'bg-up',
  degraded: 'bg-degraded',
  down: 'bg-down',
  pending: 'bg-muted',
  paused: 'bg-muted'
};
