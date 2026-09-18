import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Monitor } from '../lib/api';
import { canAtLeast, useSession } from '../lib/session';
import { Empty, Panel } from '../components/ui';

type StatusPageRow = { id: string; slug: string; title: string; is_public: boolean; monitor_count: number };

export default function StatusPages() {
  const [pages, setPages] = useState<StatusPageRow[] | null>(null);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ slug: '', title: '', selected: new Set<string>() });
  const { principal } = useSession();

  const load = () => api.get<{ pages: StatusPageRow[] }>('/status-pages').then((r) => setPages(r.pages));
  useEffect(() => {
    void load();
    api.get<{ monitors: Monitor[] }>('/monitors').then((r) => setMonitors(r.monitors));
  }, []);

  const create = async () => {
    await api.post('/status-pages', {
      slug: form.slug,
      title: form.title || form.slug,
      isPublic: true,
      monitors: [...form.selected].map((monitorId, i) => ({ monitorId, group: 'Services' }))
    });
    setCreating(false);
    setForm({ slug: '', title: '', selected: new Set() });
    void load();
  };

  const toggle = (id: string) =>
    setForm((f) => {
      const selected = new Set(f.selected);
      selected.has(id) ? selected.delete(id) : selected.add(id);
      return { ...f, selected };
    });

  if (!pages) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-ink">Status pages</h1>
        {canAtLeast(principal?.role, 'member') && <button className="btn-primary" onClick={() => setCreating(true)}>New status page</button>}
      </div>

      {creating && (
        <Panel title="Create a status page">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Address</label>
                <input className="field" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="acme-services" />
                <p className="mt-1 text-xs text-muted">/status/{form.slug || 'your-slug'}</p>
              </div>
              <div>
                <label className="label">Title</label>
                <input className="field" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Acme Services" />
              </div>
            </div>
            <div>
              <span className="label">Include monitors</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {monitors.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 rounded border border-line px-2 py-1.5 text-sm">
                    <input type="checkbox" checked={form.selected.has(m.id)} onChange={() => toggle(m.id)} />
                    {m.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn-primary" onClick={create} disabled={!form.slug}>Create</button>
            </div>
          </div>
        </Panel>
      )}

      {pages.length === 0 ? (
        <Empty title="No status pages yet" hint="Create one to share live availability with customers or your team." />
      ) : (
        <div className="surface divide-y divide-line">
          {pages.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="text-sm text-ink">{p.title}</div>
                <a href={`/status/${p.slug}`} target="_blank" rel="noreferrer" className="text-xs text-signal hover:underline">/status/{p.slug}</a>
              </div>
              <span className="text-xs text-muted">{p.monitor_count} monitor{p.monitor_count === 1 ? '' : 's'} · {p.is_public ? 'public' : 'private'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
