import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { ErrorNote } from '../components/ui';

const TYPES = [
  { value: 'http', label: 'HTTP / HTTPS' },
  { value: 'api', label: 'API (JSON)' },
  { value: 'tcp', label: 'TCP port' },
  { value: 'dns', label: 'DNS record' },
  { value: 'ping', label: 'Ping' }
];

const INTERVALS = [
  { value: 30, label: '30 seconds' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' }
];

type FormState = {
  name: string;
  type: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  degradedLatencyMs: string;
  url: string;
  method: string;
  expectedStatus: string;
  keyword: string;
  host: string;
  port: string;
  domain: string;
  recordType: string;
  expectedValue: string;
};

const initial: FormState = {
  name: '',
  type: 'http',
  intervalSeconds: 60,
  timeoutMs: 10000,
  failureThreshold: 3,
  recoveryThreshold: 2,
  degradedLatencyMs: '',
  url: 'https://',
  method: 'GET',
  expectedStatus: '2xx',
  keyword: '',
  host: '',
  port: '443',
  domain: '',
  recordType: 'A',
  expectedValue: ''
};

function buildConfig(f: FormState): Record<string, unknown> {
  switch (f.type) {
    case 'http':
    case 'api':
      return {
        url: f.url,
        method: f.method,
        expectedStatus: f.expectedStatus.split(',').map((s) => s.trim()).filter(Boolean),
        keyword: f.keyword || undefined
      };
    case 'tcp':
      return { host: f.host, port: Number(f.port) };
    case 'dns':
      return { domain: f.domain, recordType: f.recordType, expectedValue: f.expectedValue || undefined };
    case 'ping':
      return { host: f.host, packets: 4, maxPacketLossPercent: 20, fallbackPort: 443 };
    default:
      return {};
  }
}

export default function MonitorForm() {
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { monitor } = await api.post<{ monitor: { id: string } }>('/monitors', {
        name: form.name,
        type: form.type,
        intervalSeconds: form.intervalSeconds,
        timeoutMs: form.timeoutMs,
        failureThreshold: form.failureThreshold,
        recoveryThreshold: form.recoveryThreshold,
        degradedLatencyMs: form.degradedLatencyMs ? Number(form.degradedLatencyMs) : null,
        config: buildConfig(form)
      });
      navigate(`/monitors/${monitor.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.details?.map((d) => d.message).join(' ') || err.message
          : 'Something went wrong. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg text-ink">Add a monitor</h1>
      <form onSubmit={onSubmit} className="surface space-y-5 p-5">
        {error && <ErrorNote message={error} />}

        <div>
          <label className="label" htmlFor="name">Name</label>
          <input id="name" className="field" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Production API" />
        </div>

        <div>
          <span className="label">Type</span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {TYPES.map((t) => (
              <button
                type="button"
                key={t.value}
                onClick={() => set('type', t.value)}
                className={`rounded border px-2 py-2 text-xs ${form.type === t.value ? 'border-signal bg-signal/10 text-signal' : 'border-line text-muted hover:text-ink'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {(form.type === 'http' || form.type === 'api') && (
          <>
            <div>
              <label className="label" htmlFor="url">URL</label>
              <input id="url" className="field" required value={form.url} onChange={(e) => set('url', e.target.value)} placeholder="https://example.com/health" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="method">Method</label>
                <select id="method" className="field" value={form.method} onChange={(e) => set('method', e.target.value)}>
                  {['GET', 'HEAD', 'POST', 'PUT'].map((m) => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="status">Expected status</label>
                <input id="status" className="field" value={form.expectedStatus} onChange={(e) => set('expectedStatus', e.target.value)} placeholder="2xx" />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="keyword">Response must contain (optional)</label>
              <input id="keyword" className="field" value={form.keyword} onChange={(e) => set('keyword', e.target.value)} placeholder="ok" />
            </div>
          </>
        )}

        {form.type === 'tcp' && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="host">Host or IP</label>
              <input id="host" className="field" required value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="db.example.com" />
            </div>
            <div>
              <label className="label" htmlFor="port">Port</label>
              <input id="port" className="field" type="number" min={1} max={65535} required value={form.port} onChange={(e) => set('port', e.target.value)} />
            </div>
          </div>
        )}

        {form.type === 'dns' && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="domain">Domain</label>
              <input id="domain" className="field" required value={form.domain} onChange={(e) => set('domain', e.target.value)} placeholder="example.com" />
            </div>
            <div>
              <label className="label" htmlFor="recordType">Record</label>
              <select id="recordType" className="field" value={form.recordType} onChange={(e) => set('recordType', e.target.value)}>
                {['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'].map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <div className="col-span-3">
              <label className="label" htmlFor="expected">Expected value (optional)</label>
              <input id="expected" className="field" value={form.expectedValue} onChange={(e) => set('expectedValue', e.target.value)} />
            </div>
          </div>
        )}

        {form.type === 'ping' && (
          <div>
            <label className="label" htmlFor="pingHost">Host or IP</label>
            <input id="pingHost" className="field" required value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="1.1.1.1" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <label className="label" htmlFor="interval">Interval</label>
            <select id="interval" className="field" value={form.intervalSeconds} onChange={(e) => set('intervalSeconds', Number(e.target.value))}>
              {INTERVALS.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="timeout">Timeout (ms)</label>
            <input id="timeout" className="field" type="number" min={1000} max={60000} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="failThresh">Fails before down</label>
            <input id="failThresh" className="field" type="number" min={1} max={10} value={form.failureThreshold} onChange={(e) => set('failureThreshold', Number(e.target.value))} />
          </div>
          <div>
            <label className="label" htmlFor="recThresh">Successes to recover</label>
            <input id="recThresh" className="field" type="number" min={1} max={10} value={form.recoveryThreshold} onChange={(e) => set('recoveryThreshold', Number(e.target.value))} />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="degraded">Degraded latency threshold, ms (optional)</label>
          <input id="degraded" className="field" type="number" value={form.degradedLatencyMs} onChange={(e) => set('degradedLatencyMs', e.target.value)} placeholder="800" />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={() => navigate('/monitors')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create monitor'}</button>
        </div>
      </form>
    </div>
  );
}
