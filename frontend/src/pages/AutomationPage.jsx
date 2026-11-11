import { CheckCircle2, Clock, Hourglass, ShieldCheck, Workflow, XCircle } from 'lucide-react';
import { useState } from 'react';
import { RemediationItem, RiskBadge, useCatalog } from '../components/remediation/Remediation';
import { Badge } from '../components/ui/Badge';
import { Card, CardHeader, PageHeader, StatCard } from '../components/ui/Card';
import { Pagination, Tabs } from '../components/ui/Data';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States';
import { useRealtime } from '../context/RealtimeContext';
import { useApi, useDebouncedCallback } from '../hooks/useApi';

const VIEWS = [
  { value: 'pending', label: 'Pending approval', empty: 'No actions are waiting for approval.' },
  { value: 'approved', label: 'Approved & in progress', empty: 'Nothing approved or running right now.' },
  { value: 'history', label: 'Execution history', empty: 'No actions have finished yet.' },
];

export default function AutomationPage() {
  const catalog = useCatalog();
  const [view, setView] = useState('pending');
  const [page, setPage] = useState(1);
  const list = useApi('/remediations', { params: { view, page, limit: 15 } });
  const pending = useApi('/remediations', { params: { view: 'pending', limit: 1 } });
  const active = useApi('/remediations', { params: { view: 'approved', limit: 1 } });
  const stats = useApi('/analytics/remediation', { params: { range: '30d' } });

  const refresh = useDebouncedCallback(() => {
    list.refetch({ silent: true });
    pending.refetch({ silent: true });
    active.refetch({ silent: true });
    stats.refetch({ silent: true });
  }, 400);
  useRealtime(['remediation:updated', 'resync'], (rem) => {
    // Patch the visible row immediately, then reconcile counts and tab membership.
    if (rem?.actionId) list.setData((d) => (d ? { ...d, data: d.data.map((r) => (r.actionId === rem.actionId ? rem : r)) } : d));
    refresh();
  });

  const s = stats.data;
  const current = VIEWS.find((v) => v.value === view);

  return (
    <>
      <PageHeader title="Automation center" description="Every remediation is allowlisted, approved by an administrator, executed with a timeout, and logged." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard label="Awaiting approval" value={pending.data?.pagination.total ?? '—'} icon={Hourglass} tone="warning" />
        <StatCard label="Approved / running" value={active.data?.pagination.total ?? '—'} icon={Clock} tone="info" />
        <StatCard label="Succeeded (30d)" value={s?.byStatus.SUCCEEDED ?? 0} icon={CheckCircle2} tone="healthy" />
        <StatCard label="Failed / timed out (30d)" value={(s?.byStatus.FAILED ?? 0) + (s?.byStatus.TIMED_OUT ?? 0)} icon={XCircle} tone="critical" />
        <StatCard label="Success rate (30d)" value={s?.successRate == null ? '—' : `${s.successRate}%`} icon={ShieldCheck} tone="primary" hint={s ? `${s.finished} finished actions` : undefined} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card>
          <Tabs
            value={view}
            onChange={(v) => {
              setView(v);
              setPage(1);
            }}
            tabs={VIEWS.map((v) => ({ ...v, count: v.value === 'pending' ? pending.data?.pagination.total : v.value === 'approved' ? active.data?.pagination.total : undefined }))}
          />
          {list.error && !list.data ? (
            <ErrorState message={list.error} onRetry={list.refetch} />
          ) : list.loading && !list.data ? (
            <LoadingBlock />
          ) : list.data?.data.length ? (
            <>
              <div className="space-y-3">
                {list.data.data.map((r) => (
                  <RemediationItem key={r._id} rem={r} onChange={refresh} />
                ))}
              </div>
              <div className="-mx-5 mt-4 -mb-5">
                <Pagination pagination={list.data.pagination} onPage={setPage} />
              </div>
            </>
          ) : (
            <EmptyState icon={Workflow} title={current.empty} description="Request actions from an incident or device page." />
          )}
        </Card>

        <Card>
          <CardHeader title="Available actions" subtitle="The complete allowlist. The agent rejects anything else." />
          <ul className="space-y-3">
            {catalog.map((a) => (
              <li key={a.type} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">{a.label}</span>
                  <RiskBadge risk={a.riskLevel} />
                  {a.readOnly && <Badge>Read-only</Badge>}
                </div>
                <p className="mt-1 text-[13px] text-muted">{a.description}</p>
                <p className="mt-1.5 font-mono text-[11px] text-subtle">
                  {a.type} · timeout {a.timeoutSeconds}s{a.requires ? ` · requires agent capability "${a.requires}"` : ''}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
