export function Card({ children, className = '', padded = true, ...props }) {
  return (
    <section className={`rounded-xl border border-border bg-surface shadow-card ${padded ? 'p-5' : ''} ${className}`} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, action, icon: Icon, className = '' }) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-3 ${className}`}>
      <div className="flex min-w-0 items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 rounded-md bg-surface-2 p-1.5 text-muted">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {children}
        <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', loading }) {
  const tones = {
    default: 'bg-surface-2 text-muted',
    primary: 'bg-primary-soft text-primary-text',
    healthy: 'bg-healthy-soft text-healthy',
    warning: 'bg-warning-soft text-warning',
    critical: 'bg-critical-soft text-critical',
    info: 'bg-info-soft text-info',
  };
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {Icon && (
          <span className={`rounded-lg p-1.5 ${tones[tone]}`}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-20 animate-pulse rounded bg-surface-3" />
      ) : (
        <div className="tabular text-[28px] leading-none font-semibold tracking-tight text-fg">{value}</div>
      )}
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </Card>
  );
}
