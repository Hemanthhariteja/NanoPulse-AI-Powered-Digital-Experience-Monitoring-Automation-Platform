import { Monitor, Plus, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AgentSetup } from '../components/AgentSetup';
import { AgentTypeBadge, StatusBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, PageHeader } from '../components/ui/Card';
import { MetricBar, Pagination, Table, Td, Th } from '../components/ui/Data';
import { Select } from '../components/ui/Form';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { useApi, useDebouncedCallback, useDebouncedValue, useNow } from '../hooks/useApi';
import { useThresholds } from '../hooks/useThresholds';
import { api, errorMessage } from '../lib/api';
import { shortId, timeAgo } from '../lib/format';

export function DevicesTable({ devices, thresholds: t, now, onDelete, isAdmin }) {
  const navigate = useNavigate();
  return (
    <Table>
      <thead>
        <tr>
          <Th>Device</Th>
          <Th>Device ID</Th>
          <Th>Operating system</Th>
          <Th className="w-36">CPU</Th>
          <Th className="w-36">RAM</Th>
          <Th className="w-36">Disk</Th>
          <Th>Health</Th>
          <Th>Last heartbeat</Th>
          <Th className="text-right">Actions</Th>
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => (
          <tr key={d.deviceId} className="cursor-pointer hover:bg-surface-2/60" onClick={() => navigate(`/devices/${d.deviceId}`)}>
            <Td>
              <div className="flex flex-col gap-1">
                <Link to={`/devices/${d.deviceId}`} className="font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                  {d.hostname}
                </Link>
                <AgentTypeBadge agentType={d.agentType} />
              </div>
            </Td>
            <Td className="font-mono text-xs text-muted" title={d.deviceId}>
              {shortId(d.deviceId)}
            </Td>
            <Td className="whitespace-nowrap text-muted">{d.operatingSystem}</Td>
            <Td>
              <MetricBar value={d.latest?.cpuUsage} warn={t.cpuWarning} crit={t.cpuCritical} />
            </Td>
            <Td>
              <MetricBar value={d.latest?.ramUsage} warn={t.ramWarning} crit={t.ramCritical} />
            </Td>
            <Td>
              <MetricBar value={d.latest?.diskUsage} warn={t.diskWarning} crit={t.diskCritical} />
            </Td>
            <Td>
              <StatusBadge status={d.status} />
            </Td>
            <Td className="tabular whitespace-nowrap text-muted">{timeAgo(d.lastHeartbeat, now)}</Td>
            <Td className="text-right">
              {isAdmin && (
                <Button
                  variant="danger-ghost"
                  size="icon"
                  aria-label={`Delete ${d.hostname}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(d);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default function DevicesPage() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const t = useThresholds();
  const now = useNow();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [agentType, setAgentType] = useState('');
  const [sort, setSort] = useState('');
  const [page, setPage] = useState(1);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const q = useDebouncedValue(search, 300);

  const params = { page, limit: 25, ...(q && { search: q }), ...(status && { status }), ...(agentType && { agentType }), ...(sort && { sort }) };
  const { data, error, loading, refetch, setData } = useApi('/devices', { params });
  const refresh = useDebouncedCallback(() => refetch({ silent: true }), 1000);

  useRealtime('telemetry:update', (tm) =>
    setData((d) =>
      d ? { ...d, data: d.data.map((x) => (x.deviceId === tm.deviceId ? { ...x, status: tm.status, lastHeartbeat: tm.at, latest: { ...x.latest, ...tm.metrics } } : x)) } : d
    )
  );
  useRealtime(['device:updated', 'resync'], refresh);

  const confirmDelete = async () => {
    setDeleting(true);
    try {
      await api.delete(`/devices/${toDelete.deviceId}`);
      toast.success(`${toDelete.hostname} removed`);
      setToDelete(null);
      refetch({ silent: true });
    } catch (err) {
      toast.error('Delete failed', errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const filterChange = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Devices"
        description="Every endpoint registered with NanoPulse, updated live from telemetry."
        actions={
          <Button icon={Plus} onClick={() => setRegisterOpen(true)}>
            Register device
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-col gap-3 border-b border-border p-4 md:flex-row md:items-end">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-subtle" aria-hidden />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search hostname, device ID, OS or IP"
              aria-label="Search devices"
              className="h-9 w-full rounded-lg border border-border bg-surface pr-3 pl-9 text-sm text-fg placeholder:text-subtle focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
            />
          </div>
          <Select aria-label="Filter by health" value={status} onChange={filterChange(setStatus)} className="md:w-40">
            <option value="">All health states</option>
            {['HEALTHY', 'WARNING', 'CRITICAL', 'OFFLINE', 'PENDING'].map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
          <Select aria-label="Filter by agent type" value={agentType} onChange={filterChange(setAgentType)} className="md:w-40">
            <option value="">Real &amp; simulated</option>
            <option value="python-agent">Real agents</option>
            <option value="simulated">Simulated</option>
          </Select>
          <Select aria-label="Sort devices" value={sort} onChange={filterChange(setSort)} className="md:w-40">
            <option value="">Sort: default</option>
            <option value="hostname">Hostname</option>
            <option value="status">Health</option>
            <option value="cpu">CPU (high first)</option>
            <option value="ram">RAM (high first)</option>
            <option value="disk">Disk (high first)</option>
            <option value="heartbeat">Last heartbeat</option>
          </Select>
        </div>
        {error && !data ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : loading && !data ? (
          <LoadingBlock label="Loading devices…" />
        ) : data?.data.length ? (
          <>
            <DevicesTable devices={data.data} thresholds={t} now={now} isAdmin={isAdmin} onDelete={setToDelete} />
            <Pagination pagination={data.pagination} onPage={setPage} />
          </>
        ) : (
          <EmptyState
            icon={Monitor}
            title={q || status || agentType ? 'No devices match these filters' : 'No devices registered yet'}
            description={q || status || agentType ? 'Try clearing the search or filters.' : 'Register a real Windows endpoint or start the simulator.'}
            action={!q && !status && !agentType && <Button onClick={() => setRegisterOpen(true)}>Register device</Button>}
          />
        )}
      </Card>

      <Modal open={registerOpen} onClose={() => setRegisterOpen(false)} title="Register a Windows endpoint" description="Install the lightweight Python agent on the device you want to monitor." size="lg">
        <AgentSetup />
      </Modal>

      <Modal
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title={`Remove ${toDelete?.hostname}?`}
        description="Telemetry for this device is deleted and its open incidents are closed. Incident history is kept."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setToDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              Remove device
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">If the agent is still running it can re-enroll with the enrollment key.</p>
      </Modal>
    </>
  );
}
