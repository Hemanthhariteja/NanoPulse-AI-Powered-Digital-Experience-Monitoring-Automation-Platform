import { Monitor, Moon, Save, Search, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AgentSetup } from '../components/AgentSetup';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, PageHeader } from '../components/ui/Card';
import { Pagination, Table, Tabs, Td, Th } from '../components/ui/Data';
import { Input, Toggle } from '../components/ui/Form';
import { EmptyState, ErrorState, InlineError, LoadingBlock } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useApi, useDebouncedValue } from '../hooks/useApi';
import { invalidateThresholds } from '../hooks/useThresholds';
import { api, errorMessage } from '../lib/api';
import { formatDateTime } from '../lib/format';

const THRESHOLDS = [
  ['cpu', 'CPU utilization'],
  ['ram', 'Memory utilization'],
  ['disk', 'Disk utilization'],
];

function ProfileTab() {
  const { user, setUser } = useAuth();
  const { preference, setTheme } = useTheme();
  const toast = useToast();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);

  const save = async (body) => {
    setSaving(true);
    try {
      const r = await api.patch('/auth/me', body);
      setUser(r.data.user);
      toast.success('Profile saved');
    } catch (err) {
      toast.error('Could not save profile', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const chooseTheme = (t) => {
    setTheme(t);
    save({ preferences: { theme: t } });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="User profile" />
        <div className="space-y-4">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Email" value={user.email} disabled />
          <Input label="Role" value={user.role} disabled className="capitalize" hint={user.role === 'admin' ? 'Can approve and execute remediations, manage devices and settings.' : 'Can investigate incidents and request remediations.'} />
          <Button icon={Save} loading={saving} disabled={name.trim().length < 2 || name === user.name} onClick={() => save({ name: name.trim() })}>
            Save profile
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title="Theme" subtitle="Saved on this browser and to your profile" />
        <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Theme">
          {[
            ['light', 'Light', Sun],
            ['dark', 'Dark', Moon],
            ['system', 'System', Monitor],
          ].map(([v, label, Icon]) => (
            <button
              key={v}
              role="radio"
              aria-checked={preference === v}
              onClick={() => chooseTheme(v)}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors ${preference === v ? 'border-primary bg-primary-soft text-primary-text' : 'border-border text-muted hover:border-border-strong'}`}
            >
              <Icon className="h-5 w-5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}

function ThresholdsTab({ settings, onSaved, isAdmin }) {
  const toast = useToast();
  const [form, setForm] = useState(settings.thresholds);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(settings.thresholds), [settings]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value === '' ? '' : Number(e.target.value) }));
  const validate = () => {
    for (const [k, label] of THRESHOLDS) {
      const w = form[`${k}Warning`];
      const c = form[`${k}Critical`];
      if (![w, c].every((v) => typeof v === 'number' && v >= 1 && v <= 100)) return `${label}: values must be between 1 and 100`;
      if (w >= c) return `${label}: warning must be lower than critical`;
    }
    if (!(form.networkThroughputMBps >= 1)) return 'Network throughput limit must be at least 1 MB/s';
    return '';
  };

  const save = async () => {
    const v = validate();
    setError(v);
    if (v) return;
    setSaving(true);
    try {
      const r = await api.patch('/settings', { thresholds: form });
      onSaved(r.data);
      invalidateThresholds(r.data.thresholds);
      toast.success('Thresholds updated', 'New telemetry is evaluated against them immediately.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Monitoring thresholds" subtitle="Values at or above warning raise a warning; values above critical raise a critical incident." />
      <div className="max-w-2xl space-y-4">
        <InlineError message={error} />
        {THRESHOLDS.map(([k, label]) => (
          <div key={k} className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_140px] sm:items-end">
            <p className="text-sm font-medium text-fg sm:pb-2">{label}</p>
            <Input label="Warning (%)" type="number" min={1} max={100} value={form[`${k}Warning`]} onChange={set(`${k}Warning`)} disabled={!isAdmin} />
            <Input label="Critical (%)" type="number" min={1} max={100} value={form[`${k}Critical`]} onChange={set(`${k}Critical`)} disabled={!isAdmin} />
          </div>
        ))}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_140px] sm:items-end">
          <p className="text-sm font-medium text-fg sm:pb-2">Sustained network throughput</p>
          <Input label="Limit (MB/s)" type="number" min={1} value={form.networkThroughputMBps} onChange={set('networkThroughputMBps')} disabled={!isAdmin} hint="3 consecutive samples" />
        </div>
        {isAdmin ? (
          <Button icon={Save} loading={saving} onClick={save}>
            Save thresholds
          </Button>
        ) : (
          <p className="text-sm text-subtle">Only administrators can change thresholds.</p>
        )}
      </div>
    </Card>
  );
}

function AuditLogTable() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const q = useDebouncedValue(search, 300);
  const { data, error, loading, refetch } = useApi('/audit', { params: { page, limit: 20, ...(q && { search: q }) } });
  return (
    <Card padded={false}>
      <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <CardHeader className="mb-0" title="Audit log" subtitle="Logins, approvals, executions, settings and device changes" />
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-subtle" aria-hidden />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search action, actor or entity"
            aria-label="Search audit log"
            className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-subtle focus:border-primary focus:outline-none"
          />
        </div>
      </div>
      {error && !data ? (
        <ErrorState message={error} onRetry={refetch} />
      ) : loading && !data ? (
        <LoadingBlock />
      ) : data?.data.length ? (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((a) => (
                <tr key={a._id}>
                  <Td className="tabular whitespace-nowrap text-muted">{formatDateTime(a.timestamp)}</Td>
                  <Td className="whitespace-nowrap">
                    <span className="text-fg">{a.actorName}</span> <span className="text-xs text-subtle">({a.actorType})</span>
                  </Td>
                  <Td className="font-mono text-xs whitespace-nowrap text-fg">{a.action}</Td>
                  <Td className="font-mono text-xs whitespace-nowrap text-muted">
                    {a.entityType}
                    {a.entityId ? ` · ${a.entityId}` : ''}
                  </Td>
                  <Td className="max-w-md truncate font-mono text-[11px] text-subtle" title={a.details ? JSON.stringify(a.details) : ''}>
                    {a.details ? JSON.stringify(a.details) : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination pagination={data.pagination} onPage={setPage} />
        </>
      ) : (
        <EmptyState title="No audit entries" />
      )}
    </Card>
  );
}

function SecurityTab({ settings, onSaved, isAdmin }) {
  const toast = useToast();
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const num = (k) => (e) => setForm((f) => ({ ...f, [k]: Number(e.target.value) }));

  const save = async () => {
    setSaving(true);
    try {
      const { telemetryIntervalSeconds, offlineAfterSeconds, autoResolveAfterSamples, autoRequestRemediation, auditRetentionDays } = form;
      const r = await api.patch('/settings', { telemetryIntervalSeconds, offlineAfterSeconds, autoResolveAfterSamples, autoRequestRemediation, auditRetentionDays });
      onSaved(r.data);
      toast.success('Settings saved');
    } catch (err) {
      toast.error('Could not save settings', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Monitoring, security & audit" subtitle={settings.updatedBy ? `Last changed by ${settings.updatedBy} · ${formatDateTime(settings.updatedAt)}` : undefined} />
        <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
          <Input label="Agent telemetry interval (s)" type="number" min={5} max={300} value={form.telemetryIntervalSeconds} onChange={num('telemetryIntervalSeconds')} disabled={!isAdmin} hint="Advertised to agents at registration" />
          <Input label="Mark offline after (s)" type="number" min={15} value={form.offlineAfterSeconds} onChange={num('offlineAfterSeconds')} disabled={!isAdmin} hint="At least 2× the telemetry interval" />
          <Input label="Auto-resolve after clean samples" type="number" min={1} max={20} value={form.autoResolveAfterSamples} onChange={num('autoResolveAfterSamples')} disabled={!isAdmin} />
          <Input label="Audit log retention (days)" type="number" min={7} value={form.auditRetentionDays} onChange={num('auditRetentionDays')} disabled={!isAdmin} />
          <div className="sm:col-span-2">
            <Toggle
              checked={Boolean(form.autoRequestRemediation)}
              onChange={(v) => setForm((f) => ({ ...f, autoRequestRemediation: v }))}
              disabled={!isAdmin}
              label="Auto-request the first recommended remediation"
              description="Creates a request when an incident opens. It still requires administrator approval before anything executes."
            />
          </div>
        </div>
        {isAdmin && (
          <Button icon={Save} className="mt-5" loading={saving} onClick={save}>
            Save settings
          </Button>
        )}
      </Card>
      <AuditLogTable />
    </div>
  );
}

export default function SettingsPage() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('profile');
  const { data, error, loading, refetch, setData } = useApi('/settings');

  return (
    <>
      <PageHeader title="Settings" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Profile & theme' },
          { value: 'thresholds', label: 'Monitoring thresholds' },
          { value: 'agent', label: 'Agent setup' },
          { value: 'security', label: 'Security & audit' },
        ]}
      />
      {tab === 'profile' && <ProfileTab />}
      {tab === 'agent' && (
        <Card>
          <CardHeader title="Agent configuration" subtitle="Monitor a real Windows endpoint" />
          <AgentSetup />
        </Card>
      )}
      {(tab === 'thresholds' || tab === 'security') &&
        (error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : loading && !data ? (
          <LoadingBlock />
        ) : tab === 'thresholds' ? (
          <ThresholdsTab settings={data} onSaved={setData} isAdmin={isAdmin} />
        ) : (
          <SecurityTab settings={data} onSaved={setData} isAdmin={isAdmin} />
        ))}
    </>
  );
}
