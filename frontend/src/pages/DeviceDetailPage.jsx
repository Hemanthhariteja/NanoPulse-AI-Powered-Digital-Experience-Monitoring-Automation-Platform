import { ArrowDown, ArrowLeft, ArrowUp, Cpu, HardDrive, MemoryStick, Network, Wifi, WifiOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { TimeSeriesChart } from '../components/charts/Charts';
import { useChartColors } from '../components/charts/chartTheme';
import { RemediationItem, RequestActionButton, RunActionPicker, useCatalog } from '../components/remediation/Remediation';
import { AgentTypeBadge, IncidentStatusBadge, SeverityBadge, StatusBadge } from '../components/ui/Badge';
import { Card, CardHeader, PageHeader } from '../components/ui/Card';
import { KeyValue, MetricBar, Table, Tabs, Td, Th } from '../components/ui/Data';
import { Select } from '../components/ui/Form';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States';
import { useRealtime } from '../context/RealtimeContext';
import { useApi, useDebouncedCallback, useNow } from '../hooks/useApi';
import { useThresholds } from '../hooks/useThresholds';
import { formatBytes, formatDateTime, formatDuration, formatRate, timeAgo } from '../lib/format';

const MAX_LIVE = 90;

function Gauge({ icon: Icon, label, value, sub, warn, crit }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </span>
        <span className="tabular text-2xl font-semibold text-fg">{value == null ? '—' : `${value.toFixed(1)}%`}</span>
      </div>
      <MetricBar value={value} warn={warn} crit={crit} showLabel={false} className="mt-3" />
      <p className="mt-2 text-xs text-subtle">{sub}</p>
    </Card>
  );
}

export default function DeviceDetailPage() {
  const { id } = useParams();
  const t = useThresholds();
  const c = useChartColors();
  const now = useNow(3000);
  const catalog = useCatalog();
  const [range, setRange] = useState('1h');
  const [tab, setTab] = useState('incidents');

  const device = useApi(`/devices/${id}`);
  const live = useApi(`/telemetry/${id}`, { params: { limit: MAX_LIVE } });
  const history = useApi(`/telemetry/${id}/history`, { params: { range } });
  const refreshDevice = useDebouncedCallback(() => device.refetch({ silent: true }), 600);

  const deviceId = device.data?.deviceId;
  useRealtime('telemetry:update', (tm) => {
    if (tm.deviceId !== deviceId && tm.deviceId !== id) return;
    live.setData((d) => ({ data: [...(d?.data || []), { ...tm.metrics, status: tm.status, timestamp: tm.at }].slice(-MAX_LIVE) }));
    device.setData((d) => (d ? { ...d, status: tm.status, lastHeartbeat: tm.at, latest: { ...d.latest, ...tm.metrics } } : d));
    refreshDevice(); // picks up new process list
  });
  useRealtime(['incident:created', 'incident:updated', 'remediation:updated', 'device:updated', 'resync'], (p) => {
    if (!p || p.deviceId === deviceId) refreshDevice();
  });

  const liveSeries = useMemo(() => (live.data?.data || []).map((s) => ({ t: s.timestamp, cpu: s.cpuUsage, ram: s.ramUsage })), [live.data]);

  if (device.error && !device.data) return <ErrorState message={device.error} onRetry={device.refetch} />;
  if (!device.data) return <LoadingBlock label="Loading device…" />;
  const d = device.data;
  const L = d.latest || {};
  const openIncidents = d.incidents.filter((i) => i.isOpen);
  const recommended = [...new Set(openIncidents.flatMap((i) => i.recommendedActions.map((a) => `${i.incidentId}|${a}`)))];

  return (
    <>
      <PageHeader
        title={d.hostname}
        description={`${d.operatingSystem}${d.osVersion ? ` (${d.osVersion})` : ''} · ${d.deviceType}`}
        actions={<RunActionPicker deviceId={d.deviceId} onDone={refreshDevice} />}
      >
        <Link to="/devices" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Devices
        </Link>
        <div className="mb-2 flex flex-wrap gap-2">
          <StatusBadge status={d.status} />
          <AgentTypeBadge agentType={d.agentType} />
          {d.monitoringPaused && <span className="text-xs text-subtle">Monitoring paused (agent stopped)</span>}
        </div>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Gauge icon={Cpu} label="CPU" value={L.cpuUsage} warn={t.cpuWarning} crit={t.cpuCritical} sub={`${L.cpuCount ?? '—'} logical cores`} />
        <Gauge icon={MemoryStick} label="Memory" value={L.ramUsage} warn={t.ramWarning} crit={t.ramCritical} sub={`${formatBytes(L.ramAvailableBytes)} free of ${formatBytes(L.ramTotalBytes)}`} />
        <Gauge icon={HardDrive} label="System disk" value={L.diskUsage} warn={t.diskWarning} crit={t.diskCritical} sub={`${formatBytes(L.diskFreeBytes)} free of ${formatBytes(L.diskTotalBytes)}`} />
        <Card>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-[13px] font-medium text-muted">
              <Network className="h-4 w-4" aria-hidden /> Network
            </span>
            {L.networkConnected === false ? (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-critical">
                <WifiOff className="h-4 w-4" /> No connectivity
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm font-medium text-healthy">
                <Wifi className="h-4 w-4" /> Connected
              </span>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <span className="tabular flex items-center gap-1 text-fg">
              <ArrowUp className="h-3.5 w-3.5 text-muted" /> {formatRate(L.networkUpload)}
            </span>
            <span className="tabular flex items-center gap-1 text-fg">
              <ArrowDown className="h-3.5 w-3.5 text-muted" /> {formatRate(L.networkDownload)}
            </span>
          </div>
          <p className="mt-2 text-xs text-subtle">IP {d.ipAddress || '—'}</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Live CPU & memory" subtitle={`Last ${liveSeries.length} samples · updates as telemetry arrives`} />
          <TimeSeriesChart data={liveSeries} series={[{ key: 'cpu', label: 'CPU', color: c.chart1 }, { key: 'ram', label: 'Memory', color: c.chart2 }]} height={240} />
        </Card>
        <Card>
          <CardHeader title="Overview" />
          <KeyValue
            className="sm:grid-cols-1"
            items={[
              ['Device ID', <span className="font-mono text-xs">{d.deviceId}</span>],
              ['Uptime', formatDuration(L.uptimeSeconds)],
              ['Last heartbeat', `${timeAgo(d.lastHeartbeat, now)} (${formatDateTime(d.lastHeartbeat)})`],
              ['Registered', formatDateTime(d.registeredAt)],
              ['Agent', `${d.agentVersion || '—'} · ${d.architecture || ''}`],
              ['Active rules', d.activeRules?.length ? d.activeRules.join(', ') : 'none'],
            ]}
          />
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Health history"
          subtitle="Averaged per time bucket from stored telemetry"
          action={
            <Select aria-label="History range" value={range} onChange={(e) => setRange(e.target.value)} className="w-32">
              <option value="1h">Last hour</option>
              <option value="6h">Last 6 hours</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
            </Select>
          }
        />
        <TimeSeriesChart
          data={history.data?.points}
          series={[
            { key: 'cpuUsage', label: 'CPU', color: c.chart1 },
            { key: 'ramUsage', label: 'Memory', color: c.chart2 },
            { key: 'diskUsage', label: 'Disk', color: c.chart3 },
          ]}
          height={240}
        />
      </Card>

      {recommended.length > 0 && (
        <Card className="mt-4">
          <CardHeader title="Recommended actions" subtitle="From open incidents on this device. Requests require administrator approval." />
          <div className="flex flex-wrap gap-2">
            {recommended.map((key) => {
              const [incidentId, type] = key.split('|');
              const meta = catalog.find((a) => a.type === type);
              return <RequestActionButton key={key} incidentId={incidentId} actionType={type} label={`${meta?.label || type} (${incidentId})`} onDone={refreshDevice} />;
            })}
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader className="mb-0" title="Top processes" subtitle="By CPU, normalised to total machine capacity" />
          </div>
          {L.processes?.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Process</Th>
                  <Th>PID</Th>
                  <Th className="text-right">CPU</Th>
                  <Th className="text-right">Memory</Th>
                </tr>
              </thead>
              <tbody>
                {L.processes.map((p) => (
                  <tr key={p.pid}>
                    <Td className="font-medium text-fg">
                      {p.name} {p.isDemoApp && <span className="ml-1 rounded bg-primary-soft px-1.5 py-px text-[11px] text-primary-text">demo app</span>}
                    </Td>
                    <Td className="tabular text-muted">{p.pid}</Td>
                    <Td className="tabular text-right">{p.cpuPercent?.toFixed(1)}%</Td>
                    <Td className="tabular text-right text-muted">
                      {p.memoryPercent?.toFixed(1)}% {p.memoryBytes ? `· ${formatBytes(p.memoryBytes)}` : ''}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No process data reported" className="py-8" />
          )}
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-3">
            <CardHeader className="mb-0" title="Network interfaces" />
          </div>
          {L.interfaces?.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>Interface</Th>
                  <Th>Addresses</Th>
                  <Th>Link</Th>
                </tr>
              </thead>
              <tbody>
                {L.interfaces.map((n) => (
                  <tr key={n.name}>
                    <Td className="font-medium text-fg">{n.name}</Td>
                    <Td className="font-mono text-xs text-muted">{n.addresses?.join(', ')}</Td>
                    <Td className="text-muted">{n.isUp ? `Up${n.speedMbps ? ` · ${n.speedMbps} Mbps` : ''}` : 'Down'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <EmptyState title="No interface data reported" className="py-8" />
          )}
        </Card>
      </div>

      <Card className="mt-4">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'incidents', label: 'Incidents', count: d.incidents.length },
            { value: 'remediations', label: 'Remediations', count: d.remediations.length },
          ]}
        />
        {tab === 'incidents' &&
          (d.incidents.length ? (
            <ul className="divide-y divide-border">
              {d.incidents.map((i) => (
                <li key={i._id}>
                  <Link to={`/incidents/${i.incidentId}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-surface-2/40">
                    <SeverityBadge severity={i.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{i.title}</p>
                      <p className="text-xs text-muted">
                        {i.incidentId} · {formatDateTime(i.createdAt)} {i.resolvedAt && `· resolved in ${formatDuration(i.resolutionTimeSeconds)}`}
                      </p>
                    </div>
                    <IncidentStatusBadge status={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No incidents for this device" className="py-8" />
          ))}
        {tab === 'remediations' &&
          (d.remediations.length ? (
            <div className="space-y-3">
              {d.remediations.map((r) => (
                <RemediationItem key={r._id} rem={r} showContext={false} onChange={refreshDevice} />
              ))}
            </div>
          ) : (
            <EmptyState title="No remediation actions yet" className="py-8" />
          ))}
      </Card>
    </>
  );
}
