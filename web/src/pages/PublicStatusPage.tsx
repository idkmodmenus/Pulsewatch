import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { percent } from '../lib/format';

type PublicData = {
  page: { title: string; description: string; branding: { accent?: string; footer?: string } };
  overall: 'operational' | 'degraded' | 'major_outage';
  services: {
    name: string;
    group_name: string;
    status: string;
    uptime_90d: string;
    history: { day: string; uptime: number }[] | null;
  }[];
  incidents: { id: number; status: string; started_at: string; resolved_at: string | null; monitor_name: string }[];
};

const OVERALL_COPY: Record<string, { label: string; className: string }> = {
  operational: { label: 'All systems operational', className: 'text-up' },
  degraded: { label: 'Some systems degraded', className: 'text-degraded' },
  major_outage: { label: 'Major outage', className: 'text-down' }
};

function HistoryBar({ history }: { history: { day: string; uptime: number }[] | null }) {
  const days = history ?? [];
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 90 }).map((_, i) => {
        const day = days[days.length - 90 + i];
        const uptime = day?.uptime ?? 100;
        const color = day === undefined ? 'bg-line' : uptime >= 99.9 ? 'bg-up' : uptime >= 98 ? 'bg-degraded' : 'bg-down';
        return <div key={i} className={`h-6 w-1 rounded-sm ${color}`} title={day ? `${day.day}: ${uptime.toFixed(2)}%` : 'no data'} />;
      })}
    </div>
  );
}

export default function PublicStatusPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<PublicData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch(`/api/public/status-pages/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setError(true));
  }, [slug]);

  if (error) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted">No status page lives at that address.</div>;
  }
  if (!data) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading…</div>;

  const groups = Array.from(new Set(data.services.map((s) => s.group_name)));
  const overall = OVERALL_COPY[data.overall];

  return (
    <div className="min-h-screen bg-base px-4 py-10 text-ink">
      <div className="mx-auto max-w-2xl space-y-8">
        <header>
          <h1 className="text-xl">{data.page.title}</h1>
          {data.page.description && <p className="mt-1 text-sm text-muted">{data.page.description}</p>}
          <p className={`mt-4 text-sm ${overall.className}`}>● {overall.label}</p>
        </header>

        {groups.map((group) => (
          <section key={group} className="surface divide-y divide-line">
            <h2 className="px-4 py-3 text-sm text-muted">{group}</h2>
            {data.services.filter((s) => s.group_name === group).map((s) => (
              <div key={s.name} className="px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span>{s.name}</span>
                  <span className={s.status === 'up' ? 'text-up' : s.status === 'degraded' ? 'text-degraded' : 'text-down'}>
                    {s.status === 'up' ? 'Operational' : s.status === 'degraded' ? 'Degraded performance' : 'Down'}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <HistoryBar history={s.history} />
                  <span className="text-xs text-muted">{percent(s.uptime_90d, 2)} · 90 days</span>
                </div>
              </div>
            ))}
          </section>
        ))}

        {data.incidents.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm text-muted">Recent incidents</h2>
            <div className="surface divide-y divide-line">
              {data.incidents.map((i) => (
                <div key={i.id} className="px-4 py-3 text-sm">
                  <span className="text-ink">{i.monitor_name}</span>
                  <span className="ml-2 text-xs text-muted">
                    {new Date(i.started_at).toLocaleDateString()} · {i.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.page.branding.footer && <footer className="text-center text-xs text-muted">{data.page.branding.footer}</footer>}
      </div>
    </div>
  );
}
