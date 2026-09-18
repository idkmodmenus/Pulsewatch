import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSession } from '../lib/session';
import { useTheme } from '../lib/theme';

const NAV = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/monitors', label: 'Monitors' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/servers', label: 'Servers' },
  { to: '/status-pages', label: 'Status pages' },
  { to: '/notifications', label: 'Notifications' },
  { to: '/settings', label: 'Settings' },
  { to: '/api-keys', label: 'API keys' }
];

export default function Layout() {
  const { principal, organization, logout } = useSession();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-4">
        <div className="mb-6 flex items-center gap-2 px-2">
          <span className="h-2.5 w-2.5 rounded-full bg-signal" />
          <span className="font-mono text-sm font-medium tracking-tight">pulsewatch</span>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded px-2.5 py-1.5 text-sm ${isActive ? 'bg-raised text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
          <div className="truncate px-2">{organization?.name ?? '—'}</div>
          <div className="truncate px-2 text-[11px]">{principal?.email}</div>
          <div className="mt-2 flex gap-1 px-2">
            <button className="btn-ghost flex-1 justify-center text-xs" onClick={toggle}>
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button
              className="btn-ghost flex-1 justify-center text-xs"
              onClick={() => void logout().then(() => navigate('/login'))}
            >
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-x-hidden px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
