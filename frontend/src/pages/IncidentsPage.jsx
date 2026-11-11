import { Search, Siren } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { IncidentStatusBadge, SeverityBadge } from '../components/ui/Badge';
import { Card, PageHeader } from '../components/ui/Card';
import { Pagination, Table, Td, Th } from '../components/ui/Data';
import { Select } from '../components/ui/Form';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States';
import { useRealtime } from '../context/RealtimeContext';
import { useApi, useDebouncedCallback, useDebouncedValue, useNow } from '../hooks/useApi';
import { formatDuration, humanize, timeAgo } from '../lib/format';

export const STATUS_OPTIONS = ['OPEN', 'NEW', 'INVESTIGATING', 'PENDING_APPROVAL', 'REMEDIATION_IN_PROGRESS', 'RESOLVED', 'FAILED'];

export function IncidentFilters({ filters, onChange }) {
  const set = (k) => (e) => onChange({ ...filters, [k]: e.target.value });
  return (
    <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-end">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-subtle" aria-hidden />
        <input
          value={filters.search}
          onChange={set('search')}
          placeholder="Search ID, problem, device or root cause"
          aria-label="Search incidents"
          className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-subtle focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
        />
      </div>
      <Select aria-label="Filter by status" value={filters.status} onChange={set('status')} className="md:w-52">
        <option value="">All statuses</option>
        {STATUS_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s === 'OPEN' ? 'Open (unresolved)' : humanize(s)}
          </option>
        ))}
      </Select>
      <Select aria-label="Filter by severity" value={filters.severity} onChange={set('severity')} className="md:w-40">
        <option value="">All severities</option>
        <option value="CRITICAL">Critical</option>
        <option value="WARNING">Warning</option>
        <option value="INFO">Info</option>
      </Select>
      <Select aria-label="Filter by source" value={filters.simulated} onChange={set('simulated')} className="md:w-40">
        <option value="">All devices</option>
        <option value="false">Real devices</option>
        <option value="true">Simulated</option>
      </Select>
      <Select aria-label="Sort incidents" value={filters.sort} onChange={set('sort')} className="md:w-44">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="severity">Severity: high → low</option>
        <option value="-severity">Severity: low → high</option>
      </Select>
    </div>
  );
}

export default function IncidentsPage() {
  const navigate = useNavigate();
  const now = useNow();
  const [filters, setFilters] = useState({ search: '', status: 'OPEN', severity: '', simulated: '', sort: 'severity' });
  const [page, setPage] = useState(1);
  const search = useDebouncedValue(filters.search, 300);
  const params = {
    page,
    limit: 25,
    sort: filters.sort,
    ...(search && { search }),
    ...(filters.status && { status: filters.status }),
    ...(filters.severity && { severity: filters.severity }),
    ...(filters.simulated && { simulated: filters.simulated }),
  };
  const { data, error, loading, refetch } = useApi('/incidents', { params });
  const refresh = useDebouncedCallback(() => refetch({ silent: true }), 800);
  useRealtime(['incident:created', 'incident:updated', 'resync'], refresh);

  return (
    <>
      <PageHeader title="Incidents" description="Detected automatically from telemetry. Each incident is unique per device and problem until resolved." />
      <Card padded={false}>
        <IncidentFilters
          filters={filters}
          onChange={(f) => {
            setFilters(f);
            setPage(1);
          }}
        />
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : loading && !data ? (
          <LoadingBlock label="Loading incidents…" />
        ) : data?.data.length ? (
          <>
            <Table>
              <thead>
                <tr>
                  <Th>Incident</Th>
                  <Th>Device</Th>
                  <Th>Problem</Th>
                  <Th>Severity</Th>
                  <Th className="min-w-64">Possible root cause</Th>
                  <Th className="min-w-56">Recommended solution</Th>
                  <Th>Status</Th>
                  <Th>Created</Th>
                  <Th>Resolution</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((i) => (
                  <tr key={i._id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => navigate(`/incidents/${i.incidentId}`)}>
                    <Td className="font-mono text-xs whitespace-nowrap">
                      <Link to={`/incidents/${i.incidentId}`} onClick={(e) => e.stopPropagation()} className="text-primary-text hover:underline">
                        {i.incidentId}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className="text-fg">{i.deviceHostname}</span>
                      {i.simulated && <span className="ml-1.5 text-[11px] text-subtle">sim</span>}
                    </Td>
                    <Td className="font-medium whitespace-nowrap text-fg">{i.title}</Td>
                    <Td>
                      <SeverityBadge severity={i.severity} />
                    </Td>
                    <Td className="max-w-80 text-[13px] text-muted">
                      <p className="line-clamp-2">{i.rootCause?.replace(/^Possible root cause: /, '')}</p>
                    </Td>
                    <Td className="max-w-72 text-[13px] text-muted">
                      <p className="line-clamp-2">{i.recommendation}</p>
                    </Td>
                    <Td>
                      <IncidentStatusBadge status={i.status} />
                    </Td>
                    <Td className="tabular whitespace-nowrap text-muted">{timeAgo(i.createdAt, now)}</Td>
                    <Td className="tabular whitespace-nowrap text-muted">{i.resolvedAt ? formatDuration(i.resolutionTimeSeconds) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        ) : (
          <EmptyState icon={Siren} title="No incidents match" description={filters.status === 'OPEN' ? 'No unresolved incidents right now.' : 'Try different filters.'} />
        )}
      </Card>
    </>
  );
}
