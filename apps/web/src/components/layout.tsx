import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Boxes,
  ChevronDown,
  CreditCard,
  FileCheck2,
  FileText,
  Key,
  LayoutGrid,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Button, Spinner } from './ui';
import { cx, formatNumber, initials } from '../lib/format';

/**
 * Primary navigation.
 *
 * These are the eight questions a customer actually has, in the order they ask
 * them. Navigation mirrors the product story — where am I, what do I own, how
 * compliant am I, what is broken, what proves it, what is on fire, what can I
 * show someone, and how do I run my account — not the backend module list.
 */
export const NAV = [
  { to: '/app', label: 'Overview', icon: LayoutGrid, end: true },
  { to: '/app/repositories', label: 'Repositories', icon: Boxes },
  { to: '/app/compliance', label: 'Compliance', icon: ShieldCheck },
  { to: '/app/findings', label: 'Findings', icon: ShieldAlert },
  { to: '/app/evidence', label: 'Evidence', icon: FileCheck2 },
  { to: '/app/incidents', label: 'Incidents', icon: Siren },
  { to: '/app/reports', label: 'Reports', icon: FileText },
  { to: '/app/billing', label: 'Billing', icon: CreditCard },
  { to: '/app/settings', label: 'Settings', icon: SettingsIcon },
] as const;

const ADMIN_NAV = { to: '/app/admin', label: 'Admin console', icon: Activity } as const;

export function CreditsPill({ compact }: { compact?: boolean }) {
  const { orgId } = useAuth();
  const { data } = useQuery({
    queryKey: ['billing', orgId],
    queryFn: () => api.get<{ balance: number; planKey: string }>(`/organizations/${orgId}/billing`),
    enabled: Boolean(orgId),
    refetchInterval: 30_000,
  });

  const balance = data?.balance ?? 0;
  const low = balance < 100;

  return (
    <Link
      to="/app/billing"
      className={cx(
        'inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors',
        low ? 'border-partial/40 bg-partial/10 text-partial hover:bg-partial/20' : 'border-border bg-surface-2 text-muted hover:text-text',
      )}
      title="Credit balance"
    >
      <Key size={13} className={low ? 'text-partial' : 'text-accent'} />
      <span className="mono font-medium text-text">{formatNumber(balance)}</span>
      {!compact ? <span className="text-faint">credits</span> : null}
    </Link>
  );
}

function OrgSwitcher() {
  const { orgs, org, switchOrg } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-2 px-2.5 py-2 text-left hover:bg-surface-3 transition-colors"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/15 text-[10px] font-semibold text-accent">
          {initials(org?.name, org?.slug ?? '?')}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-text">{org?.name ?? 'Select organisation'}</span>
          <span className="block text-[10px] uppercase tracking-wide text-faint">{org?.planKey ?? ''}</span>
        </span>
        <ChevronDown size={13} className="text-faint shrink-0" />
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 card overflow-hidden shadow-xl animate-in">
          {orgs.map((o) => (
            <button
              key={o.orgId}
              onClick={() => {
                switchOrg(o.orgId);
                setOpen(false);
              }}
              className={cx(
                'flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-surface-2',
                o.orgId === org?.orgId && 'bg-surface-2',
              )}
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-surface-3 text-[9px] font-semibold text-muted">
                {initials(o.name, o.slug)}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs text-text">{o.name}</span>
              <span className="text-[10px] text-faint">{o.role}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-full border border-border bg-surface-2 text-[11px] font-semibold text-muted hover:text-text"
      >
        {initials(user?.name, user?.email ?? '')}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 card overflow-hidden shadow-xl animate-in">
          <div className="border-b border-border px-3 py-2.5">
            <p className="truncate text-xs font-medium text-text">{user?.name ?? user?.email}</p>
            <p className="truncate text-[11px] text-faint">{user?.email}</p>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              navigate('/app/settings');
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            <SettingsIcon size={13} /> Settings
          </button>
          <button
            onClick={async () => {
              setOpen(false);
              await signOut();
              navigate('/login');
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted hover:bg-surface-2 hover:text-text"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, ready, orgId } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  // Not signed in: the router handles the redirect, but never flash the shell.
  useEffect(() => {
    if (ready && !user) navigate('/login', { replace: true });
  }, [ready, user, navigate]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  if (!ready || !user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner size={20} />
      </div>
    );
  }

  const navItems = user.isSystemAdmin ? [...NAV, ADMIN_NAV] : NAV;

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link to="/app" className="flex items-center gap-2 px-1.5 py-1">
        <ShieldCheck size={20} className="text-accent" />
        <span className="text-sm font-semibold tracking-tight">CRA Compliance OS</span>
      </Link>

      <OrgSwitcher />

      <nav className="flex flex-1 flex-col gap-0.5">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'end' in item ? item.end : false}
            className={({ isActive }) =>
              cx(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                isActive ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface-2/60 hover:text-text',
              )
            }
          >
            <item.icon size={15} className="shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2">
        {orgId ? <CreditsPill /> : null}
        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-faint">{user.email}</p>
          </div>
          <UserMenu />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="sticky top-0 hidden h-screen border-r border-border bg-surface/40 lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-[260px] border-r border-border bg-surface">
            <button
              className="absolute right-2 top-3 text-faint hover:text-text"
              onClick={() => setMobileOpen(false)}
              aria-label="Close menu"
            >
              <X size={16} />
            </button>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-bg/85 px-4 backdrop-blur lg:hidden">
          <Button variant="ghost" size="sm" onClick={() => setMobileOpen(true)} icon={<Menu size={15} />} aria-label="Open menu" />
          <span className="text-sm font-semibold">CRA Compliance OS</span>
          <div className="ml-auto">
            <CreditsPill compact />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

/** Page heading used by every app screen for consistent rhythm. */
export function PageHeader({
  title,
  description,
  action,
  breadcrumb,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1.5 text-xs text-faint">{breadcrumb}</div> : null}
        <h1 className="text-xl font-semibold tracking-tight text-text">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-muted leading-relaxed">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'danger' | 'warn' | 'good';
  icon?: ReactNode;
}) {
  const tones = {
    default: 'text-text',
    danger: 'text-critical',
    warn: 'text-partial',
    good: 'text-pass',
  } as const;
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted">{label}</span>
        {icon ? <span className="text-faint">{icon}</span> : null}
      </div>
      <div className={cx('mt-1.5 text-2xl font-semibold tracking-tight tabular-nums', tones[tone ?? 'default'])}>{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-faint">{hint}</div> : null}
    </div>
  );
}

export { Users };
