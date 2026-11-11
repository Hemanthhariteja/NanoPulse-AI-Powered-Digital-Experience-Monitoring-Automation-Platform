import { Ban, Check, ChevronDown, ChevronRight, Play, Plus, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime, formatDuration, humanize } from '../../lib/format';
import { ApprovalBadge, Badge, ExecutionBadge, ModeBadge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Select, Textarea } from '../ui/Form';
import { Modal } from '../ui/Modal';

let catalogCache = null;
export function useCatalog() {
  const [catalog, setCatalog] = useState(catalogCache || []);
  useEffect(() => {
    if (catalogCache) return;
    api
      .get('/remediations/catalog')
      .then((r) => {
        catalogCache = r.data.data;
        setCatalog(catalogCache);
      })
      .catch(() => {});
  }, []);
  return catalog;
}

const RISK_TONE = { low: 'healthy', medium: 'warning', high: 'critical' };
export const RiskBadge = ({ risk }) => (risk ? <Badge tone={RISK_TONE[risk]}>{humanize(risk)} risk</Badge> : null);

/** Request (recommend) a remediation for an incident or device. Execution still needs admin approval. */
export function RequestActionButton({ incidentId, deviceId, actionType, label, onDone, size = 'sm', variant = 'secondary' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const request = async () => {
    setBusy(true);
    try {
      const r = await api.post('/remediations', { incidentId, deviceId, actionType });
      toast.success(`${r.data.actionId} requested`, 'Awaiting administrator approval');
      onDone?.(r.data);
    } catch (err) {
      toast.error('Request failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button size={size} variant={variant} icon={Plus} loading={busy} onClick={request}>
      {label}
    </Button>
  );
}

export function RunActionPicker({ deviceId, onDone }) {
  const catalog = useCatalog();
  const [type, setType] = useState('');
  return (
    <div className="flex items-end gap-2">
      <Select aria-label="Choose an action" value={type} onChange={(e) => setType(e.target.value)} className="w-60">
        <option value="">Choose an action…</option>
        {catalog.map((a) => (
          <option key={a.type} value={a.type}>
            {a.label}
          </option>
        ))}
      </Select>
      <RequestActionButton deviceId={deviceId} actionType={type} label="Request" onDone={() => { setType(''); onDone?.(); }} />
    </div>
  );
}

function ResultDetails({ rem }) {
  const [open, setOpen] = useState(false);
  const r = rem.executionResult;
  if (!r?.summary && !r?.error) return null;
  return (
    <div className="mt-3 rounded-lg border border-border bg-surface-2/60 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium text-fg">Result</span>
        <ModeBadge mode={rem.executionMode} />
        {r.durationMs != null && <span className="text-xs text-subtle">{formatDuration(r.durationMs / 1000)}</span>}
      </div>
      {r.summary && <p className="mt-1 text-sm text-fg">{r.summary}</p>}
      {r.error && <p className="mt-1 text-sm text-critical">{r.error}</p>}
      {(r.data || r.verification) && (
        <button onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-text" aria-expanded={open}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Execution data &amp; verification
        </button>
      )}
      {open && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-surface p-3 font-mono text-[11.5px] leading-relaxed text-muted">
          {JSON.stringify({ verification: r.verification, data: r.data }, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** One remediation with its approval/execution state, controls and execution log. */
export function RemediationItem({ rem, onChange, showContext = true }) {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [logOpen, setLogOpen] = useState(false);

  const act = async (action, body) => {
    setBusy(action);
    try {
      const r = await api.post(`/remediations/${rem.actionId}/${action}`, body);
      onChange?.(r.data);
      if (action === 'reject') setRejectOpen(false);
    } catch (err) {
      toast.error(`Could not ${action} ${rem.actionId}`, errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pending = rem.approvalStatus === 'PENDING';
  const canExecute = rem.approvalStatus === 'APPROVED' && rem.executionStatus === 'NOT_STARTED';
  const canCancel = ['NOT_STARTED', 'QUEUED'].includes(rem.executionStatus) && rem.approvalStatus !== 'REJECTED';

  return (
    <article className="rounded-xl border border-border bg-surface p-4" aria-label={`Remediation ${rem.actionId}`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-subtle">{rem.actionId}</span>
            <h3 className="text-sm font-semibold text-fg">{rem.label || rem.actionType}</h3>
            <RiskBadge risk={rem.riskLevel} />
            {rem.simulated && <Badge>Simulated device</Badge>}
          </div>
          {showContext && (
            <p className="mt-1 text-[13px] text-muted">
              <Link to={`/devices/${rem.deviceId}`} className="hover:underline">
                {rem.deviceHostname}
              </Link>
              {rem.incidentId && (
                <>
                  {' · '}
                  <Link to={`/incidents/${rem.incidentId}`} className="hover:underline">
                    {rem.incidentId}
                  </Link>
                </>
              )}
            </p>
          )}
          <p className="mt-1 text-xs text-subtle">
            Requested by {rem.requestedBy?.name || 'system'} · {formatDateTime(rem.createdAt)}
            {rem.approvedBy?.name && ` · approved by ${rem.approvedBy.name}`}
            {rem.completedAt && ` · finished ${formatDateTime(rem.completedAt)}`}
          </p>
          {rem.rejectedReason && <p className="mt-1 text-xs text-critical">Rejected: {rem.rejectedReason}</p>}
          {Object.keys(rem.parameters || {}).length > 0 && <p className="mt-1 font-mono text-[11px] text-subtle">params {JSON.stringify(rem.parameters)}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 md:items-end">
          <div className="flex flex-wrap gap-1.5">
            <ApprovalBadge status={rem.approvalStatus} />
            <ExecutionBadge status={rem.executionStatus} />
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-1.5">
              {pending && (
                <>
                  <Button size="sm" variant="success" icon={Check} loading={busy === 'approve'} onClick={() => act('approve')}>
                    Approve
                  </Button>
                  <Button size="sm" variant="secondary" icon={X} disabled={Boolean(busy)} onClick={() => setRejectOpen(true)}>
                    Reject
                  </Button>
                </>
              )}
              {canExecute && (
                <Button size="sm" icon={Play} loading={busy === 'execute'} onClick={() => act('execute')}>
                  Execute
                </Button>
              )}
              {canCancel && !pending && (
                <Button size="sm" variant="ghost" icon={Ban} loading={busy === 'cancel'} onClick={() => act('cancel')}>
                  Cancel
                </Button>
              )}
            </div>
          )}
          {!isAdmin && pending && (
            <span className="inline-flex items-center gap-1 text-xs text-subtle">
              <ShieldCheck className="h-3.5 w-3.5" /> Admin approval required
            </span>
          )}
        </div>
      </div>
      <ResultDetails rem={rem} />
      {rem.log?.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setLogOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg" aria-expanded={logOpen}>
            {logOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />} Execution log ({rem.log.length})
          </button>
          {logOpen && (
            <ol className="mt-2 space-y-1 border-l border-border pl-3">
              {rem.log.map((l, i) => (
                <li key={i} className={`text-xs ${l.level === 'error' ? 'text-critical' : l.level === 'warn' ? 'text-warning' : 'text-muted'}`}>
                  <span className="tabular text-subtle">{new Date(l.at).toLocaleTimeString()}</span> {l.message}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={`Reject ${rem.actionId}`}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejectOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={reason.trim().length < 3} loading={busy === 'reject'} onClick={() => act('reject', { reason: reason.trim() })}>
              Reject action
            </Button>
          </>
        }
      >
        <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this action not appropriate?" hint="Recorded in the audit log." />
      </Modal>
    </article>
  );
}
