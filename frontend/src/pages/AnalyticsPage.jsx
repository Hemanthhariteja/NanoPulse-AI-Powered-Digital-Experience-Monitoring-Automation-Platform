import { Activity, Gauge, ShieldCheck, Timer } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BarsChart, TimeSeriesChart } from '../components/charts/Charts';
import { useChartColors } from '../components/charts/chartTheme';
import { AgentTypeBadge } from '../components/ui/Badge';
import { Card, CardHeader, PageHeader, StatCard } from '../components/ui/Card';
import { MetricBar } from '../components/ui/Data';
import { Select } from '../components/ui/Form';
import { EmptyState, ErrorState } from '../components/ui/States';
import { useRealtime } from '../context/RealtimeContext';
import { useApi, useDebouncedCallback } from '../hooks/useApi';
import { formatDuration, humanize } from '../lib/format';

export default function AnalyticsPage() {
  const c = useChartColors();
  const [range, setRange] = useState('24h');
  const health = useApi('/analytics/device-health', { params: { range } });
  const incidents = useApi('/analytics/incidents', { params: { range } });
  const remediation = useApi('/analytics/remediation', { params: { range } });
  const refresh = useDebouncedCallback(() => [health, incidents, remediation].forEach((q) => q.refetch({ silent: true })), 20000);
  useRealtime(['incident:created', 'incident:updated', 'remediation:updated'], refresh);

  const err = health.error || incidents.error || remediation.error;
  if (err && !health.data && !incidents.data) return <ErrorState message={err} onRetry={() => [health, incidents, remediation].forEach((q) => q.refetch())} />;

  const h = health.data;
  const i = incidents.data;
  const r = remediation.data;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Computed from stored telemetry, incidents and remediation records."
        actions={
          <Select aria-label="Time range" value={range} onChange={(e) => setRange(e.target.value)} className="w-40">
            <option value="1h">Last hour</option>
            <option value="6h">Last 6 hours</option>
            <option value="24h">Last 24 hours</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </Select>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Mean time to resolution" value={formatDuration(i?.mttrSeconds)} icon={Timer} tone="info" loading={!i} hint="Incidents resolved in range" />
        <StatCard label="Remediation success rate" value={r?.successRate == null ? '—' : `${r.successRate}%`} icon={ShieldCheck} tone="healthy" loading={!r} hint={r && `${r.finished} finished actions`} />
        <StatCard label="Fleet availability" value={h ? `${h.fleetAvailability}%` : ''} icon={Activity} tone="primary" loading={!h} hint="Share of 5-min slots with a heartbeat" />
        <StatCard label="Incidents in range" value={i ? i.trend.reduce((a, b) => a + b.created, 0) : ''} icon={Gauge} tone="warning" loading={!i} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Device health trend" subtitle="Share of telemetry samples per health state" />
          <TimeSeriesChart
            data={h?.trend}
            stacked
            series={[
              { key: 'healthyPct', label: 'Healthy', color: c.healthy },
              { key: 'warningPct', label: 'Warning', color: c.warning },
              { key: 'criticalPct', label: 'Critical', color: c.critical },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Fleet resource trend" subtitle="Average utilization across reporting devices" />
          <TimeSeriesChart
            data={h?.trend}
            series={[
              { key: 'avgCpu', label: 'CPU', color: c.chart1 },
              { key: 'avgRam', label: 'Memory', color: c.chart2 },
              { key: 'avgDisk', label: 'Disk', color: c.chart3 },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Incident trend" subtitle="Created vs. resolved per time bucket" />
          <BarsChart
            data={i?.trend}
            bars={[
              { key: 'created', label: 'Created', color: c.critical },
              { key: 'resolved', label: 'Resolved', color: c.healthy },
            ]}
          />
        </Card>
        <Card>
          <CardHeader title="Most common problems" />
          <BarsChart data={i?.commonProblems?.map((p) => ({ ...p, name: p.title }))} xKey="name" layout="vertical" timeAxis={false} bars={[{ key: 'count', label: 'Incidents', color: c.chart1 }]} height={Math.max(160, (i?.commonProblems?.length || 1) * 36)} />
        </Card>
        <Card>
          <CardHeader title="Remediation outcomes by action" />
          <BarsChart
            data={r?.byAction?.map((a) => ({ ...a, name: a.label || a.actionType }))}
            xKey="name"
            layout="vertical"
            timeAxis={false}
            stacked
            bars={[
              { key: 'succeeded', label: 'Succeeded', color: c.healthy },
              { key: 'failed', label: 'Failed / timed out', color: c.critical },
            ]}
            height={Math.max(160, (r?.byAction?.length || 1) * 40)}
          />
          {i?.mttrBySeverity?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-4 border-t border-border pt-4 text-sm">
              {i.mttrBySeverity.map((m) => (
                <span key={m.severity} className="text-muted">
                  MTTR {humanize(m.severity)}: <span className="tabular font-medium text-fg">{formatDuration(m.avgSeconds)}</span> ({m.resolved})
                </span>
              ))}
            </div>
          )}
        </Card>
        <Card padded={false}>
          <div className="p-5 pb-2">
            <CardHeader className="mb-0" title="Device availability" subtitle="Lowest first" />
          </div>
          {h?.availability?.length ? (
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {h.availability.map((d) => (
                <li key={d.deviceId} className="flex items-center gap-3 px-5 py-2.5">
                  <Link to={`/devices/${d.deviceId}`} className="w-44 truncate text-sm text-fg hover:underline">
                    {d.hostname}
                  </Link>
                  <AgentTypeBadge agentType={d.agentType} />
                  <MetricBar value={d.availability} warn={-1} crit={-1} className="flex-1 [&_div>div]:!bg-primary" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No devices" className="py-8" />
          )}
        </Card>
      </div>
    </>
  );
}
