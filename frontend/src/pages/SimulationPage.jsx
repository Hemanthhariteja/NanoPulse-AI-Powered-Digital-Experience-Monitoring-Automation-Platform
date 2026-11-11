import { Cpu, FlaskConical, HardDrive, MemoryStick, Play, RotateCcw, Square, Trash2, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, PageHeader } from '../components/ui/Card';
import { MetricBar } from '../components/ui/Data';
import { Input, Select } from '../components/ui/Form';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { useApi, useDebouncedCallback } from '../hooks/useApi';
import { useThresholds } from '../hooks/useThresholds';
import { api, errorMessage } from '../lib/api';
import { formatDateTime, humanize } from '../lib/format';

const SCENARIOS = [
  { id: 'high_cpu', label: 'High CPU', icon: Cpu, help: 'Runaway demo worker pushes CPU above 85%' },
  { id: 'high_ram', label: 'High memory', icon: MemoryStick, help: 'Demo worker leaks memory, RAM above 90%' },
  { id: 'low_disk', label: 'Low disk space', icon: HardDrive, help: 'Temporary files fill the disk above 90%' },
  { id: 'network_down', label: 'Network disconnect', icon: WifiOff, help: 'External connectivity probes fail' },
];

export default function SimulationPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const t = useThresholds();
  const state = useApi('/simulation');
  const devices = useApi('/devices', { params: { agentType: 'simulated', limit: 100, sort: 'hostname' } });
  const [count, setCount] = useState(20);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const refreshDevices = useDebouncedCallback(() => devices.refetch({ silent: true }), 800);

  useRealtime('simulation:state', (s) => state.setData(s));
  useRealtime(['device:updated', 'resync'], refreshDevices);
  useRealtime('telemetry:update', (tm) => {
    if (!tm.simulated) return;
    devices.setData((d) => (d ? { ...d, data: d.data.map((x) => (x.deviceId === tm.deviceId ? { ...x, status: tm.status, latest: { ...x.latest, ...tm.metrics } } : x)) } : d));
  });

  const call = async (key, path, body, success) => {
    setBusy(key);
    try {
      const r = await api.post(`/simulation/${path}`, body);
      if (r.data.running !== undefined) state.setData(r.data);
      toast.success(typeof success === 'function' ? success(r.data) : success);
      refreshDevices();
      return r.data;
    } catch (err) {
      toast.error('Simulation request failed', errorMessage(err));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const inject = (scenario) =>
    call(scenario, 'scenario', { scenario, ...(target ? { deviceIds: [target] } : { count: 1 }) }, (r) => `${humanize(scenario)} → ${r.devices.map((d) => d.hostname).join(', ')}`);

  if (state.error && !state.data) return <ErrorState message={state.error} onRetry={state.refetch} />;
  if (!state.data) return <LoadingBlock />;
  const s = state.data;
  const scenarioByDevice = Object.fromEntries((s.scenarios || []).map((x) => [x.deviceId, x.scenario]));

  return (
    <>
      <PageHeader
        title="Simulation"
        description="Virtual endpoints whose telemetry goes through the real ingestion, diagnostics, incident and remediation pipeline. Always labelled “Simulated”."
      />
      {!isAdmin && <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Only administrators can control the simulator.</p>}

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        <Card>
          <CardHeader icon={FlaskConical} title="Simulator" subtitle={s.running ? `Running since ${formatDateTime(s.startedAt)}` : 'Stopped'} />
          <div className="mb-4 flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${s.running ? 'live-dot bg-healthy' : 'bg-offline'}`} aria-hidden />
            <span className="text-sm text-fg">{s.running ? `${s.deviceCount} virtual devices · every ${s.intervalMs / 1000}s` : 'No virtual devices reporting'}</span>
          </div>
          {s.running ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={Square} disabled={!isAdmin} loading={busy === 'stop'} onClick={() => call('stop', 'stop', {}, 'Simulation stopped')}>
                Stop simulation
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <Input label="Devices" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} className="w-24" />
              <Button icon={Play} disabled={!isAdmin || count < 1 || count > 100} loading={busy === 'start'} onClick={() => call('start', 'start', { count }, (r) => `Started ${r.deviceCount} virtual devices`)}>
                Start simulation
              </Button>
            </div>
          )}
          <Button variant="danger-ghost" size="sm" icon={Trash2} className="mt-4" disabled={!isAdmin || busy} onClick={() => setResetOpen(true)}>
            Delete all simulated data
          </Button>
        </Card>

        <Card>
          <CardHeader title="Inject a scenario" subtitle="Applied on the next simulator tick; incidents follow automatically." />
          <Select label="Target" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!s.running} className="mb-4 max-w-sm">
            <option value="">A random healthy device</option>
            {devices.data?.data.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.hostname}
              </option>
            ))}
          </Select>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {SCENARIOS.map(({ id, label, icon: Icon, help }) => (
              <button
                key={id}
                disabled={!s.running || !isAdmin || Boolean(busy)}
                onClick={() => inject(id)}
                className="rounded-xl border border-border p-3.5 text-left transition-colors hover:border-primary hover:bg-primary-soft/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-5 w-5 text-primary-text" aria-hidden />
                <p className="mt-2 text-sm font-medium text-fg">{label}</p>
                <p className="mt-0.5 text-xs text-muted">{help}</p>
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={RotateCcw} disabled={!s.running || !isAdmin || !s.scenarios?.length} loading={busy === 'restore'} onClick={() => call('restore', 'scenario', { scenario: 'restore', ...(target ? { deviceIds: [target] } : {}) }, 'Normal health restored')}>
              Restore normal health{target ? '' : ' (all)'}
            </Button>
            {s.scenarios?.map((x) => (
              <span key={x.deviceId} className="rounded-full bg-warning-soft px-2.5 py-1 text-xs text-warning">
                {x.hostname}: {humanize(x.scenario)}
              </span>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Virtual endpoints" subtitle={`${devices.data?.pagination.total ?? 0} simulated devices`} />
        {devices.data?.data.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {devices.data.data.map((d) => (
              <Link key={d.deviceId} to={`/devices/${d.deviceId}`} className="rounded-xl border border-border p-3 transition-colors hover:border-border-strong hover:bg-surface-2/50">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-fg">{d.hostname}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div className="mt-2.5 grid grid-cols-[34px_1fr] items-center gap-x-2 gap-y-1 text-[11px] text-muted">
                  <span>CPU</span>
                  <MetricBar value={d.latest?.cpuUsage} warn={t.cpuWarning} crit={t.cpuCritical} />
                  <span>RAM</span>
                  <MetricBar value={d.latest?.ramUsage} warn={t.ramWarning} crit={t.ramCritical} />
                  <span>Disk</span>
                  <MetricBar value={d.latest?.diskUsage} warn={t.diskWarning} crit={t.diskCritical} />
                </div>
                {scenarioByDevice[d.deviceId] && <p className="mt-2 text-[11px] font-medium text-warning">Scenario: {humanize(scenarioByDevice[d.deviceId])}</p>}
                {d.latest?.networkConnected === false && <p className="mt-1 text-[11px] text-critical">No external connectivity</p>}
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState icon={FlaskConical} title="No simulated devices" description="Start the simulation to create a virtual fleet." />
        )}
      </Card>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Delete all simulated data?"
        description="Removes every simulated device with its telemetry, incidents and remediations. Real devices are not affected."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy === 'reset'}
              onClick={async () => {
                await call('reset', 'reset', {}, (r) => `Removed ${r.devices} devices, ${r.incidents} incidents`);
                setResetOpen(false);
                state.refetch({ silent: true });
              }}
            >
              Delete simulated data
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">This cannot be undone.</p>
      </Modal>
    </>
  );
}
