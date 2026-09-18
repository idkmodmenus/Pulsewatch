import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { useSession } from './lib/session';
import Login from './pages/Login';
import Register from './pages/Register';
import ResetPassword from './pages/ResetPassword';
import Dashboard from './pages/Dashboard';
import Monitors from './pages/Monitors';
import MonitorForm from './pages/MonitorForm';
import MonitorDetail from './pages/MonitorDetail';
import Incidents from './pages/Incidents';
import Servers from './pages/Servers';
import ServerDetail from './pages/ServerDetail';
import StatusPages from './pages/StatusPages';
import PublicStatusPage from './pages/PublicStatusPage';
import Notifications from './pages/Notifications';
import Settings from './pages/Settings';
import ApiKeys from './pages/ApiKeys';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { principal, loading } = useSession();
  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading…</div>;
  if (!principal) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/status/:slug" element={<PublicStatusPage />} />

      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/monitors" element={<Monitors />} />
        <Route path="/monitors/new" element={<MonitorForm />} />
        <Route path="/monitors/:id" element={<MonitorDetail />} />
        <Route path="/incidents" element={<Incidents />} />
        <Route path="/servers" element={<Servers />} />
        <Route path="/servers/:id" element={<ServerDetail />} />
        <Route path="/status-pages" element={<StatusPages />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/api-keys" element={<ApiKeys />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
