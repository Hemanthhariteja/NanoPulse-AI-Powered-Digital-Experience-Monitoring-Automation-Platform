import { AlertCircle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export function Spinner({ className = 'h-5 w-5' }) {
  return <Loader2 className={`animate-spin text-muted ${className}`} aria-label="Loading" />;
}

export function LoadingBlock({ label = 'Loading…', className = 'py-16' }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-sm text-muted ${className}`} role="status">
      <Spinner />
      {label}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-surface-3 ${className}`} />;
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className = 'py-14' }) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 text-center ${className}`}>
      <span className="mb-3 rounded-full bg-surface-2 p-3 text-subtle">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className = 'py-14' }) {
  return (
    <div className={`flex flex-col items-center justify-center px-4 text-center ${className}`} role="alert">
      <span className="mb-3 rounded-full bg-critical-soft p-3 text-critical">
        <AlertCircle className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-sm font-medium text-fg">Could not load data</p>
      <p className="mt-1 max-w-md text-[13px] text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" icon={RefreshCw} className="mt-4" onClick={() => onRetry()}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function InlineError({ message }) {
  if (!message) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2.5 text-sm text-critical" role="alert">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
