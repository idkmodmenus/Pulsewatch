import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Check, type Monitor } from '../lib/api';
import { clock, duration, ms, percent, since } from '../lib/format';
import { useStream } from '../lib/useStream';
import { Empty, Panel, Stat, StatusPill, TimingBar } from '../components/ui';
import { LatencyChart, PhaseChart } from '../components/charts';
import { canAtLeast, useSession } from '../lib/session';

type Detail = {
  monitor: Monitor;
  uptime: { day: string; week: string; month: string };
  latency: { avg_ms: string; p50_ms: string; p95_ms: string; p99_ms: string };
  addresses: { ip: string; family: number; first_seen: string; last_seen: string }[];
  incidents: any[];
  checks: Check[];
};

const WINDOWS = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' }
];

export default function MonitorDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);
  const [series, setSeries] = useState<any[]>([]);
  const [window, setWindow] = useState('24h');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const { principal } = useSession();
  const navigate = useNavigate();

  const load = () => id && api.get<Detail>(`/monitors/${id}`).then(setData);
  useEffect(() => {
    void load();
  }, [id]);
  useEffect(() => {
    if (!id) return;
    api.get<{ series: any[] }>(`/monitors/${id}/latency?window=${window}`).then((r) => setSeries(r.series));
  }, [id, window]);
  useStream(
    (evt) => {
      if ((evt.data as any).monitorId === id) void load();
    },
    ['monitor.status', 'check.completed', 'incident.opened', 'incident.resolved']
  );

  if (!data) return <div className="text-sm text-muted">Loading…</div>;
  const { monitor, uptime, latency, addresses, incidents, checks } = data;
  const canEdit = canAtLeast(principal?.role, 'member');

  const runNow = async () => {
    setRunning(true);
    await api.post(`/monitors/${id}/run`);
    setTimeout(() => { void load(); setRunning(false); }, 2500);
  };

  const remove = async () => {
    if (!confirm(`Delete "${monitor.name}"? This removes all its history.`)) return;
    await api.del(`/monitors/${id}`);
    navigate('/monitors');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg text-ink">{monitor.name}</h1>
            <StatusPill status={monitor.status} />
          </div>
          <p className="text-sm text-muted">
            {monitor.type.toUpperCase()} · every {monitor.interval_seconds}s · last check {since(monitor.last_check_at)}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={runNow} disabled={running}>{running ? 'Running…' : 'Run now'}</button>
            <button className="btn-ghost text-down" onClick={remove}>Delete</button>
          </div>
        )}
      </div>

      {monitor.status === 'down' && monitor.last_error && (
        <div className="rounded border border-down/40 bg-down/10 px-4 py-3 text-sm text-down">
          {monitor.last_error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="24h uptime" value={percent(uptime.day, 2)} tone="text-up" />
        <Stat label="7d uptime" value={percent(uptime.week, 2)} />
        <Stat label="30d uptime" value={percent(uptime.month, 2)} />
        <Stat label="p50" value={ms(Number(latency.p50_ms))} />
        <Stat label="p95" value={ms(Number(latency.p95_ms))} />
        <Stat label="p99" value={ms(Number(latency.p99_ms))} />
      </div>

      <Panel
        title="Response time"
        action={
          <div className="flex gap-1 text-xs">
            {WINDOWS.map((w) => (
              <button
                key={w.value}
                onClick={() => setWindow(w.value)}
                className={`rounded px-2 py-1 ${window === w.value ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
              >
                {w.label}
              </button>
            ))}
          </div>
        }
      >
        {series.length ? <LatencyChart data={series} /> : <Empty title="No data in this window" hint="Try a wider time range." />}
      </Panel>

      {monitor.type === 'http' || monitor.type === 'api' ? (
        <Panel title="Connection timing breakdown">
          {series.length ? <PhaseChart data={series} /> : <Empty title="No data yet" hint="Timing breakdown appears after the first successful check." />}
        </Panel>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="DNS / IP information">
          {addresses.length ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-normal">Address</th>
                  <th className="pb-2 font-normal">Family</th>
                  <th className="pb-2 font-normal">First seen</th>
                  <th className="pb-2 font-normal">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {addresses.map((a) => (
                  <tr key={a.ip} className="border-t border-line">
                    <td className="metric py-2">{a.ip}</td>
                    <td className="py-2 text-muted">IPv{a.family}</td>
                    <td className="py-2 text-muted">{since(a.first_seen)}</td>
                    <td className="py-2 text-muted">{since(a.last_seen)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty title="No addresses recorded yet" hint="Resolved IPs appear after the first successful check." />
          )}
          {monitor.ssl_expires_at && (
            <div className="mt-3 border-t border-line pt-3 text-sm">
              <span className="text-muted">TLS certificate expires </span>
              <span className="text-ink">{clock(monitor.ssl_expires_at)}</span>
            </div>
          )}
        </Panel>

        <Panel title="Incident history">
          {incidents.length ? (
            <ul className="divide-y divide-line">
              {incidents.map((incident) => (
                <li key={incident.id} className="py-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className={incident.status === 'resolved' ? 'text-muted' : 'text-down'}>
                      #{incident.id} · {incident.status}
                    </span>
                    <span className="text-xs text-muted">{clock(incident.started_at)}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {incident.cause} — {incident.status === 'resolved' ? `lasted ${duration(incident.duration_seconds)}` : 'ongoing'}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No incidents" hint="This monitor has never gone down." />
          )}
        </Panel>
      </div>

      <Panel title="Recent checks">
        {checks.length ? (
          <div className="divide-y divide-line">
            {checks.map((c) => (
              <div key={c.id}>
                <button
                  className="flex w-full items-center justify-between py-2 text-left text-sm hover:bg-raised/30"
                  onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                >
                  <span className="flex items-center gap-3">
                    <span className={`h-1.5 w-1.5 rounded-full ${c.ok ? (c.degraded ? 'bg-degraded' : 'bg-up') : 'bg-down'}`} />
                    <span className="text-muted">{clock(c.created_at)}</span>
                    {c.status_code && <span className="metric text-ink">{c.status_code}</span>}
                  </span>
                  <span className="metric text-muted">{ms(c.latency_ms)}</span>
                </button>
                {expanded === c.id && (
                  <div className="space-y-3 pb-4 pl-4">
                    {c.error && <p className="text-sm text-down">{c.error}</p>}
                    {c.resolved_ip && <p className="text-xs text-muted">Resolved to {c.resolved_ip}</p>}
                    {(monitor.type === 'http' || monitor.type === 'api') && <TimingBar timings={c.timings} />}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No checks recorded yet" hint="Results will appear here once the schedule runs." />
        )}
      </Panel>

      <div className="text-right">
        <Link to="/monitors" className="text-xs text-muted hover:text-ink">← Back to monitors</Link>
      </div>
    </div>
  );
}
