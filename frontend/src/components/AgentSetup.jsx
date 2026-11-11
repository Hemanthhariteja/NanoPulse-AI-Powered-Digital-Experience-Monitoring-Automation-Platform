import { Check, Copy, Eye, EyeOff, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { SOCKET_URL, api, errorMessage } from '../lib/api';
import { Button } from './ui/Button';

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(children);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-surface-2 px-3.5 py-3 pr-12 font-mono text-[12.5px] leading-relaxed text-fg">{children}</pre>
      <button onClick={copy} className="absolute top-2 right-2 rounded-md border border-border bg-surface p-1.5 text-muted hover:text-fg" aria-label="Copy command">
        {copied ? <Check className="h-3.5 w-3.5 text-healthy" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

/** Instructions for enrolling a real Windows endpoint with the Python agent. */
export function AgentSetup() {
  const { isAdmin } = useAuth();
  const toast = useToast();
  const [key, setKey] = useState(null);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const serverUrl = SOCKET_URL; // API origin (same as the dashboard in production)

  const reveal = async () => {
    if (key) return setVisible((v) => !v);
    setBusy(true);
    try {
      const r = await api.get('/settings/enrollment-key');
      setKey(r.data.enrollmentKey);
      setVisible(true);
    } catch (err) {
      toast.error('Could not load enrollment key', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Rotate the enrollment key? Already-registered agents keep working; new agents need the new key.')) return;
    setBusy(true);
    try {
      const r = await api.post('/settings/enrollment-key/rotate');
      setKey(r.data.enrollmentKey);
      setVisible(true);
      toast.success('Enrollment key rotated');
    } catch (err) {
      toast.error('Rotation failed', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const shownKey = visible && key ? key : '<ENROLLMENT_KEY>';
  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-border p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-medium text-fg">Enrollment key</p>
            <p className="text-[13px] text-muted">Agents present this key once to register; each device then receives its own secret.</p>
          </div>
          {isAdmin ? (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" icon={visible ? EyeOff : Eye} loading={busy} onClick={reveal}>
                {visible ? 'Hide' : 'Reveal'}
              </Button>
              <Button size="sm" variant="ghost" icon={RotateCw} disabled={busy} onClick={rotate}>
                Rotate
              </Button>
            </div>
          ) : (
            <span className="text-xs text-subtle">Ask an administrator for the key</span>
          )}
        </div>
        {visible && key && <code className="mt-3 block rounded bg-surface-2 px-2 py-1.5 font-mono text-[13px] break-all text-fg">{key}</code>}
      </div>
      <ol className="space-y-4">
        <li>
          <p className="mb-1.5 font-medium text-fg">1. Install dependencies (Python 3.10+)</p>
          <CodeBlock>{'cd agent\npython -m pip install -r requirements.txt'}</CodeBlock>
        </li>
        <li>
          <p className="mb-1.5 font-medium text-fg">2. Register and start monitoring</p>
          <CodeBlock>{`python -m nanopulse_agent --server-url ${serverUrl} --enrollment-key ${shownKey} --enable-demo-app`}</CodeBlock>
          <p className="mt-1.5 text-xs text-subtle">Credentials are saved to agent/state; later runs need only <code className="font-mono">python -m nanopulse_agent</code>. Default interval: 10 s.</p>
        </li>
        <li>
          <p className="mb-1.5 font-medium text-fg">3. Optional demo workload (high CPU)</p>
          <CodeBlock>{'python demo_app.py --nanopulse-demo --burn-cpu'}</CodeBlock>
        </li>
      </ol>
      <p className="text-xs text-subtle">
        The agent collects only resource metrics, network counters, uptime and process names. It never reads files, browser data, credentials or keystrokes, and executes only allowlisted actions.
      </p>
    </div>
  );
}
