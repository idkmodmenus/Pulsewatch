import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { duration, ms, percent, since } from '../lib/format';
import { useStream } from '../lib/useStream';
import { Empty, Panel, Stat, StatusPill } from '../components/ui';
import { LatencyChart } from '../components/charts';

type DashboardData = {
  summary: Record<string, number>;
  latency: { avg_ms: string; p50_ms: string; p95_ms: string; p99_ms: string; samples: number };
  uptime: { uptime: string; checks: number; failures: number };
  series: { bucket: string; avg_ms: string; p95_ms: string; failures: number }[];
  incidents: any[];
  lastChecks: { last_success: string | null; last_failure: string | null; last_check: string | null };
  agents: any[];
  slowest: any[];
};

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);

  const load = () => api.get<DashboardData>('/dashboard').then(setData);
  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  useStream(() => void load(), ['monitor.status', 'incident.opened', 'incident.resolved']);

  if (!data) return <div className="text-sm text-muted">Loading…</div>;
  const { summary, latency, uptime, series, incidents, lastChecks, agents, slowest } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg text-ink">Dashboard</h1>
        <p className="text-sm text-muted">Last 30 days across {summary.total} monitor{summary.total === 1 ? '' : 's'}.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Overall uptime" value={percent(uptime.uptime, 3)} tone="text-up" />
        <Stat label="Monitors" value={summary.total} />
        <Stat label="Online" value={summary.up} tone="text-up" />
        <Stat label="Offline" value={summary.down} tone={summary.down > 0 ? 'text-down' : undefined} />
        <Stat label="Degraded" value={summary.degraded} tone={summary.degraded > 0 ? 'text-degraded' : undefined} />
        <Stat label="Avg response" value={ms(Number(latency.avg_ms))} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="Response time, last 24h" className="lg:col-span-2">
          {series.length ? (
            <LatencyChart data={series} />
          ) : (
            <Empty title="No checks yet" hint="Add a monitor to start collecting response-time history." />
          )}
        </Panel>
        <Panel title="Latency distribution">
          <dl className="space-y-3">
            {[
              ['p50', latency.p50_ms],
              ['p95', latency.p95_ms],
              ['p99', latency.p99_ms]
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="metric text-ink">{ms(Number(value))}</dd>
              </div>
            ))}
            <div className="border-t border-line pt-3 text-xs text-muted">
              <div>Last success: {since(lastChecks.last_success)}</div>
              <div>Last failure: {since(lastChecks.last_failure)}</div>
              <div>{latency.samples} samples in the last 24h</div>
            </div>
          </dl>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Recent incidents" action={<Link to="/incidents" className="text-xs text-signal hover:underline">View all</Link>}>
          {incidents.length ? (
            <ul className="divide-y divide-line">
              {incidents.map((incident) => (
                <li key={incident.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Link to={`/monitors/${incident.monitor_id}`} className="text-ink hover:text-signal">
                      {incident.monitor_name}
                    </Link>
                    <div className="text-xs text-muted">
                      {incident.status === 'resolved'
                        ? `Resolved after ${duration(incident.duration_seconds)}`
                        : `Open for ${duration((Date.now() - new Date(incident.started_at).getTime()) / 1000)}`}
                    </div>
                  </div>
                  <span className={`text-xs ${incident.status === 'resolved' ? 'text-muted' : 'text-down'}`}>
                    #{incident.id}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="No incidents" hint="Nothing has gone down recently. That's the goal." />
          )}
        </Panel>

        <Panel title="Slowest monitors, last hour">
          {slowest.length ? (
            <ul className="divide-y divide-line">
              {slowest.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <Link to={`/monitors/${m.id}`} className="text-ink hover:text-signal">{m.name}</Link>
                  <span className="metric text-muted">{ms(Number(m.avg_ms))}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Not enough data" hint="Response times will appear once checks have run." />
          )}
        </Panel>
      </div>

      {agents.length > 0 && (
        <Panel title="Servers" action={<Link to="/servers" className="text-xs text-signal hover:underline">View all</Link>}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <Link key={agent.id} to={`/servers/${agent.id}`} className="surface flex items-center justify-between px-3 py-2 hover:border-signal/40">
                <div>
                  <div className="text-sm text-ink">{agent.name}</div>
                  <StatusPill status={agent.status === 'online' ? 'up' : agent.status === 'offline' ? 'down' : 'pending'} />
                </div>
                <div className="text-right text-xs text-muted">
                  <div>CPU {percent(agent.cpu, 0)}</div>
                  <div>Mem {percent(agent.memory, 0)}</div>
                </div>
              </Link>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
