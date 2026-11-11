import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Device, Incident } from '../src/models/index.js';
import { sweepOffline } from '../src/services/healthMonitor.js';
import { api, connect, createUser, disconnect, registerAgent, reset, sendTelemetry } from './helpers.js';

beforeAll(connect);
beforeEach(reset);
afterAll(disconnect);

describe('incident generation', () => {
  it('creates an explainable incident for abnormal telemetry', async () => {
    const agent = await registerAgent();
    const res = await sendTelemetry(agent, { cpuUsage: 93, processes: [{ pid: 5, name: 'render.exe', cpuPercent: 71, memoryPercent: 4 }] });
    expect(res.body.status).toBe('CRITICAL');
    const incidents = await Incident.find({ deviceId: agent.deviceId }).lean();
    expect(incidents).toHaveLength(1);
    const inc = incidents[0];
    expect(inc).toMatchObject({ ruleId: 'cpu_high', severity: 'CRITICAL', status: 'NEW', isOpen: true });
    expect(inc.incidentId).toMatch(/^INC-\d{6}$/);
    expect(inc.rootCause).toContain('render.exe');
    expect(inc.recommendation).toBeTruthy();
    expect(inc.confidence).toBeGreaterThan(0);
    expect(inc.confidenceBreakdown).toHaveProperty('persistence');
  });

  it('prevents duplicate incidents for the same unresolved problem', async () => {
    const agent = await registerAgent();
    for (let i = 0; i < 4; i++) await sendTelemetry(agent, { cpuUsage: 90 });
    const open = await Incident.find({ deviceId: agent.deviceId, ruleId: 'cpu_high' }).lean();
    expect(open).toHaveLength(1);
    expect(open[0].occurrences).toBe(4);
  });

  it('prevents duplicates under concurrent ingestion', async () => {
    const agent = await registerAgent();
    await Promise.all(Array.from({ length: 6 }, () => sendTelemetry(agent, { diskUsage: 95 })));
    expect(await Incident.countDocuments({ deviceId: agent.deviceId, ruleId: 'disk_high' })).toBe(1);
  });

  it('escalates severity on the existing incident instead of opening a new one', async () => {
    const agent = await registerAgent();
    await sendTelemetry(agent, { ramUsage: 80 });
    await sendTelemetry(agent, { ramUsage: 95 });
    const incs = await Incident.find({ deviceId: agent.deviceId }).lean();
    expect(incs).toHaveLength(1);
    expect(incs[0].severity).toBe('CRITICAL');
    expect(incs[0].timeline.some((t) => t.type === 'severity')).toBe(true);
  });

  it('auto-resolves after consecutive clean samples and keeps history', async () => {
    const agent = await registerAgent();
    await sendTelemetry(agent, { cpuUsage: 90 });
    await sendTelemetry(agent, { cpuUsage: 20 });
    expect((await Incident.findOne({ deviceId: agent.deviceId })).isOpen).toBe(true);
    await sendTelemetry(agent, { cpuUsage: 20 });
    const resolved = await Incident.findOne({ deviceId: agent.deviceId }).lean();
    expect(resolved).toMatchObject({ status: 'RESOLVED', isOpen: false, resolvedBy: 'system' });
    expect(resolved.resolutionTimeSeconds).toBeGreaterThanOrEqual(0);

    await sendTelemetry(agent, { cpuUsage: 91 });
    const all = await Incident.find({ deviceId: agent.deviceId }).sort({ createdAt: 1 }).lean();
    expect(all).toHaveLength(2);
    expect(all[1].isOpen).toBe(true);
  });

  it('marks silent devices offline and resolves the incident when they return', async () => {
    const agent = await registerAgent();
    await sendTelemetry(agent);
    await Device.updateOne({ deviceId: agent.deviceId }, { lastHeartbeat: new Date(Date.now() - 120_000) });
    expect(await sweepOffline()).toBe(1);
    expect((await Device.findOne({ deviceId: agent.deviceId })).status).toBe('OFFLINE');
    expect(await Incident.countDocuments({ ruleId: 'device_offline', isOpen: true })).toBe(1);
    expect(await sweepOffline()).toBe(0); // no duplicate
    await sendTelemetry(agent);
    expect(await Incident.countDocuments({ ruleId: 'device_offline', isOpen: true })).toBe(0);
  });

  it('graceful agent shutdown does not raise an offline incident', async () => {
    const agent = await registerAgent();
    await sendTelemetry(agent);
    expect((await api().post('/api/agent/shutdown').set(agent.headers)).status).toBe(204);
    await Device.updateOne({ deviceId: agent.deviceId }, { lastHeartbeat: new Date(Date.now() - 120_000) });
    expect(await sweepOffline()).toBe(0);
  });
});

describe('incident API', () => {
  it('lists with filters and severity sorting', async () => {
    const a = await registerAgent({ hostname: 'A' });
    const b = await registerAgent({ hostname: 'B' });
    await sendTelemetry(a, { ramUsage: 80 });
    await sendTelemetry(b, { diskUsage: 95 });
    const { auth } = await createUser('technician');
    const sorted = await api().get('/api/incidents?sort=severity').set(auth);
    expect(sorted.body.data.map((i) => i.severity)).toEqual(['CRITICAL', 'WARNING']);
    const filtered = await api().get('/api/incidents?severity=WARNING').set(auth);
    expect(filtered.body.data).toHaveLength(1);
    const searched = await api().get('/api/incidents?search=disk').set(auth);
    expect(searched.body.data[0].ruleId).toBe('disk_high');
  });

  it('updates status/assignment and enforces lifecycle rules', async () => {
    const agent = await registerAgent();
    await sendTelemetry(agent, { cpuUsage: 90 });
    const inc = await Incident.findOne();
    const tech = await createUser('technician');

    const bad = await api().patch(`/api/incidents/${inc.incidentId}`).set(tech.auth).send({ status: 'RESOLVED' });
    expect(bad.status).toBe(400);
    const ok = await api()
      .patch(`/api/incidents/${inc.incidentId}`)
      .set(tech.auth)
      .send({ status: 'INVESTIGATING', assignedTo: tech.user._id.toString(), note: 'Looking into it' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('INVESTIGATING');
    expect(ok.body.assignedTo.name).toBe(tech.user.name);

    expect((await api().post(`/api/incidents/${inc.incidentId}/resolve`).set(tech.auth).send({})).status).toBe(400);
    const resolved = await api().post(`/api/incidents/${inc.incidentId}/resolve`).set(tech.auth).send({ notes: 'Closed the runaway app' });
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', resolutionNotes: 'Closed the runaway app' });
    expect((await api().patch(`/api/incidents/${inc.incidentId}`).set(tech.auth).send({ note: 'x' })).status).toBe(409);
  });
});
