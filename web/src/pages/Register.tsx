import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote } from '../components/ui';

export default function Register() {
  const [form, setForm] = useState({ name: '', organization: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const navigate = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/register', form);
      await refresh();
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-signal" />
          <span className="font-mono text-lg font-medium">pulsewatch</span>
        </div>
        <form onSubmit={onSubmit} className="surface space-y-4 p-6">
          <h1 className="text-lg text-ink">Create your workspace</h1>
          {error && <ErrorNote message={error} />}
          <div>
            <label className="label" htmlFor="name">Your name</label>
            <input id="name" className="field" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="org">Organization</label>
            <input id="org" className="field" placeholder="Acme Infrastructure" value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="field" type="password" required minLength={10} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            <p className="mt-1 text-xs text-muted">At least 10 characters.</p>
          </div>
          <button className="btn-primary w-full justify-center" disabled={busy} type="submit">
            {busy ? 'Creating…' : 'Create workspace'}
          </button>
          <p className="text-center text-xs text-muted">
            Already have an account? <Link to="/login" className="text-signal hover:underline">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
