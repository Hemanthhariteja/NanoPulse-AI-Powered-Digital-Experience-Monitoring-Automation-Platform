import { AlertTriangle, CheckCircle2, Clock, HeartPulse, Monitor, ShieldAlert, Siren, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { DonutChart, TimeSeriesChart } from '../components/charts/Charts';
import { useChartColors } from '../components/charts/chartTheme';
import { AgentTypeBadge, IncidentStatusBadge, SeverityBadge, StatusBadge } from '../components/ui/Badge';
import { Card, CardHeader, PageHeader, StatCard } from '../components/ui/Card';
import { MetricBar } from '../components/ui/Data';
import { EmptyState, ErrorState } from '../components/ui/States';
import { useRealtime } from '../context/RealtimeContext';
import { useApi, useDebouncedCallback, useNow } from '../hooks/useApi';
import { formatDuration, timeAgo } from '../lib/format';

export default function DashboardPage() {
  const overview = useApi('/analytics/overview');
  const health = useApi('/analytics/device-health', { params: { range: '1h' } });
  const c = useChartColors();
  const now = useNow();

  const refreshOverview = useDebouncedCallback(() => overview.refetch({ silent: true }), 1200);
  const refreshCharts = useDebouncedCallback(() => health.refetch({ silent: true }), 15000);
  useRealtime(['device:updated', 'incident:created', 'incident:updated', 'resync'], refreshOverview);
  useRealtime('telemetry:update', (t) => {
    refreshCharts();
    // Patch the "recently active" list in place instead of reloading the dashboard.
    overview.setData((d) => {
      if (!d?.recentDevices?.some((x) => x.deviceId === t.deviceId)) return d;
      return {
        ...d,
        recentDevices: d.recentDevices.map((x) => (x.deviceId === t.deviceId ? { ...x, status: t.status, lastHeartbeat: t.at, latest: { ...x.latest, ...t.metrics } } : x)),
      };
    });
  });

  if (overview.error && !overview.data) return <ErrorState message={overview.error} onRetry={overview.refetch} />;
  const o = overview.data;
  const loading = overview.loading && !o;
  const trend = health.data?.trend ?? [];

  const healthDist = o
    ? [
        { name: 'Healthy', value: o.devices.healthy, color: c.healthy },
        { name: 'Warning', value: o.devices.warning, color: c.warning },
        { name: 'Critical', value: o.devices.critical, color: c.critical },
        { name: 'Offline', value: o.devices.offline, color: c.offline },
      ]
    : [];
  const sevDist = o
    ? [
        { name: 'Critical', value: o.incidents.openBySeverity.CRITICAL, color: c.critical },
        { name: 'Warning', value: o.incidents.openBySeverity.WARNING, color: c.warning },
        { name: 'Info', value: o.incidents.openBySeverity.INFO, color: c.info },
      ]
    : [];

  return (
    <>
      <PageHeader
        title="Fleet overview"
        description={o ? `${o.devices.total} endpoints · ${o.devices.real} real, ${o.devices.simulated} simulated` : 'Loading fleet status…'}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard loading={loading} label="Registered devices" value={o?.devices.total} icon={Monitor} tone="primary" hint={o && `${o.devices.offline} offline · ${o.devices.pending} pending`} />
        <StatCard loading={loading} label="Healthy" value={o?.devices.healthy} icon={CheckCircle2} tone="healthy" />
        <StatCard loading={loading} label="Warning" value={o?.devices.warning} icon={AlertTriangle} tone="warning" />
        <StatCard loading={loading} label="Critical" value={o?.devices.critical} icon={ShieldAlert} tone="critical" />
        <StatCard loading={loading} label="Active incidents" value={o?.incidents.active} icon={Siren} tone="critical" hint={o && `${o.remediation.pendingApprovals} remediation(s) awaiting approval`} />
        <StatCard loading={loading} label="Resolved incidents" value={o?.incidents.resolved} icon={CheckCircle2} tone="healthy" />
        <StatCard loading={loading} label="Avg. resolution time" value={formatDuration(o?.incidents.avgResolutionSeconds)} icon={Timer} tone="info" hint="Creation → resolution, all resolved incidents" />
        <StatCard loading={loading} label="Device health" value={o ? `${o.devices.healthPercentage}%` : ''} icon={HeartPulse} tone="primary" hint="Healthy share of monitored devices" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="CPU utilization" subtitle={`Fleet average, last hour · now ${o?.fleet.avgCpu ?? '—'}%`} />
          <TimeSeriesChart data={trend} series={[{ key: 'avgCpu', label: 'Avg CPU', color: c.chart1 }]} height={220} />
        </Card>
        <Card>
          <CardHeader title="Memory utilization" subtitle={`Fleet average, last hour · now ${o?.fleet.avgRam ?? '—'}%`} />
          <TimeSeriesChart data={trend} series={[{ key: 'avgRam', label: 'Avg memory', color: c.chart2 }]} height={220} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Device health distribution" subtitle="Current status of every registered device" />
          <DonutChart data={healthDist} centerLabel="devices" />
        </Card>
        <Card>
          <CardHeader title="Open incidents by severity" />
          <DonutChart data={sevDist} centerLabel="open" />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recent incidents" action={<Link className="text-sm font-medium text-primary-text hover:underline" to="/incidents">View all</Link>} />
          </div>
          {o?.recentIncidents?.length ? (
            <ul className="divide-y divide-border">
              {o.recentIncidents.map((i) => (
                <li key={i._id}>
                  <Link to={`/incidents/${i.incidentId}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                    <SeverityBadge severity={i.severity} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{i.title}</p>
                      <p className="truncate text-xs text-muted">
                        {i.incidentId} · {i.deviceHostname} · {timeAgo(i.createdAt, now)}
                      </p>
                    </div>
                    <IncidentStatusBadge status={i.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No incidents yet" description="Incidents appear automatically when telemetry breaches a threshold." />
          )}
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-0">
            <CardHeader title="Recently active devices" action={<Link className="text-sm font-medium text-primary-text hover:underline" to="/devices">All devices</Link>} />
          </div>
          {o?.recentDevices?.length ? (
            <ul className="divide-y divide-border">
              {o.recentDevices.map((d) => (
                <li key={d.deviceId}>
                  <Link to={`/devices/${d.deviceId}`} className="block px-5 py-3 hover:bg-surface-2/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-fg">{d.hostname}</span>
                      <StatusBadge status={d.status} />
                    </div>
                    <div className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span>CPU</span>
                      <MetricBar value={d.latest?.cpuUsage} />
                      <span>RAM</span>
                      <MetricBar value={d.latest?.ramUsage} warn={75} crit={90} />
                    </div>
                    <p className="mt-1.5 flex items-center gap-2 text-[11px] text-subtle">
                      <Clock className="h-3 w-3" aria-hidden /> {timeAgo(d.lastHeartbeat, now)} <AgentTypeBadge agentType={d.agentType} />
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No devices reporting" description="Start the Python agent or the simulator to see devices here." />
          )}
        </Card>
      </div>
    </>
  );
}
