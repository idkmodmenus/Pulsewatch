import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { ErrorNote } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const navigate = useNavigate();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { email, password });
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
          <h1 className="text-lg text-ink">Sign in</h1>
          {error && <ErrorNote message={error} />}
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" className="field" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button className="btn-primary w-full justify-center" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="flex justify-between text-xs text-muted">
            <Link to="/reset-password" className="hover:text-ink">Forgot password?</Link>
            <Link to="/register" className="hover:text-ink">Create an account</Link>
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-muted">Demo login: demo@pulsewatch.local / pulsewatch</p>
      </div>
    </div>
  );
}
