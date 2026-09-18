import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { canAtLeast, useSession } from '../lib/session';
import { clock } from '../lib/format';
import { Panel } from '../components/ui';

type Member = { id: string; email: string; name: string; role: string; created_at: string };
type AuditLog = { id: number; actor_type: string; action: string; target: string | null; created_at: string };

const RETENTIONS = [7, 30, 90, 365];

export default function Settings() {
  const [org, setOrg] = useState<{ id: string; name: string; retention_days: number } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const { principal } = useSession();
  const isOwner = canAtLeast(principal?.role, 'owner');
  const isAdmin = canAtLeast(principal?.role, 'admin');

  useEffect(() => {
    api.get<{ organization: any; members: Member[] }>('/settings/organization').then((r) => {
      setOrg(r.organization);
      setMembers(r.members);
    });
    if (isAdmin) api.get<{ logs: AuditLog[] }>('/audit-logs').then((r) => setLogs(r.logs));
  }, [isAdmin]);

  const setRetention = async (days: number) => {
    const res = await api.patch<{ organization: any }>('/settings/organization', { retentionDays: days });
    setOrg(res.organization);
  };

  if (!org) return <div className="text-sm text-muted">Loading…</div>;

  return (
    <div className="space-y-6">
      <h1 className="text-lg text-ink">Settings</h1>

      <Panel title="Organization">
        <div className="space-y-4">
          <div>
            <label className="label">Name</label>
            <input className="field max-w-sm" defaultValue={org.name} disabled={!isOwner} />
          </div>
          <div>
            <span className="label">Data retention</span>
            <div className="flex gap-2">
              {RETENTIONS.map((d) => (
                <button
                  key={d}
                  disabled={!isOwner}
                  onClick={() => setRetention(d)}
                  className={`rounded border px-3 py-1.5 text-sm ${org.retention_days === d ? 'border-signal text-signal' : 'border-line text-muted'} disabled:opacity-50`}
                >
                  {d} days
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">Raw check history older than this is dropped; aggregated uptime is kept much longer.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Members">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-normal">Name</th>
              <th className="pb-2 font-normal">Email</th>
              <th className="pb-2 font-normal">Role</th>
              <th className="pb-2 font-normal">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t border-line">
                <td className="py-2">{m.name}</td>
                <td className="py-2 text-muted">{m.email}</td>
                <td className="py-2 capitalize">{m.role}</td>
                <td className="py-2 text-muted">{clock(m.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {isAdmin && (
        <Panel title="Audit log">
          <div className="max-h-80 overflow-y-auto">
            <table className="w-full text-sm">
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-line last:border-0">
                    <td className="py-2 text-muted">{clock(l.created_at)}</td>
                    <td className="py-2">{l.action}</td>
                    <td className="py-2 text-muted">{l.target ?? '—'}</td>
                    <td className="py-2 text-right text-xs text-muted">{l.actor_type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}
