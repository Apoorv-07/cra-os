import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setActiveOrg, onAuthFailure } from './api';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isSystemAdmin: boolean;
  timezone: string;
  locale: string;
}

export interface OrgMembership {
  orgId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  name: string;
  slug: string;
  planKey: string;
  isAgency: boolean;
}

export interface Capabilities {
  githubApp: boolean;
  githubOauth: boolean;
  payments: boolean;
  ai: boolean;
}

interface MeResponse {
  user: SessionUser;
  organizations: OrgMembership[];
  defaultOrgId: string | null;
  capabilities: Capabilities;
}

interface AuthState {
  ready: boolean;
  user: SessionUser | null;
  orgs: OrgMembership[];
  orgId: string | null;
  org: OrgMembership | null;
  role: OrgMembership['role'] | null;
  capabilities: Capabilities;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signOut: () => Promise<void>;
  switchOrg: (orgId: string) => void;
  refresh: () => Promise<void>;
}

const ORG_KEY = 'cra.activeOrg';

const AuthContext = createContext<AuthState | null>(null);

const EMPTY_CAPABILITIES: Capabilities = { githubApp: false, githubOauth: false, payments: false, ai: false };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [orgs, setOrgs] = useState<OrgMembership[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities>(EMPTY_CAPABILITIES);

  const apply = useCallback((me: MeResponse) => {
    setUser(me.user);
    setOrgs(me.organizations ?? []);
    setCapabilities(me.capabilities ?? EMPTY_CAPABILITIES);

    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(ORG_KEY) : null;
    const valid = stored && me.organizations.some((o) => o.orgId === stored) ? stored : me.defaultOrgId;
    setOrgId(valid ?? me.organizations[0]?.orgId ?? null);
  }, []);

  const load = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>('/auth/me');
      apply(me);
    } catch {
      setUser(null);
      setOrgs([]);
      setOrgId(null);
    } finally {
      setReady(true);
    }
  }, [apply]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep the API client scoped to the active organisation on every request.
  useEffect(() => {
    setActiveOrg(orgId);
    if (orgId && typeof localStorage !== 'undefined') localStorage.setItem(ORG_KEY, orgId);
  }, [orgId]);

  // A single place to react to an expired session: clear state, let the router
  // redirect. Screens never have to handle 401 themselves.
  useEffect(() => {
    onAuthFailure(() => {
      setUser(null);
      setOrgs([]);
      setOrgId(null);
    });
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await api.post('/auth/login', { email, password });
      await load();
    },
    [load],
  );

  const signUp = useCallback(
    async (email: string, password: string, name?: string) => {
      await api.post('/auth/signup', { email, password, name });
      await load();
    },
    [load],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* the local session is cleared regardless */
    }
    setUser(null);
    setOrgs([]);
    setOrgId(null);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(ORG_KEY);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      ready,
      user,
      orgs,
      orgId,
      org: orgs.find((o) => o.orgId === orgId) ?? null,
      role: orgs.find((o) => o.orgId === orgId)?.role ?? null,
      capabilities,
      signIn,
      signUp,
      signOut,
      switchOrg: setOrgId,
      refresh: load,
    }),
    [ready, user, orgs, orgId, capabilities, signIn, signUp, signOut, load],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Guards a route; renders nothing until the session is known. */
export function useRequireAuth(): AuthState {
  const auth = useAuth();
  return auth;
}
