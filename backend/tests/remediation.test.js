import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditLog, Incident, Remediation } from '../src/models/index.js';
import { sweepTimeouts } from '../src/services/remediation/remediationService.js';
import { api, connect, createUser, disconnect, registerAgent, reset, sendTelemetry } from './helpers.js';

beforeAll(connect);
beforeEach(reset);
afterAll(disconnect);

async function setup(capabilities = { demoApp: true, safeTempDir: true }) {
  const agent = await registerAgent({ capabilities });
  await sendTelemetry(agent, { cpuUsage: 92, processes: [{ pid: 9, name: 'demo', cpuPercent: 80, memoryPercent: 2, isDemoApp: true }] });
  const incident = await Incident.findOne({ deviceId: agent.deviceId, ruleId: 'cpu_high' });
  return { agent, incident, admin: await createUser('admin'), tech: await createUser('technician') };
}

describe('remediation workflow', () => {
  it('runs request → approve → execute → agent result with audit trail', async () => {
    const { agent, incident, admin, tech } = await setup();

    const req = await api().post('/api/remediations').set(tech.auth).send({ incidentId: incident.incidentId, actionType: 'restart_demo_app' });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ approvalStatus: 'PENDING', executionStatus: 'NOT_STARTED' });
    const id = req.body.actionId;
    expect((await Incident.findById(incident._id)).status).toBe('PENDING_APPROVAL');

    // technicians cannot approve or execute
    expect((await api().post(`/api/remediations/${id}/approve`).set(tech.auth)).status).toBe(403);
    expect((await api().post(`/api/remediations/${id}/execute`).set(tech.auth)).status).toBe(403);
    // approval is mandatory
    expect((await api().post(`/api/remediations/${id}/execute`).set(admin.auth)).status).toBe(409);

    const approved = await api().post(`/api/remediations/${id}/approve`).set(admin.auth);
    expect(approved.body.approvalStatus).toBe('APPROVED');
    expect(approved.body.approvedBy.name).toBe(admin.user.name);
    expect((await api().post(`/api/remediations/${id}/approve`).set(admin.auth)).status).toBe(409);

    const queued = await api().post(`/api/remediations/${id}/execute`).set(admin.auth);
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({ executionStatus: 'QUEUED', executionMode: 'REAL' });
    expect((await Incident.findById(incident._id)).status).toBe('REMEDIATION_IN_PROGRESS');

    const poll = await api().get('/api/agent/commands').set(agent.headers);
    expect(poll.body.commands).toEqual([{ actionId: id, actionType: 'restart_demo_app', parameters: {}, timeoutSeconds: 60 }]);
    expect((await api().get('/api/agent/commands').set(agent.headers)).body.commands).toEqual([]); // claimed once

    const result = await api()
      .post(`/api/agent/commands/${id}/result`)
      .set(agent.headers)
      .send({ status: 'SUCCEEDED', summary: 'Restarted demo app', verification: { processRunning: true }, durationMs: 1500 });
    expect(result.status).toBe(200);
    const done = await Remediation.findOne({ actionId: id }).lean();
    expect(done).toMatchObject({ executionStatus: 'SUCCEEDED', executionResult: { summary: 'Restarted demo app' } });
    expect(done.completedAt).toBeInstanceOf(Date);

    // second result is rejected
    expect((await api().post(`/api/agent/commands/${id}/result`).set(agent.headers).send({ status: 'FAILED', summary: 'x' })).status).toBe(409);

    const actions = (await AuditLog.find({ entityId: id }).sort({ timestamp: 1 }).lean()).map((a) => a.action);
    expect(actions).toEqual(['remediation.requested', 'remediation.approved', 'remediation.executed', 'remediation.succeeded']);
  });

  it('blocks duplicate active requests and unknown actions', async () => {
    const { incident, tech } = await setup();
    const body = { incidentId: incident.incidentId, actionType: 'list_top_cpu_processes' };
    expect((await api().post('/api/remediations').set(tech.auth).send(body)).status).toBe(201);
    expect((await api().post('/api/remediations').set(tech.auth).send(body)).status).toBe(409);
    const unknown = await api().post('/api/remediations').set(tech.auth).send({ ...body, actionType: 'format_disk' });
    expect(unknown.status).toBe(400);
    const badParams = await api().post('/api/remediations').set(tech.auth).send({ ...body, actionType: 'list_top_memory_processes', parameters: { limit: 500 } });
    expect(badParams.status).toBe(400);
    const extra = await api().post('/api/remediations').set(tech.auth).send({ ...body, actionType: 'network_diagnostics', parameters: { cmd: 'rm -rf /' } });
    expect(extra.status).toBe(400);
  });

  it('refuses actions the device agent has not enabled', async () => {
    const { incident, tech } = await setup({ demoApp: false, safeTempDir: false });
    const res = await api().post('/api/remediations').set(tech.auth).send({ incidentId: incident.incidentId, actionType: 'restart_demo_app' });
    expect(res.status).toBe(409);
  });

  it('agents cannot claim or report other devices’ commands', async () => {
    const { incident, admin } = await setup();
    const other = await registerAgent({ hostname: 'OTHER' });
    const req = await api().post('/api/remediations').set(admin.auth).send({ incidentId: incident.incidentId, actionType: 'list_top_cpu_processes' });
    await api().post(`/api/remediations/${req.body.actionId}/approve`).set(admin.auth);
    await api().post(`/api/remediations/${req.body.actionId}/execute`).set(admin.auth);
    expect((await api().get('/api/agent/commands').set(other.headers)).body.commands).toEqual([]);
    const spoof = await api().post(`/api/agent/commands/${req.body.actionId}/result`).set(other.headers).send({ status: 'SUCCEEDED', summary: 'x' });
    expect(spoof.status).toBe(404);
  });

  it('rejection records a reason and returns the incident to investigation', async () => {
    const { incident, admin } = await setup();
    const req = await api().post('/api/remediations').set(admin.auth).send({ incidentId: incident.incidentId, actionType: 'restart_demo_app' });
    expect((await api().post(`/api/remediations/${req.body.actionId}/reject`).set(admin.auth).send({})).status).toBe(400);
    const rej = await api().post(`/api/remediations/${req.body.actionId}/reject`).set(admin.auth).send({ reason: 'User is presenting' });
    expect(rej.body).toMatchObject({ approvalStatus: 'REJECTED', rejectedReason: 'User is presenting' });
    expect((await Incident.findById(incident._id)).status).toBe('INVESTIGATING');
  });

  it('a failed result marks the incident FAILED', async () => {
    const { agent, incident, admin } = await setup();
    const req = await api().post('/api/remediations').set(admin.auth).send({ incidentId: incident.incidentId, actionType: 'restart_demo_app' });
    await api().post(`/api/remediations/${req.body.actionId}/approve`).set(admin.auth);
    await api().post(`/api/remediations/${req.body.actionId}/execute`).set(admin.auth);
    await api().get('/api/agent/commands').set(agent.headers);
    await api().post(`/api/agent/commands/${req.body.actionId}/result`).set(agent.headers).send({ status: 'FAILED', summary: 'Could not restart', error: 'Exit code 1' });
    const inc = await Incident.findById(incident._id);
    expect(inc.status).toBe('FAILED');
    expect(inc.isOpen).toBe(true);
  });

  it('times out actions the agent never picks up, and supports cancellation', async () => {
    const { incident, admin } = await setup();
    const a = await api().post('/api/remediations').set(admin.auth).send({ incidentId: incident.incidentId, actionType: 'list_top_cpu_processes' });
    await api().post(`/api/remediations/${a.body.actionId}/approve`).set(admin.auth);
    await api().post(`/api/remediations/${a.body.actionId}/execute`).set(admin.auth);
    expect(await sweepTimeouts(new Date(Date.now() + 10 * 60_000))).toBe(1);
    expect((await Remediation.findOne({ actionId: a.body.actionId })).executionStatus).toBe('TIMED_OUT');

    const b = await api().post('/api/remediations').set(admin.auth).send({ incidentId: incident.incidentId, actionType: 'network_diagnostics' });
    await api().post(`/api/remediations/${b.body.actionId}/approve`).set(admin.auth);
    await api().post(`/api/remediations/${b.body.actionId}/execute`).set(admin.auth);
    const cancelled = await api().post(`/api/remediations/${b.body.actionId}/cancel`).set(admin.auth);
    expect(cancelled.body.executionStatus).toBe('CANCELLED');
  });

  it('lists pending, approved and history views', async () => {
    const { incident, admin } = await setup();
    await api().post('/api/remediations').set(admin.auth).send({ incidentId: incident.incidentId, actionType: 'list_top_cpu_processes' });
    const pending = await api().get('/api/remediations?view=pending').set(admin.auth);
    expect(pending.body.data).toHaveLength(1);
    const history = await api().get('/api/remediations/history').set(admin.auth);
    expect(history.body.data).toHaveLength(0);
    const catalog = await api().get('/api/remediations/catalog').set(admin.auth);
    expect(catalog.body.data.map((a) => a.type)).toContain('clear_temp_files');
  });
});
