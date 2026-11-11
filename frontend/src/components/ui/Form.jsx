import { useId } from 'react';

const base =
  'w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg placeholder:text-subtle transition-colors hover:border-border-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60';

export function Field({ label, hint, error, children, id, className = '' }) {
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-fg">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-critical" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ label, hint, error, className = '', id: idProp, ...props }) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <Field label={label} hint={hint} error={error} id={id} className={className}>
      <input id={id} className={`${base} h-9 ${error ? 'border-critical' : ''}`} aria-invalid={Boolean(error) || undefined} {...props} />
    </Field>
  );
}

export function Select({ label, hint, error, className = '', children, id: idProp, ...props }) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <Field label={label} hint={hint} error={error} id={id} className={className}>
      <select id={id} className={`${base} h-9 pr-8`} {...props}>
        {children}
      </select>
    </Field>
  );
}

export function Textarea({ label, hint, error, className = '', id: idProp, ...props }) {
  const autoId = useId();
  const id = idProp || autoId;
  return (
    <Field label={label} hint={hint} error={error} id={id} className={className}>
      <textarea id={id} className={`${base} min-h-[88px] py-2`} {...props} />
    </Field>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-fg">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-surface-3'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
