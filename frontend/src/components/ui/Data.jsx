import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './Button';

/** Horizontal utilization bar coloured by the configured thresholds. */
export function MetricBar({ value, warn = 70, crit = 85, showLabel = true, className = '' }) {
  if (value === null || value === undefined) return <span className="text-sm text-subtle">—</span>;
  const tone = value > crit ? 'bg-critical' : value >= warn ? 'bg-warning' : 'bg-healthy';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-1.5 w-full min-w-12 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value}>
        <div className={`h-full rounded-full transition-[width] duration-500 ${tone}`} style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      {showLabel && <span className="tabular w-12 shrink-0 text-right text-[13px] text-fg">{value.toFixed(1)}%</span>}
    </div>
  );
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.total === 0) return null;
  const { page, pages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(total, page * limit);
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted">
      <span className="tabular">
        {from}–{to} of {total}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="tabular px-2">
          {page} / {pages}
        </span>
        <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function Table({ children, className = '' }) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className = '', ...props }) {
  return (
    <th scope="col" className={`border-b border-border bg-surface-2/60 px-4 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap text-muted uppercase ${className}`} {...props}>
      {children}
    </th>
  );
}

export function Td({ children, className = '', ...props }) {
  return (
    <td className={`border-b border-border px-4 py-3 align-middle ${className}`} {...props}>
      {children}
    </td>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
            value === t.value ? 'border-primary text-fg' : 'border-transparent text-muted hover:text-fg'
          }`}
        >
          {t.label}
          {t.count !== undefined && <span className="tabular rounded-full bg-surface-2 px-1.5 py-px text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ items, className = '' }) {
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 ${className}`}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-subtle">{k}</dt>
          <dd className="mt-0.5 truncate text-sm text-fg" title={typeof v === 'string' ? v : undefined}>
            {v ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
