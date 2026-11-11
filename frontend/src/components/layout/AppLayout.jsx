import {
  Activity,
  BarChart3,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Settings,
  Siren,
  Sun,
  Workflow,
  X,
} from 'lucide-react';
import { Suspense, useState } from 'react';
import { LoadingBlock } from '../ui/States';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRealtime, useRealtimeStatus } from '../../context/RealtimeContext';
import { useTheme } from '../../context/ThemeContext';
import { useToast } from '../../context/ToastContext';
import { useApi, useDebouncedCallback } from '../../hooks/useApi';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/devices', label: 'Devices', icon: Monitor },
  { to: '/incidents', label: 'Incidents', icon: Siren, badge: 'incidents' },
  { to: '/automation', label: 'Automation', icon: Workflow, badge: 'approvals' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/simulation', label: 'Simulation', icon: FlaskConical },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function ConnectionIndicator() {
  const status = useRealtimeStatus();
  const map = {
    connected: ['bg-healthy', 'Live'],
    connecting: ['bg-warning', 'Connecting'],
    reconnecting: ['bg-warning', 'Reconnecting'],
    disconnected: ['bg-offline', 'Offline'],
  };
  const [dot, label] = map[status] || map.disconnected;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-medium text-muted" title={`Realtime connection: ${status}`} role="status">
      <span className={`h-2 w-2 rounded-full ${dot} ${status === 'connected' ? 'live-dot' : ''}`} aria-hidden />
      {label}
    </span>
  );
}

function Sidebar({ counts, onNavigate }) {
  return (
    <nav className="flex h-full flex-col" aria-label="Main">
      <Link to="/" className="flex items-center gap-2.5 px-5 py-5" onClick={onNavigate}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white shadow-card">
          <Activity className="h-4.5 w-4.5" aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] leading-tight font-semibold text-fg">NanoPulse</span>
          <span className="block text-[11px] text-subtle">Experience monitoring</span>
        </span>
      </Link>
      <ul className="flex-1 space-y-0.5 px-3">
        {NAV.map(({ to, label, icon: Icon, end, badge }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-primary-soft text-primary-text' : 'text-muted hover:bg-surface-2 hover:text-fg'
                }`
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="flex-1">{label}</span>
              {badge && counts[badge] > 0 && (
                <span className={`tabular rounded-full px-1.5 py-px text-[11px] font-semibold ${badge === 'approvals' ? 'bg-warning-soft text-warning' : 'bg-critical-soft text-critical'}`}>
                  {counts[badge]}
                </span>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
      <p className="px-5 py-4 text-[11px] leading-relaxed text-subtle">Independent educational project inspired by DXA concepts.</p>
    </nav>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const { resolved, setTheme } = useTheme();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const overview = useApi('/analytics/overview');
  const refresh = useDebouncedCallback(() => overview.refetch({ silent: true }), 1500);

  useRealtime(['incident:created', 'incident:updated', 'remediation:updated', 'resync'], refresh);
  useRealtime('incident:created', (inc) => {
    if (inc.severity === 'CRITICAL' && !inc.simulated) toast.warning(`Critical: ${inc.title}`, `${inc.deviceHostname} · ${inc.incidentId}`);
  });
  useRealtime('remediation:updated', (rem) => {
    if (rem.executionStatus === 'SUCCEEDED') toast.success(`${rem.actionId} succeeded`, rem.executionResult?.summary);
    if (rem.executionStatus === 'FAILED' || rem.executionStatus === 'TIMED_OUT') toast.error(`${rem.actionId} ${rem.executionStatus.toLowerCase().replace('_', ' ')}`, rem.executionResult?.error || rem.executionResult?.summary);
  });

  const counts = {
    incidents: overview.data?.incidents?.active ?? 0,
    approvals: overview.data?.remediation?.pendingApprovals ?? 0,
  };

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface lg:block">
        <Sidebar counts={counts} />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
          <aside className="relative h-full w-64 border-r border-border bg-surface shadow-pop">
            <button className="absolute top-5 right-3 rounded p-1 text-muted" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar counts={counts} onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur sm:px-6">
          <button className="rounded-md p-1.5 text-muted hover:bg-surface-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <ConnectionIndicator />
          <button
            className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            aria-label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} theme`}
          >
            {resolved === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <div className="hidden h-6 w-px bg-border sm:block" />
          <div className="hidden text-right sm:block">
            <p className="text-sm leading-tight font-medium text-fg">{user?.name}</p>
            <p className="text-[11px] text-subtle capitalize">{user?.role}</p>
          </div>
          <button className="rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-fg" onClick={logout} aria-label="Sign out" title="Sign out">
            <LogOut className="h-4 w-4" />
          </button>
        </header>
        <main key={location.pathname} className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-[1400px]">
            <Suspense fallback={<LoadingBlock />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
