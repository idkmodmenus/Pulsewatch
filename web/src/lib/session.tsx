import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';

export type Principal = { id: string; kind: 'user' | 'api_key'; role: 'owner' | 'admin' | 'member' | 'viewer'; email?: string; name?: string };
export type Organization = { id: string; name: string; slug: string; retention_days: number };

type SessionState = {
  principal: Principal | null;
  organization: Organization | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<{ principal: Principal; organization: Organization }>('/auth/me');
      setPrincipal(res.principal);
      setOrganization(res.organization);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setPrincipal(null);
        setOrganization(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setPrincipal(null);
    setOrganization(null);
  }, []);

  return (
    <SessionContext.Provider value={{ principal, organization, loading, refresh, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}

const RANK = { viewer: 1, member: 2, admin: 3, owner: 4 } as const;
export const canAtLeast = (role: Principal['role'] | undefined, minimum: keyof typeof RANK): boolean =>
  !!role && RANK[role] >= RANK[minimum];
