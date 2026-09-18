import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const requestReset = async (e: FormEvent) => {
    e.preventDefault();
    const res = await api.post<{ message: string }>('/auth/password-reset/request', { email });
    setMessage(res.message);
  };

  const confirmReset = async (e: FormEvent) => {
    e.preventDefault();
    await api.post('/auth/password-reset/confirm', { token, password });
    setMessage('Password updated. You can sign in now.');
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={token ? confirmReset : requestReset} className="surface w-full max-w-sm space-y-4 p-6">
        <h1 className="text-lg text-ink">{token ? 'Choose a new password' : 'Reset your password'}</h1>
        {message && <p className="text-sm text-up">{message}</p>}
        {!token ? (
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" className="field" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="password">New password</label>
            <input id="password" className="field" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}
        <button className="btn-primary w-full justify-center" type="submit">
          {token ? 'Update password' : 'Send reset link'}
        </button>
        <p className="text-center text-xs text-muted">
          <Link to="/login" className="hover:text-ink">Back to sign in</Link>
        </p>
      </form>
    </div>
  );
}
