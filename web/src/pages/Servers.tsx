import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { bytes, percent, since } from '../lib/format';
import { canAtLeast, useSession } from '../lib/session';
import { Empty, Panel, StatusPill } from '../components/ui';

type Agent = {
  id: string;
  name: string;
  hostname: string | null;
  status: string;
  last_seen_at: string | null;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  load1: number | null;
  uptime_seconds: number | null;
  token_prefix?: string;
};

export default function Servers() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [newToken, setNewToken] = useState<{ name: string; token: string } | null>(null);
  const { principal } = useSession();

  const load = () => api.get<{ agents: Agent[] }>('/servers').then((r) => setAgents(r.agents));
  useEffect(() => {
    void load();
    const id = setInterval(load, 20_000);
    return () => clearInterval(id);
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    const res = await api.post<{ agent: Agent; token: string }>('/servers', { name });
    setNewToken({ name: res.agent.name, token: res.token });
    setName('');
    setCreating(false);
    void load();
  };

  if (!agents) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg text-ink">Servers</h1>
        {canAtLeast(principal?.role, 'admin') && (
          <button className="btn-primary" onClick={() => setCreating(true)}>Add server</button>
        )}
      </div>

      {creating && (
        <Panel title="New server agent">
          <div className="flex gap-2">
            <input className="field" placeholder="web-01" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary" onClick={create}>Create</button>
            <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </Panel>
      )}

      {newToken && (
        <Panel title={`Agent token for ${newToken.name}`}>
          <p className="text-sm text-muted">
            Copy this now — it will not be shown again. Run the agent with:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-raised p-3 text-xs">
{`PULSEWATCH_URL=<your-server-url> \\
PULSEWATCH_TOKEN=${newToken.token} \\
node agent/src/agent.js`}
          </pre>
          <button className="btn-ghost mt-3 text-xs" onClick={() => setNewToken(null)}>Done</button>
        </Panel>
      )}

      {agents.length === 0 ? (
        <Empty title="No servers yet" hint="Add a server and run the lightweight agent on it to see CPU, memory, disk and load here." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link key={agent.id} to={`/servers/${agent.id}`} className="surface block p-4 hover:border-signal/40">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink">{agent.name}</span>
                <StatusPill status={agent.status === 'online' ? 'up' : agent.status === 'offline' ? 'down' : 'pending'} />
              </div>
              <p className="text-xs text-muted">{agent.hostname ?? 'awaiting first report'}</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <div><div className="metric text-ink">{percent(agent.cpu, 0)}</div><div className="text-muted">CPU</div></div>
                <div><div className="metric text-ink">{percent(agent.memory, 0)}</div><div className="text-muted">RAM</div></div>
                <div><div className="metric text-ink">{percent(agent.disk, 0)}</div><div className="text-muted">Disk</div></div>
              </div>
              <p className="mt-3 text-xs text-muted">Last seen {since(agent.last_seen_at)}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
