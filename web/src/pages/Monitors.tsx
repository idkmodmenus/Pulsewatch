import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Monitor } from '../lib/api';
import { ms, since } from '../lib/format';
import { useStream } from '../lib/useStream';
import { Empty, Sparkline, StatusPill } from '../components/ui';

const TYPE_LABEL: Record<string, string> = { http: 'HTTP', api: 'API', tcp: 'TCP', dns: 'DNS', ping: 'Ping' };

export default function Monitors() {
  const [monitors, setMonitors] = useState<Monitor[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'up' | 'down' | 'degraded'>('all');

  const load = () => api.get<{ monitors: Monitor[] }>('/monitors').then((r) => setMonitors(r.monitors));
  useEffect(() => {
    void load();
  }, []);
  useStream(() => void load(), ['monitor.status', 'check.completed']);

  if (!monitors) return <div className="text-sm text-muted">Loading…</div>;
  const visible = filter === 'all' ? monitors : monitors.filter((m) => m.status === filter);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-ink">Monitors</h1>
        <Link to="/monitors/new" className="btn-primary">Add monitor</Link>
      </div>

      <div className="flex gap-1 text-sm">
        {(['all', 'up', 'degraded', 'down'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded px-3 py-1 ${filter === key ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
          >
            {key === 'all' ? `All (${monitors.length})` : `${key[0].toUpperCase()}${key.slice(1)} (${monitors.filter((m) => m.status === key).length})`}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <Empty
          title="No monitors here"
          hint="Add your first HTTP, API, TCP, DNS or ping monitor to start tracking uptime."
          action={<Link to="/monitors/new" className="btn-primary">Add monitor</Link>}
        />
      ) : (
        <div className="surface overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-4 py-2 font-normal">Type</th>
                <th className="px-4 py-2 font-normal">Status</th>
                <th className="px-4 py-2 font-normal">Latency</th>
                <th className="px-4 py-2 font-normal">Last 6h</th>
                <th className="px-4 py-2 font-normal">Last check</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => (
                <tr key={m.id} className="border-b border-line last:border-0 hover:bg-raised/40">
                  <td className="px-4 py-3">
                    <Link to={`/monitors/${m.id}`} className="text-ink hover:text-signal">{m.name}</Link>
                    {!m.enabled && <span className="ml-2 text-xs text-muted">(paused)</span>}
                  </td>
                  <td className="px-4 py-3 text-muted">{TYPE_LABEL[m.type] ?? m.type}</td>
                  <td className="px-4 py-3"><StatusPill status={m.status} /></td>
                  <td className="metric px-4 py-3 text-ink">{ms(m.last_latency_ms)}</td>
                  <td className="px-4 py-3 text-muted">
                    <Sparkline points={m.sparkline ?? []} />
                  </td>
                  <td className="px-4 py-3 text-muted">{since(m.last_check_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
