import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Device, Incident, Remediation } from '../src/models/index.js';
import { simulator } from '../src/services/simulator/simulator.js';
import { api, connect, createUser, disconnect, registerAgent, reset, sendTelemetry } from './helpers.js';

beforeAll(connect);
beforeEach(async () => {
  if (simulator.running) await simulator.stop();
  await reset();
});
afterAll(async () => {
  if (simulator.running) await simulator.stop();
  await disconnect();
});

const waitFor = async (fn, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('condition not met');
};

describe('simulation', () => {
  it('only admins control the simulator', async () => {
    const tech = await createUser('technician');
    expect((await api().post('/api/simulation/start').set(tech.auth).send({ count: 2 })).status).toBe(403);
  });

  it('creates labelled virtual devices that flow through the real pipeline', async () => {
    const { auth } = await createUser('admin');
    const res = await api().post('/api/simulation/start').set(auth).send({ count: 20, intervalMs: 60000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ running: true, deviceCount: 20 });
    const devices = await Device.find({ agentType: 'simulated' }).lean();
    expect(devices).toHaveLength(20);
    expect(new Set(devices.map((d) => d.deviceId)).size).toBe(20);
    expect(devices.every((d) => d.latest?.cpuUsage !== undefined && d.status !== 'PENDING')).toBe(true);
    expect(new Set(devices.map((d) => d.status)).size).toBeGreaterThan(1); // mixed health states

    const sc = await api().post('/api/simulation/scenario').set(auth).send({ scenario: 'high_cpu' });
    const target = sc.body.devices[0].deviceId;
    await simulator.tick();
    const inc = await Incident.findOne({ deviceId: target, ruleId: 'cpu_high', isOpen: true }).lean();
    expect(inc.simulated).toBe(true);
    expect(inc.recommendedActions).toContain('restart_demo_app');

    // simulated remediation is executed and labelled
    const req = await api().post('/api/remediations').set(auth).send({ incidentId: inc.incidentId, actionType: 'restart_demo_app' });
    await api().post(`/api/remediations/${req.body.actionId}/approve`).set(auth);
    const ex = await api().post(`/api/remediations/${req.body.actionId}/execute`).set(auth);
    expect(ex.body.executionMode).toBe('SIMULATED');
    const done = await waitFor(async () => {
      const r = await Remediation.findOne({ actionId: req.body.actionId }).lean();
      return r.executionStatus === 'SUCCEEDED' && r;
    });
    expect(done.executionResult.summary).toMatch(/^SIMULATED:/);

    await simulator.tick();
    await simulator.tick();
    expect((await Incident.findById(inc._id)).status).toBe('RESOLVED');

    const stop = await api().post('/api/simulation/stop').set(auth);
    expect(stop.body.running).toBe(false);
    expect(await Incident.countDocuments({ simulated: true, isOpen: true })).toBe(0);
    const resetRes = await api().post('/api/simulation/reset').set(auth);
    expect(resetRes.body.devices).toBe(20);
    expect(await Device.countDocuments({ agentType: 'simulated' })).toBe(0);
  });

  it('rejects scenarios while stopped', async () => {
    const { auth } = await createUser('admin');
    expect((await api().post('/api/simulation/scenario').set(auth).send({ scenario: 'high_ram' })).status).toBe(409);
  });
});

describe('analytics', () => {
  it('overview reflects stored data', async () => {
    const a = await registerAgent({ hostname: 'A' });
    const b = await registerAgent({ hostname: 'B' });
    await sendTelemetry(a, { cpuUsage: 10 });
    await sendTelemetry(b, { diskUsage: 95 });
    const { auth } = await createUser('technician');
    const res = await api().get('/api/analytics/overview').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.devices).toMatchObject({ total: 2, healthy: 1, critical: 1, healthPercentage: 50, real: 2 });
    expect(res.body.incidents).toMatchObject({ active: 1, resolved: 0 });
    expect(res.body.incidents.openBySeverity.CRITICAL).toBe(1);
    expect(res.body.recentIncidents).toHaveLength(1);

    for (const path of ['device-health', 'incidents', 'remediation']) {
      const r = await api().get(`/api/analytics/${path}?range=24h`).set(auth);
      expect(r.status).toBe(200);
    }
    const health = await api().get('/api/analytics/device-health?range=1h').set(auth);
    expect(health.body.availability).toHaveLength(2);
    const inc = await api().get('/api/analytics/incidents?range=24h').set(auth);
    expect(inc.body.commonProblems[0]).toMatchObject({ ruleId: 'disk_high', count: 1 });
    expect((await api().get('/api/analytics/incidents?range=99y').set(auth)).status).toBe(400);
  });

  it('settings: thresholds are validated and applied to diagnostics', async () => {
    const admin = await createUser('admin');
    const tech = await createUser('technician');
    expect((await api().patch('/api/settings').set(tech.auth).send({ thresholds: { cpuWarning: 50 } })).status).toBe(403);
    expect((await api().patch('/api/settings').set(admin.auth).send({ thresholds: { cpuWarning: 90, cpuCritical: 80 } })).status).toBe(400);
    const ok = await api().patch('/api/settings').set(admin.auth).send({ thresholds: { cpuWarning: 40, cpuCritical: 60 } });
    expect(ok.status).toBe(200);
    expect(ok.body).not.toHaveProperty('enrollmentKey');
    const agent = await registerAgent();
    expect((await sendTelemetry(agent, { cpuUsage: 50 })).body.status).toBe('WARNING');
    expect((await api().get('/api/settings/enrollment-key').set(tech.auth)).status).toBe(403);
    expect((await api().get('/api/settings/enrollment-key').set(admin.auth)).body.enrollmentKey).toBeTruthy();
  });
});
