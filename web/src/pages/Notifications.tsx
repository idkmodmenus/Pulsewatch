import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { canAtLeast, useSession } from '../lib/session';
import { Empty, Panel } from '../components/ui';
import { clock } from '../lib/format';

type Channel = { id: string; type: string; name: string; enabled: boolean; has_endpoint: boolean };
type Rule = { id: string; name: string; event_types: string[]; channel_name: string; cooldown_seconds: number; enabled: boolean };
type Delivery = { id: number; event_type: string; status: string; channel_name: string; created_at: string; error: string | null };

const EVENT_TYPES = [
  'monitor.down', 'monitor.recovered', 'monitor.degraded', 'monitor.high_latency', 'monitor.packet_loss',
  'ssl.expiring', 'dns.changed', 'agent.cpu', 'agent.memory', 'agent.disk', 'agent.disconnected'
];

export default function Notifications() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [addingChannel, setAddingChannel] = useState(false);
  const [channelForm, setChannelForm] = useState({ type: 'webhook', name: '', endpoint: '', to: '' });
  const [addingRule, setAddingRule] = useState(false);
  const [ruleForm, setRuleForm] = useState({ name: '', channelId: '', eventTypes: new Set(['monitor.down', 'monitor.recovered']) });
  const { principal } = useSession();
  const canManage = canAtLeast(principal?.role, 'admin');

  const load = () => {
    api.get<{ channels: Channel[] }>('/notification-channels').then((r) => setChannels(r.channels));
    api.get<{ rules: Rule[] }>('/alert-rules').then((r) => setRules(r.rules));
    api.get<{ deliveries: Delivery[] }>('/alert-deliveries').then((r) => setDeliveries(r.deliveries));
  };
  useEffect(() => {
    load();
  }, []);

  const createChannel = async () => {
    const config: Record<string, string> =
      channelForm.type === 'email' ? { to: channelForm.to }
      : channelForm.type === 'webhook' ? { url: channelForm.endpoint }
      : { webhookUrl: channelForm.endpoint };
    await api.post('/notification-channels', { type: channelForm.type, name: channelForm.name, config });
    setAddingChannel(false);
    setChannelForm({ type: 'webhook', name: '', endpoint: '', to: '' });
    load();
  };

  const testChannel = async (id: string) => {
    const res = await api.post<{ delivered: boolean; error?: string }>(`/notification-channels/${id}/test`);
    alert(res.delivered ? 'Test notification sent.' : `Delivery failed: ${res.error}`);
  };

  const createRule = async () => {
    if (!ruleForm.channelId) return;
    await api.post('/alert-rules', { name: ruleForm.name || 'Alert rule', channelId: ruleForm.channelId, eventTypes: [...ruleForm.eventTypes] });
    setAddingRule(false);
    setRuleForm({ name: '', channelId: '', eventTypes: new Set(['monitor.down', 'monitor.recovered']) });
    load();
  };

  const toggleEvent = (type: string) =>
    setRuleForm((f) => {
      const events = new Set(f.eventTypes);
      events.has(type) ? events.delete(type) : events.add(type);
      return { ...f, eventTypes: events };
    });

  return (
    <div className="space-y-6">
      <h1 className="text-lg text-ink">Notifications</h1>

      <Panel title="Channels" action={canManage && <button className="btn-ghost text-xs" onClick={() => setAddingChannel(true)}>Add channel</button>}>
        {addingChannel && (
          <div className="mb-4 space-y-3 rounded border border-line p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Type</label>
                <select className="field" value={channelForm.type} onChange={(e) => setChannelForm({ ...channelForm, type: e.target.value })}>
                  {['webhook', 'discord', 'slack', 'email'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Name</label>
                <input className="field" value={channelForm.name} onChange={(e) => setChannelForm({ ...channelForm, name: e.target.value })} placeholder="On-call webhook" />
              </div>
            </div>
            {channelForm.type === 'email' ? (
              <div>
                <label className="label">Recipient</label>
                <input className="field" value={channelForm.to} onChange={(e) => setChannelForm({ ...channelForm, to: e.target.value })} placeholder="ops@example.com" />
              </div>
            ) : (
              <div>
                <label className="label">{channelForm.type === 'webhook' ? 'Webhook URL' : `${channelForm.type} webhook URL`}</label>
                <input className="field" value={channelForm.endpoint} onChange={(e) => setChannelForm({ ...channelForm, endpoint: e.target.value })} placeholder="https://…" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setAddingChannel(false)}>Cancel</button>
              <button className="btn-primary" onClick={createChannel}>Save</button>
            </div>
          </div>
        )}
        {channels.length === 0 ? (
          <Empty title="No channels yet" hint="Add email, Discord, Slack or a generic webhook to receive alerts." />
        ) : (
          <ul className="divide-y divide-line">
            {channels.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2 text-sm">
                <span>{c.name} <span className="text-xs text-muted">({c.type})</span></span>
                <button className="btn-ghost text-xs" onClick={() => testChannel(c.id)}>Send test</button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Alert rules" action={canManage && <button className="btn-ghost text-xs" onClick={() => setAddingRule(true)}>Add rule</button>}>
        {addingRule && (
          <div className="mb-4 space-y-3 rounded border border-line p-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Name</label>
                <input className="field" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="Page on-call" />
              </div>
              <div>
                <label className="label">Channel</label>
                <select className="field" value={ruleForm.channelId} onChange={(e) => setRuleForm({ ...ruleForm, channelId: e.target.value })}>
                  <option value="">Select…</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <span className="label">Triggers on</span>
              <div className="flex flex-wrap gap-2">
                {EVENT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs">
                    <input type="checkbox" checked={ruleForm.eventTypes.has(t)} onChange={() => toggleEvent(t)} />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setAddingRule(false)}>Cancel</button>
              <button className="btn-primary" onClick={createRule}>Save</button>
            </div>
          </div>
        )}
        {rules.length === 0 ? (
          <Empty title="No alert rules yet" hint="Connect events to a channel so the right people hear about outages." />
        ) : (
          <ul className="divide-y divide-line">
            {rules.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>{r.name} → {r.channel_name}</span>
                  <span className="text-xs text-muted">{r.cooldown_seconds}s cooldown</span>
                </div>
                <p className="text-xs text-muted">{r.event_types.join(', ')}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent deliveries">
        {deliveries.length === 0 ? (
          <Empty title="Nothing delivered yet" hint="Alert history will show up here." />
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-b border-line last:border-0">
                  <td className="py-2 text-muted">{clock(d.created_at)}</td>
                  <td className="py-2">{d.event_type}</td>
                  <td className="py-2 text-muted">{d.channel_name}</td>
                  <td className={`py-2 text-right ${d.status === 'sent' ? 'text-up' : d.status === 'failed' ? 'text-down' : 'text-muted'}`}>{d.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
