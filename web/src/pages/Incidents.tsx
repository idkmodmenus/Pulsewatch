import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Incident } from '../lib/api';
import { clock, duration } from '../lib/format';
import { useStream } from '../lib/useStream';
import { canAtLeast, useSession } from '../lib/session';
import { Empty, StatusPill } from '../components/ui';

export default function Incidents() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const { principal } = useSession();

  const load = () =>
    api.get<{ incidents: Incident[] }>(`/incidents${filter === 'all' ? '' : `?status=${filter}`}`).then((r) => setIncidents(r.incidents));
  useEffect(() => { void load(); }, [filter]);
  useStream(() => void load(), ['incident.opened', 'incident.resolved']);

  const acknowledge = async (id: number) => {
    await api.post(`/incidents/${id}/acknowledge`);
    void load();
  };

  if (!incidents) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-ink">Incidents</h1>
        <div className="flex gap-1 text-sm">
          {(['all', 'open', 'resolved'] as const).map((key) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded px-3 py-1 ${filter === key ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
            >
              {key[0].toUpperCase() + key.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {incidents.length === 0 ? (
        <Empty title="No incidents" hint="Everything monitored has stayed healthy." />
      ) : (
        <div className="surface divide-y divide-line">
          {incidents.map((incident) => (
            <div key={incident.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted">#{incident.id}</span>
                  <Link to={`/monitors/${incident.monitor_id}`} className="text-sm text-ink hover:text-signal">
                    {incident.monitor_name}
                  </Link>
                  <StatusPill status={incident.status === 'resolved' ? 'up' : 'down'} />
                </div>
                <p className="mt-1 text-sm text-muted">{incident.cause}</p>
                <p className="mt-1 text-xs text-muted">
                  Started {clock(incident.started_at)}
                  {incident.resolved_at && ` · resolved after ${duration(incident.duration_seconds)}`}
                  {' · '}detected after {incident.detected_after_failures} failed checks
                </p>
              </div>
              {incident.status === 'open' && canAtLeast(principal?.role, 'member') && (
                <button className="btn-ghost text-xs" onClick={() => acknowledge(incident.id)}>Acknowledge</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
