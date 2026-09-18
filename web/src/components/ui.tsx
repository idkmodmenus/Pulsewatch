import type { ReactNode } from 'react';
import { statusBg, statusColor, statusLabel } from '../lib/format';

export function StatusDot({ status, size = 8 }: { status: string; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full ${statusBg[status] ?? 'bg-muted'}`}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${statusColor[status] ?? 'text-muted'}`}>
      <StatusDot status={status} />
      {statusLabel[status] ?? status}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
  className = ''
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`surface ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          {title && <h2 className="text-sm font-medium text-ink">{title}</h2>}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="surface px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`metric mt-1 text-2xl ${tone ?? 'text-ink'}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Compact latency sparkline. Failures are drawn as ticks along the baseline. */
export function Sparkline({
  points,
  width = 120,
  height = 28
}: {
  points: { ms: number; ok: boolean }[];
  width?: number;
  height?: number;
}) {
  if (!points.length) return <span className="text-xs text-muted">no data</span>;
  const values = points.map((p) => p.ms ?? 0);
  const max = Math.max(...values, 1);
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((p.ms ?? 0) / max) * (height - 4) - 2).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={width} height={height} role="img" aria-label="Recent response times">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.25" className="text-signal/80" />
      {points.map((p, i) =>
        p.ok ? null : <rect key={i} x={i * step - 1} y={height - 3} width="2" height="3" className="fill-down" />
      )}
    </svg>
  );
}

/** Stacked bar of the connection phases for one HTTP check. */
export function TimingBar({ timings }: { timings: Record<string, number | undefined> | null }) {
  if (!timings) return <span className="text-muted">—</span>;
  const phases = [
    { key: 'dns', label: 'DNS', color: 'bg-signal/70' },
    { key: 'tcp', label: 'TCP', color: 'bg-up/70' },
    { key: 'tls', label: 'TLS', color: 'bg-degraded/70' },
    { key: 'ttfb', label: 'Waiting', color: 'bg-signal/40' },
    { key: 'download', label: 'Download', color: 'bg-muted/50' }
  ];
  const total = timings.total || phases.reduce((sum, p) => sum + (timings[p.key] ?? 0), 0) || 1;
  return (
    <div className="space-y-2">
      <div className="flex h-2 w-full overflow-hidden rounded bg-raised">
        {phases.map((p) => (
          <div
            key={p.key}
            className={p.color}
            style={{ width: `${Math.max(0, ((timings[p.key] ?? 0) / total) * 100)}%` }}
            title={`${p.label} ${timings[p.key] ?? 0} ms`}
          />
        ))}
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
        {phases.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3">
            <dt className="text-muted">{p.label}</dt>
            <dd className="metric">{timings[p.key] === undefined ? '—' : `${Math.round(timings[p.key]!)} ms`}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-1 sm:border-0 sm:pt-0">
          <dt className="text-ink">Total</dt>
          <dd className="metric text-ink">{Math.round(total)} ms</dd>
        </div>
      </dl>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
      <p className="text-ink">{title}</p>
      <p className="max-w-sm text-sm text-muted">{hint}</p>
      {action}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded border border-down/40 bg-down/10 px-3 py-2 text-sm text-down" role="alert">
      {message}
    </div>
  );
}
