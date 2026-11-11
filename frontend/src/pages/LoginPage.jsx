import { Activity, Eye, EyeOff, LogIn } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Form';
import { InlineError } from '../components/ui/States';
import { useAuth } from '../context/AuthContext';
import { errorMessage } from '../lib/api';

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLogin({ email, password }) {
  const errors = {};
  if (!email.trim()) errors.email = 'Email is required';
  else if (!EMAIL_RX.test(email.trim())) errors.email = 'Enter a valid email address';
  if (!password) errors.password = 'Password is required';
  return errors;
}

export default function LoginPage() {
  const { login, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState('');

  if (token) return <Navigate to={location.state?.from || '/'} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    const v = validateLogin(form);
    setErrors(v);
    setServerError('');
    if (Object.keys(v).length) return;
    setSubmitting(true);
    try {
      await login(form.email.trim(), form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setServerError(errorMessage(err, 'Sign-in failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-[#13132e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#5b5bd6]">
            <Activity className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-lg font-semibold">NanoPulse</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">Find endpoint problems before your users report them.</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">
            Real-time device telemetry, explainable diagnostics and approval-gated remediation in one console for IT teams.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-white/80">
            {['Live CPU, memory, disk and network health', 'Root-cause hypotheses with auditable confidence', 'Allowlisted, approved remediation with full audit trail'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-[#8b8bf5]" />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <svg className="absolute -right-20 bottom-24 w-[520px] opacity-25" viewBox="0 0 520 120" fill="none" aria-hidden>
          <path d="M0 70h120l25-50 35 90 30-70 20 30h290" stroke="#8b8bf5" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-xs text-white/40">Independent educational project inspired by Digital Experience Automation concepts.</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <form onSubmit={onSubmit} noValidate className="w-full max-w-sm" aria-label="Sign in">
          <div className="mb-8 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
              <Activity className="h-5 w-5" aria-hidden />
            </span>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-fg">Sign in</h2>
          <p className="mt-1.5 text-sm text-muted">Use your NanoPulse administrator or technician account.</p>

          <div className="mt-8 space-y-4">
            <InlineError message={serverError} />
            <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} placeholder="you@company.com" />
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                className="[&_input]:pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute top-[30px] right-2 rounded p-1 text-subtle hover:text-fg"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <Button type="submit" size="lg" className="w-full" loading={submitting} icon={LogIn}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </div>
          <p className="mt-6 text-xs leading-relaxed text-subtle">Accounts are created with <code className="font-mono">npm run seed</code> or by an administrator.</p>
        </form>
      </div>
    </div>
  );
}
