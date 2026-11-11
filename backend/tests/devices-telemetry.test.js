import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Device, Telemetry } from '../src/models/index.js';
import { api, connect, createUser, disconnect, registerAgent, reset, sendTelemetry } from './helpers.js';

beforeAll(connect);
beforeEach(reset);
afterAll(disconnect);

describe('device registration', () => {
  it('rejects an invalid enrollment key', async () => {
    const res = await api().post('/api/devices/register').send({ enrollmentKey: 'wrong-key-123', hostname: 'PC' });
    expect(res.status).toBe(401);
  });

  it('registers a device and never exposes the secret hash', async () => {
    const agent = await registerAgent();
    expect(agent.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(agent.deviceSecret.length).toBeGreaterThan(30);
    const stored = await Device.findOne({ deviceId: agent.deviceId }).select('+secretHash').lean();
    expect(stored.secretHash).not.toBe(agent.deviceSecret);
    expect(stored.agentType).toBe('python-agent');

    const { auth } = await createUser('technician');
    const list = await api().get('/api/devices').set(auth);
    expect(list.status).toBe(200);
    expect(list.body.pagination.total).toBe(1);
    expect(JSON.stringify(list.body)).not.toMatch(/secretHash|deviceSecret/);
    const detail = await api().get(`/api/devices/${agent.deviceId}`).set(auth);
    expect(detail.body).not.toHaveProperty('secretHash');
  });

  it('agents cannot register themselves as simulated devices', async () => {
    const agent = await registerAgent({ agentType: 'simulated' });
    expect((await Device.findOne({ deviceId: agent.deviceId })).agentType).toBe('python-agent');
  });

  it('re-enrollment keeps the device id and invalidates the old secret', async () => {
    const first = await registerAgent();
    const second = await registerAgent({ deviceId: first.deviceId });
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.reenrolled).toBe(true);
    expect((await sendTelemetry(first)).status).toBe(401);
    expect((await sendTelemetry(second)).status).toBe(202);
    expect(await Device.countDocuments()).toBe(1);
  });

  it('only admins can delete devices; deletion removes telemetry', async () => {
    const agent = await registerAgent();
    await sendTelemetry(agent);
    const tech = await createUser('technician');
    expect((await api().delete(`/api/devices/${agent.deviceId}`).set(tech.auth)).status).toBe(403);
    const admin = await createUser('admin');
    const res = await api().delete(`/api/devices/${agent.deviceId}`).set(admin.auth);
    expect(res.status).toBe(200);
    expect(await Telemetry.countDocuments({ deviceId: agent.deviceId })).toBe(0);
    expect((await api().get(`/api/devices/${agent.deviceId}`).set(admin.auth)).status).toBe(404);
  });

  it('filters and searches the device list', async () => {
    await registerAgent({ hostname: 'FIN-LAPTOP-01' });
    const b = await registerAgent({ hostname: 'ENG-DESK-02' });
    await sendTelemetry(b, { cpuUsage: 95 });
    const { auth } = await createUser('admin');
    const search = await api().get('/api/devices?search=fin-lap').set(auth);
    expect(search.body.data.map((d) => d.hostname)).toEqual(['FIN-LAPTOP-01']);
    const critical = await api().get('/api/devices?status=CRITICAL').set(auth);
    expect(critical.body.data.map((d) => d.hostname)).toEqual(['ENG-DESK-02']);
    expect((await api().get('/api/devices?status=BOGUS').set(auth)).status).toBe(400);
  });
});

describe('telemetry ingestion', () => {
  it('requires device credentials', async () => {
    expect((await api().post('/api/telemetry').send({ cpuUsage: 1, ramUsage: 1, diskUsage: 1 })).status).toBe(401);
    const res = await api()
      .post('/api/telemetry')
      .set({ 'X-Device-Id': 'x', 'X-Device-Secret': 'y' })
      .send({ cpuUsage: 1, ramUsage: 1, diskUsage: 1 });
    expect(res.status).toBe(401);
  });

  it('validates the payload', async () => {
    const agent = await registerAgent();
    expect((await sendTelemetry(agent, { cpuUsage: 150 })).status).toBe(400);
    expect((await sendTelemetry(agent, { ramUsage: 'lots' })).status).toBe(400);
    expect(await Telemetry.countDocuments()).toBe(0);
  });

  it('stores telemetry, updates device health and exposes history', async () => {
    const agent = await registerAgent();
    const res = await sendTelemetry(agent, { cpuUsage: 33.3 });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'HEALTHY', findings: [] });

    const device = await Device.findOne({ deviceId: agent.deviceId }).lean();
    expect(device.status).toBe('HEALTHY');
    expect(device.latest.cpuUsage).toBe(33.3);
    expect(device.latest.processes).toHaveLength(2);
    expect(device.lastHeartbeat).toBeInstanceOf(Date);

    await sendTelemetry(agent, { cpuUsage: 75 });
    const { auth } = await createUser('technician');
    const latest = await api().get(`/api/telemetry/${agent.deviceId}`).set(auth);
    expect(latest.body.data.map((s) => s.cpuUsage)).toEqual([33.3, 75]);
    const history = await api().get(`/api/telemetry/${agent.deviceId}/history?range=1h`).set(auth);
    expect(history.status).toBe(200);
    expect(history.body.points.length).toBeGreaterThan(0);
    expect((await api().get('/api/telemetry/unknown-device').set(auth)).status).toBe(404);
  });
});
