import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { bytes, clock, duration, percent, since } from '../lib/format';
import { Empty, Panel, Stat, StatusPill } from '../components/ui';
import { ResourceChart } from '../components/charts';

export default function ServerDetail() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<any>(null);
  const [window, setWindow] = useState('24h');

  useEffect(() => {
    if (!id) return;
    api.get(`/servers/${id}?window=${window}`).then(setData);
    const timer = setInterval(() => api.get(`/servers/${id}?window=${window}`).then(setData), 20_000);
    return () => clearInterval(timer);
  }, [id, window]);

  if (!data) return <div className="text-sm text-muted">Loading…</div>;
  const { agent, series, latest } = data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg text-ink">{agent.name}</h1>
            <StatusPill status={agent.status === 'online' ? 'up' : agent.status === 'offline' ? 'down' : 'pending'} />
          </div>
          <p className="text-sm text-muted">{agent.hostname ?? 'no hostname reported yet'} · last seen {since(agent.last_seen_at)}</p>
        </div>
        <div className="flex gap-1 text-xs">
          {['1h', '6h', '24h', '7d'].map((w) => (
            <button key={w} onClick={() => setWindow(w)} className={`rounded px-2 py-1 ${window === w ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>{w}</button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="CPU" value={percent(latest?.cpu, 1)} />
        <Stat label="Memory" value={percent(latest?.memory, 1)} />
        <Stat label="Disk" value={percent(latest?.disk, 1)} />
        <Stat label="Load (1m)" value={latest?.load1 ?? '—'} />
      </div>

      <Panel title="Resource usage">
        {series.length ? <ResourceChart data={series} /> : <Empty title="No telemetry yet" hint="Run the agent on this server to start collecting metrics." />}
      </Panel>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Panel title="Host">
          <dl className="space-y-2 text-sm">
            <Row label="Uptime" value={latest ? duration(latest.uptime_seconds) : '—'} />
            <Row label="OS" value={agent.os ? `${agent.os.platform} ${agent.os.release}` : '—'} />
            <Row label="CPUs" value={agent.os?.cpus ?? '—'} />
            <Row label="IPv4" value={(agent.ipv4 ?? []).join(', ') || '—'} />
            <Row label="IPv6" value={(agent.ipv6 ?? []).join(', ') || '—'} />
          </dl>
        </Panel>
        <Panel title="Alert thresholds">
          <dl className="space-y-2 text-sm">
            <Row label="CPU" value={`${agent.thresholds?.cpu ?? 90}%`} />
            <Row label="Memory" value={`${agent.thresholds?.memory ?? 90}%`} />
            <Row label="Disk" value={`${agent.thresholds?.disk ?? 90}%`} />
            <Row label="Heartbeat timeout" value={`${agent.heartbeat_timeout_seconds}s`} />
          </dl>
        </Panel>
      </div>

      <Link to="/servers" className="text-xs text-muted hover:text-ink">← Back to servers</Link>
    </div>
  );
}

function Row({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between border-b border-line pb-2 last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="metric text-ink">{value}</dd>
    </div>
  );
}
