import { ArrowLeft, CheckCircle2, Lightbulb, MessageSquarePlus, Microscope, ShieldQuestion } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RemediationItem, RequestActionButton, useCatalog } from '../components/remediation/Remediation';
import { IncidentStatusBadge, SeverityBadge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardHeader, PageHeader } from '../components/ui/Card';
import { KeyValue } from '../components/ui/Data';
import { Select, Textarea } from '../components/ui/Form';
import { Modal } from '../components/ui/Modal';
import { EmptyState, ErrorState, LoadingBlock } from '../components/ui/States';
import { useRealtime } from '../context/RealtimeContext';
import { useToast } from '../context/ToastContext';
import { useApi, useDebouncedCallback } from '../hooks/useApi';
import { api, errorMessage } from '../lib/api';
import { formatBytes, formatDateTime, formatDuration, humanize } from '../lib/format';

function ConfidenceBreakdown({ confidence, breakdown }) {
  const rows = [
    ['Persistence', breakdown?.persistence, 0.5, 'Share of the last 5 samples breaching the warning threshold'],
    ['Margin', breakdown?.margin, 0.3, 'How far past the warning threshold, relative to the remaining headroom'],
    ['Corroboration', breakdown?.corroboration, 0.2, 'Independent evidence (e.g. one dominant process) supporting the hypothesis'],
  ];
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="tabular text-3xl font-semibold text-fg">{Math.round((confidence ?? 0) * 100)}%</span>
        <span className="text-sm text-muted">confidence in the root-cause hypothesis</span>
      </div>
      <ul className="mt-4 space-y-3">
        {rows.map(([label, v, w, help]) => (
          <li key={label}>
            <div className="flex justify-between text-[13px]">
              <span className="text-fg">
                {label} <span className="text-subtle">× {w}</span>
              </span>
              <span className="tabular text-muted">{v ?? '—'}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-primary" style={{ width: `${(v ?? 0) * 100}%` }} />
            </div>
            <p className="mt-1 text-xs text-subtle">{help}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 font-mono text-[11px] text-subtle">confidence = 0.5·persistence + 0.3·margin + 0.2·corroboration</p>
    </div>
  );
}

function MetricEvidence({ metrics }) {
  if (!metrics) return null;
  const items = Object.entries(metrics)
    .filter(([k, v]) => v !== null && v !== undefined && k !== 'topProcess')
    .map(([k, v]) => [humanize(k.replace(/([A-Z])/g, '_$1')), /Bytes/.test(k) ? formatBytes(v) : typeof v === 'number' ? (/Usage|warning|critical/i.test(k) ? `${v}%` : v.toLocaleString()) : String(v)]);
  if (metrics.topProcess) items.push(['Top process', `${metrics.topProcess.name} (PID ${metrics.topProcess.pid}) · ${metrics.topProcess.cpuPercent ?? '-'}% CPU · ${metrics.topProcess.memoryPercent ?? '-'}% RAM`]);
  return <KeyValue items={items} />;
}

export default function IncidentDetailPage() {
  const { id } = useParams();
  const toast = useToast();
  const catalog = useCatalog();
  const { data: inc, error, loading, refetch, setData } = useApi(`/incidents/${id}`);
  const users = useApi('/auth/users');
  const refresh = useDebouncedCallback(() => refetch({ silent: true }), 500);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution] = useState('');

  useRealtime(['incident:updated', 'remediation:updated', 'resync'], (p) => {
    if (!p || p.incidentId === id || p.incidentId === inc?.incidentId) refresh();
  });
  useEffect(() => setNote(''), [id]);

  const patch = async (body, label) => {
    setBusy(label);
    try {
      const r = await api.patch(`/incidents/${inc.incidentId}`, body);
      setData(r.data);
      if (label === 'note') setNote('');
    } catch (err) {
      toast.error('Update failed', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const resolve = async () => {
    setBusy('resolve');
    try {
      const r = await api.post(`/incidents/${inc.incidentId}/resolve`, { notes: resolution.trim() });
      setData(r.data);
      setResolveOpen(false);
      toast.success(`${inc.incidentId} resolved`);
    } catch (err) {
      toast.error('Could not resolve', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (error && !inc) return <ErrorState message={error} onRetry={refetch} />;
  if (loading && !inc) return <LoadingBlock label="Loading incident…" />;
  if (!inc) return null;

  const activeTypes = new Set(inc.remediations.filter((r) => r.approvalStatus !== 'REJECTED' && ['NOT_STARTED', 'QUEUED', 'RUNNING'].includes(r.executionStatus)).map((r) => r.actionType));

  return (
    <>
      <PageHeader
        title={inc.title}
        description={`${inc.incidentId} · detected ${formatDateTime(inc.firstDetectedAt)} · seen ${inc.occurrences}×`}
        actions={
          inc.isOpen && (
            <>
              {inc.status !== 'INVESTIGATING' && (
                <Button variant="secondary" icon={Microscope} loading={busy === 'inv'} onClick={() => patch({ status: 'INVESTIGATING' }, 'inv')}>
                  Investigate
                </Button>
              )}
              <Button variant="success" icon={CheckCircle2} onClick={() => setResolveOpen(true)}>
                Resolve
              </Button>
            </>
          )
        }
      >
        <Link to="/incidents" className="mb-2 inline-flex items-center gap-1 text-[13px] text-muted hover:text-fg">
          <ArrowLeft className="h-3.5 w-3.5" /> Incidents
        </Link>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={inc.severity} />
          <IncidentStatusBadge status={inc.status} />
          <Link to={`/devices/${inc.deviceId}`} className="text-sm font-medium text-primary-text hover:underline">
            {inc.deviceHostname}
          </Link>
          {inc.simulated && <span className="text-xs text-subtle">(simulated device)</span>}
        </div>
      </PageHeader>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader icon={ShieldQuestion} title="Diagnostic explanation" subtitle="Deterministic rule evaluation — thresholds alone do not prove a root cause" />
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium tracking-wide text-subtle uppercase">Detection reason</p>
                <p className="mt-1 text-fg">{inc.detectionReason}</p>
              </div>
              <div>
                <p className="text-xs font-medium tracking-wide text-subtle uppercase">Possible root cause</p>
                <p className="mt-1 text-fg">{inc.rootCause?.replace(/^Possible root cause: /, '')}</p>
              </div>
              <div className="flex gap-3 rounded-lg bg-primary-soft p-3.5">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" aria-hidden />
                <div>
                  <p className="text-xs font-medium tracking-wide text-primary-text uppercase">Recommended action</p>
                  <p className="mt-1 text-fg">{inc.recommendation}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Metric evidence" subtitle={`Values at last detection · ${formatDateTime(inc.lastDetectedAt)}`} />
            <MetricEvidence metrics={inc.metrics} />
          </Card>

          <Card>
            <CardHeader title="Remediation" subtitle="Request an allowlisted action; an administrator must approve and execute it." />
            {inc.isOpen && inc.recommendedActions?.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-2">
                {inc.recommendedActions.map((type) => (
                  <RequestActionButton
                    key={type}
                    incidentId={inc.incidentId}
                    actionType={type}
                    label={catalog.find((a) => a.type === type)?.label || type}
                    variant={activeTypes.has(type) ? 'ghost' : 'secondary'}
                    onDone={refresh}
                  />
                ))}
              </div>
            )}
            {inc.remediations.length ? (
              <div className="space-y-3">
                {inc.remediations.map((r) => (
                  <RemediationItem key={r._id} rem={r} showContext={false} onChange={refresh} />
                ))}
              </div>
            ) : (
              <EmptyState title="No remediation requested yet" description={inc.recommendedActions?.length ? 'Use a recommended action above.' : 'No automated action applies to this problem.'} className="py-6" />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Confidence" />
            <ConfidenceBreakdown confidence={inc.confidence} breakdown={inc.confidenceBreakdown} />
          </Card>
          <Card>
            <CardHeader title="Details" />
            <KeyValue
              className="sm:grid-cols-1"
              items={[
                ['Rule', <span className="font-mono text-xs">{inc.ruleId}</span>],
                ['Created', formatDateTime(inc.createdAt)],
                ['Last detected', formatDateTime(inc.lastDetectedAt)],
                ['Resolved', inc.resolvedAt ? `${formatDateTime(inc.resolvedAt)} by ${inc.resolvedBy}` : '—'],
                ['Time to resolution', inc.resolvedAt ? formatDuration(inc.resolutionTimeSeconds) : '—'],
                ['Resolution notes', inc.resolutionNotes || '—'],
              ]}
            />
            {inc.isOpen && (
              <div className="mt-4 space-y-3 border-t border-border pt-4">
                <Select
                  label="Assigned technician"
                  value={inc.assignedTo?._id || ''}
                  disabled={busy === 'assign'}
                  onChange={(e) => patch({ assignedTo: e.target.value || null }, 'assign')}
                >
                  <option value="">Unassigned</option>
                  {users.data?.data.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role})
                    </option>
                  ))}
                </Select>
                <Select label="Severity" value={inc.severity} disabled={busy === 'sev'} onChange={(e) => patch({ severity: e.target.value }, 'sev')} hint={inc.severityOverridden ? 'Manually set — detections no longer change it' : undefined}>
                  <option value="CRITICAL">Critical</option>
                  <option value="WARNING">Warning</option>
                  <option value="INFO">Info</option>
                </Select>
                {inc.status !== 'FAILED' && (
                  <Button variant="danger-ghost" size="sm" loading={busy === 'fail'} onClick={() => patch({ status: 'FAILED', note: 'Marked as failed for manual follow-up' }, 'fail')}>
                    Mark as failed
                  </Button>
                )}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Timeline & audit trail" />
            {inc.isOpen && (
              <div className="mb-4">
                <Textarea aria-label="Add a note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an investigation note…" className="[&_textarea]:min-h-16" />
                <Button size="sm" variant="secondary" icon={MessageSquarePlus} className="mt-2" disabled={!note.trim()} loading={busy === 'note'} onClick={() => patch({ note: note.trim() }, 'note')}>
                  Add note
                </Button>
              </div>
            )}
            <ol className="relative space-y-4 border-l border-border pl-4">
              {[...inc.timeline].reverse().map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-surface bg-primary" aria-hidden />
                  <p className="text-[13px] text-fg">{e.message}</p>
                  <p className="mt-0.5 text-xs text-subtle">
                    {humanize(e.type)} · {e.by} · {formatDateTime(e.at)}
                  </p>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title={`Resolve ${inc.incidentId}`}
        description="Resolution notes are stored with the incident and in the audit log."
        footer={
          <>
            <Button variant="secondary" onClick={() => setResolveOpen(false)}>
              Cancel
            </Button>
            <Button variant="success" disabled={resolution.trim().length < 3} loading={busy === 'resolve'} onClick={resolve}>
              Resolve incident
            </Button>
          </>
        }
      >
        <Textarea label="Resolution notes" value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="What was done to resolve this?" />
      </Modal>
    </>
  );
}
