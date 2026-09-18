import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { clock, since } from '../lib/format';
import { canAtLeast, useSession } from '../lib/session';
import { Empty, Panel } from '../components/ui';

type Key = { id: string; name: string; prefix: string; role: string; last_used_at: string | null; expires_at: string | null; revoked_at: string | null; created_at: string };

export default function ApiKeys() {
  const [keys, setKeys] = useState<Key[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [role, setRole] = useState('member');
  const [issued, setIssued] = useState<string | null>(null);
  const { principal } = useSession();
  const canManage = canAtLeast(principal?.role, 'admin');

  const load = () => api.get<{ keys: Key[] }>('/api-keys').then((r) => setKeys(r.keys));
  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    const res = await api.post<{ token: string }>('/api-keys', { name: name || 'API key', role });
    setIssued(res.token);
    setCreating(false);
    setName('');
    load();
  };

  const revoke = async (id: string) => {
    await api.del(`/api-keys/${id}`);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-ink">API keys</h1>
        {canManage && <button className="btn-primary" onClick={() => setCreating(true)}>Create key</button>}
      </div>

      {issued && (
        <Panel title="Copy this key now">
          <p className="text-sm text-muted">It will not be shown again.</p>
          <pre className="mt-2 overflow-x-auto rounded bg-raised p-3 text-xs">{issued}</pre>
          <button className="btn-ghost mt-2 text-xs" onClick={() => setIssued(null)}>Done</button>
        </Panel>
      )}

      {creating && (
        <Panel title="New API key">
          <div className="flex flex-wrap gap-2">
            <input className="field max-w-xs" placeholder="CI pipeline" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="field max-w-[10rem]" value={role} onChange={(e) => setRole(e.target.value)}>
              {['admin', 'member', 'viewer'].map((r) => <option key={r}>{r}</option>)}
            </select>
            <button className="btn-primary" onClick={create}>Create</button>
            <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </Panel>
      )}

      {keys.length === 0 ? (
        <Empty title="No API keys yet" hint="Create one to manage monitors from scripts or CI." />
      ) : (
        <div className="surface divide-y divide-line">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <span className="text-ink">{k.name}</span>
                <span className="ml-2 font-mono text-xs text-muted">{k.prefix}.•••</span>
                {k.revoked_at && <span className="ml-2 text-xs text-down">revoked</span>}
              </div>
              <div className="flex items-center gap-3 text-xs text-muted">
                <span className="capitalize">{k.role}</span>
                <span>used {since(k.last_used_at)}</span>
                {canManage && !k.revoked_at && (
                  <button className="text-down hover:underline" onClick={() => revoke(k.id)}>Revoke</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
