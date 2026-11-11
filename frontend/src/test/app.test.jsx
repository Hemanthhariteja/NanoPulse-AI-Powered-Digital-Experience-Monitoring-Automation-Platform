import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('../lib/api', async (orig) => {
  const actual = await orig();
  return { ...actual, api: apiMock };
});

const authState = vi.hoisted(() => ({ value: null }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => authState.value,
  AuthProvider: ({ children }) => children,
}));

import { RemediationItem } from '../components/remediation/Remediation';
import DashboardPage from '../pages/DashboardPage';
import { DevicesTable } from '../pages/DevicesPage';
import { IncidentFilters } from '../pages/IncidentsPage';
import LoginPage, { validateLogin } from '../pages/LoginPage';

const wrap = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  authState.value = { user: { name: 'Admin', role: 'admin' }, isAdmin: true, token: null, login: vi.fn(), logout: vi.fn() };
});

describe('Login', () => {
  it('validates input before calling the API', async () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({ email: 'Email is required', password: 'Password is required' });
    expect(validateLogin({ email: 'nope', password: 'x' }).email).toBe('Enter a valid email address');

    wrap(<LoginPage />);
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(authState.value.login).not.toHaveBeenCalled();
  });

  it('toggles password visibility', async () => {
    wrap(<LoginPage />);
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pw).toHaveAttribute('type', 'text');
  });

  it('shows the server error message on failed login', async () => {
    authState.value.login = vi.fn().mockRejectedValue({ response: { status: 401, data: { error: { message: 'Invalid email or password' } } } });
    wrap(<LoginPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'admin@x.io');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(authState.value.login).toHaveBeenCalledWith('admin@x.io', 'wrong');
  });
});

describe('Dashboard', () => {
  const overview = {
    devices: { total: 21, healthy: 17, warning: 2, critical: 1, offline: 1, pending: 0, real: 1, simulated: 20, healthPercentage: 81 },
    fleet: { avgCpu: 30, avgRam: 50, avgDisk: 60 },
    incidents: { active: 3, resolved: 9, avgResolutionSeconds: 125, openBySeverity: { CRITICAL: 1, WARNING: 2, INFO: 0 } },
    remediation: { pendingApprovals: 2 },
    recentIncidents: [{ _id: '1', incidentId: 'INC-000001', title: 'Critical CPU utilization', severity: 'CRITICAL', status: 'NEW', deviceHostname: 'PC-1', createdAt: new Date().toISOString() }],
    recentDevices: [],
  };

  it('renders metrics loaded from the backend', async () => {
    apiMock.get.mockImplementation((path) => Promise.resolve({ data: path === '/analytics/overview' ? overview : { trend: [] } }));
    wrap(<DashboardPage />);
    expect(await screen.findByText('Critical CPU utilization')).toBeInTheDocument();
    const devicesCard = screen.getByText('Registered devices').closest('section');
    expect(within(devicesCard).getByText('21')).toBeInTheDocument();
    expect(within(devicesCard).getByText('1 offline · 0 pending')).toBeInTheDocument();
    expect(within(screen.getByText('Device health').closest('section')).getByText('81%')).toBeInTheDocument();
    expect(screen.getByText('2m 5s')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/analytics/overview', expect.anything());
  });

  it('shows an error state with retry when the API fails', async () => {
    apiMock.get.mockRejectedValue({ message: 'Network Error' });
    wrap(<DashboardPage />);
    expect(await screen.findByText(/Cannot reach the NanoPulse server/)).toBeInTheDocument();
    apiMock.get.mockImplementation((path) => Promise.resolve({ data: path === '/analytics/overview' ? overview : { trend: [] } }));
    await userEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Critical CPU utilization')).toBeInTheDocument();
  });
});

describe('Device table', () => {
  const t = { cpuWarning: 70, cpuCritical: 85, ramWarning: 75, ramCritical: 90, diskWarning: 80, diskCritical: 90 };
  const devices = [
    { deviceId: 'aaaaaaaa-1111', hostname: 'FIN-LT01', operatingSystem: 'Windows 11', agentType: 'python-agent', status: 'CRITICAL', lastHeartbeat: new Date().toISOString(), latest: { cpuUsage: 91.2, ramUsage: 40, diskUsage: 50 } },
    { deviceId: 'bbbbbbbb-2222', hostname: 'SIM-HR-WS002', operatingSystem: 'Windows 10', agentType: 'simulated', status: 'HEALTHY', lastHeartbeat: null, latest: {} },
  ];

  it('renders every column and labels simulated devices', () => {
    wrap(<DevicesTable devices={devices} thresholds={t} now={Date.now()} isAdmin onDelete={() => {}} />);
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    const first = within(rows[1]);
    expect(first.getByText('FIN-LT01')).toBeInTheDocument();
    expect(first.getByText('Real agent')).toBeInTheDocument();
    expect(first.getByText('91.2%')).toBeInTheDocument();
    expect(first.getByText('Critical')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Simulated')).toBeInTheDocument();
    expect(within(rows[2]).getByText('never')).toBeInTheDocument();
  });

  it('hides delete for technicians', () => {
    wrap(<DevicesTable devices={devices} thresholds={t} now={Date.now()} isAdmin={false} onDelete={() => {}} />);
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });
});

describe('Incident filters', () => {
  it('emits filter changes', async () => {
    const onChange = vi.fn();
    const filters = { search: '', status: 'OPEN', severity: '', simulated: '', sort: 'severity' };
    wrap(<IncidentFilters filters={filters} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Filter by severity'), 'CRITICAL');
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, severity: 'CRITICAL' });
    await userEvent.selectOptions(screen.getByLabelText('Filter by status'), 'RESOLVED');
    expect(onChange).toHaveBeenLastCalledWith({ ...filters, status: 'RESOLVED' });
  });
});

describe('Approval workflow', () => {
  const base = {
    _id: 'r1',
    actionId: 'ACT-000007',
    actionType: 'restart_demo_app',
    label: 'Restart configured demo application',
    riskLevel: 'medium',
    deviceId: 'd1',
    deviceHostname: 'PC-1',
    incidentId: 'INC-000003',
    approvalStatus: 'PENDING',
    executionStatus: 'NOT_STARTED',
    requestedBy: { name: 'Tech' },
    createdAt: new Date().toISOString(),
    parameters: {},
    log: [],
  };

  it('admin approves, then executes', async () => {
    const onChange = vi.fn();
    apiMock.post.mockResolvedValueOnce({ data: { ...base, approvalStatus: 'APPROVED' } });
    const { rerender } = wrap(<RemediationItem rem={base} onChange={onChange} />);
    expect(screen.getByText('Awaiting approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /execute/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(apiMock.post).toHaveBeenCalledWith('/remediations/ACT-000007/approve', undefined);
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    apiMock.post.mockResolvedValueOnce({ data: { ...base, approvalStatus: 'APPROVED', executionStatus: 'QUEUED' } });
    rerender(
      <MemoryRouter>
        <RemediationItem rem={{ ...base, approvalStatus: 'APPROVED' }} onChange={onChange} />
      </MemoryRouter>
    );
    await userEvent.click(screen.getByRole('button', { name: /execute/i }));
    expect(apiMock.post).toHaveBeenLastCalledWith('/remediations/ACT-000007/execute', undefined);
  });

  it('rejection requires a reason', async () => {
    apiMock.post.mockResolvedValue({ data: { ...base, approvalStatus: 'REJECTED' } });
    wrap(<RemediationItem rem={base} />);
    await userEvent.click(screen.getByRole('button', { name: /^reject$/i }));
    const confirm = screen.getByRole('button', { name: /reject action/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Reason'), 'User is presenting');
    await userEvent.click(confirm);
    expect(apiMock.post).toHaveBeenCalledWith('/remediations/ACT-000007/reject', { reason: 'User is presenting' });
  });

  it('technicians see no approval controls', () => {
    authState.value = { ...authState.value, isAdmin: false, user: { role: 'technician' } };
    wrap(<RemediationItem rem={base} />);
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.getByText('Admin approval required')).toBeInTheDocument();
  });

  it('shows labelled execution results', () => {
    wrap(<RemediationItem rem={{ ...base, approvalStatus: 'APPROVED', executionStatus: 'SUCCEEDED', executionMode: 'SIMULATED', executionResult: { summary: 'SIMULATED: restarted worker', durationMs: 1200 } }} />);
    expect(screen.getByText('Succeeded')).toBeInTheDocument();
    expect(screen.getByText('Simulated run')).toBeInTheDocument();
    expect(screen.getByText('SIMULATED: restarted worker')).toBeInTheDocument();
  });
});
