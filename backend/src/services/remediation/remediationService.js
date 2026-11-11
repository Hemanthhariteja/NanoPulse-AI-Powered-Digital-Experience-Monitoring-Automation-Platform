import { Device, Incident, Remediation, nextId } from '../../models/index.js';
import { env } from '../../config/env.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { paginate } from '../../utils/pagination.js';
import { audit } from '../auditService.js';
import { bus } from '../bus.js';
import { applyStatus, summarize as summarizeIncident } from '../incidentService.js';
import { emit } from '../realtime.js';
import { ACTIONS, deviceSupports, validateParams } from './catalog.js';

/** How long a queued command may wait for the agent to pick it up. */
export const PICKUP_TIMEOUT_SECONDS = 60;
const ACTIVE_EXECUTION = ['NOT_STARTED', 'QUEUED', 'RUNNING'];

const actorOf = (user) => (user ? { id: user._id || user.id, name: user.name, type: 'user' } : { name: 'system', type: 'system' });

export function summarize(rem) {
  const o = typeof rem.toObject === 'function' ? rem.toObject() : rem;
  const { __v, ...rest } = o;
  return rest;
}

function publish(rem) {
  emit('remediation:updated', summarize(rem));
}

async function findRemediation(id) {
  const filter = /^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { actionId: id };
  const rem = await Remediation.findOne(filter);
  if (!rem) throw notFound('Remediation');
  return rem;
}

async function updateIncidentFor(rem, to, message, by = 'system') {
  if (!rem.incident) return;
  const inc = await Incident.findById(rem.incident);
  if (!inc) return;
  const changed = inc.isOpen ? applyStatus(inc, to, { by, message, strict: false }) : false;
  if (!changed) inc.timeline.push({ type: 'remediation', message, by });
  await inc.save();
  emit('incident:updated', summarizeIncident(inc));
}

/**
 * Request (recommend) a remediation. Requests always start in approval PENDING;
 * nothing executes until an administrator approves and then executes it.
 */
export async function requestRemediation({ incidentId, deviceId, actionType, parameters }, user) {
  if (!ACTIONS[actionType]) throw badRequest(`Action "${actionType}" is not on the remediation allowlist`);

  let incident = null;
  if (incidentId) {
    const filter = /^[a-f0-9]{24}$/i.test(incidentId) ? { _id: incidentId } : { incidentId };
    incident = await Incident.findOne(filter);
    if (!incident) throw notFound('Incident');
    if (!incident.isOpen) throw conflict('Cannot request remediation for a resolved incident');
    if (deviceId && deviceId !== incident.deviceId) throw badRequest('deviceId does not match the incident');
    deviceId = incident.deviceId;
  }
  if (!deviceId) throw badRequest('incidentId or deviceId is required');

  const device = await Device.findOne({ deviceId }).lean();
  if (!device) throw notFound('Device');
  if (!deviceSupports(device, actionType)) {
    throw conflict(`Device ${device.hostname} does not support "${actionType}" (agent capability not configured)`);
  }

  let params;
  try {
    params = validateParams(actionType, parameters);
  } catch (err) {
    throw badRequest(err.message);
  }

  const duplicate = await Remediation.findOne({
    deviceId,
    actionType,
    ...(incident ? { incident: incident._id } : { incident: null }),
    approvalStatus: { $ne: 'REJECTED' },
    executionStatus: { $in: ACTIVE_EXECUTION },
  }).lean();
  if (duplicate) throw conflict(`An active "${actionType}" request already exists (${duplicate.actionId})`);

  const action = ACTIONS[actionType];
  const rem = await Remediation.create({
    actionId: await nextId('remediation', 'ACT'),
    incident: incident?._id ?? null,
    incidentId: incident?.incidentId ?? null,
    deviceId,
    deviceHostname: device.hostname,
    simulated: device.agentType === 'simulated',
    actionType,
    label: action.label,
    riskLevel: action.riskLevel,
    parameters: params,
    timeoutSeconds: action.timeoutSeconds,
    requestedBy: actorOf(user),
    log: [{ message: `Requested by ${user?.name || 'system'}` }],
  });

  if (incident && ['NEW', 'INVESTIGATING', 'FAILED'].includes(incident.status)) {
    await updateIncidentFor(rem, 'PENDING_APPROVAL', `Remediation ${rem.actionId} (${action.label}) requested`, user?.name);
  } else if (incident) {
    await updateIncidentFor(rem, incident.status, `Remediation ${rem.actionId} (${action.label}) requested`, user?.name);
  }
  await audit({
    actor: user,
    action: 'remediation.requested',
    entityType: 'remediation',
    entityId: rem.actionId,
    details: { actionType, deviceId, incidentId: rem.incidentId, parameters: params },
  });
  publish(rem);
  return summarize(rem);
}

export async function approveRemediation(id, user) {
  const rem = await findRemediation(id);
  if (rem.approvalStatus !== 'PENDING') throw conflict(`Remediation is already ${rem.approvalStatus}`);
  rem.approvalStatus = 'APPROVED';
  rem.approvedBy = actorOf(user);
  rem.approvedAt = new Date();
  rem.log.push({ message: `Approved by ${user.name}` });
  await rem.save();
  await audit({ actor: user, action: 'remediation.approved', entityType: 'remediation', entityId: rem.actionId, details: { actionType: rem.actionType, deviceId: rem.deviceId } });
  await updateIncidentFor(rem, 'PENDING_APPROVAL', `Remediation ${rem.actionId} approved by ${user.name}`, user.name);
  publish(rem);
  return summarize(rem);
}

export async function rejectRemediation(id, reason, user) {
  const rem = await findRemediation(id);
  if (rem.approvalStatus !== 'PENDING') throw conflict(`Remediation is already ${rem.approvalStatus}`);
  rem.approvalStatus = 'REJECTED';
  rem.rejectedReason = reason;
  rem.executionStatus = 'CANCELLED';
  rem.completedAt = new Date();
  rem.log.push({ level: 'warn', message: `Rejected by ${user.name}: ${reason}` });
  await rem.save();
  await audit({ actor: user, action: 'remediation.rejected', entityType: 'remediation', entityId: rem.actionId, details: { reason } });
  const othersActive = rem.incident
    ? await Remediation.exists({ incident: rem.incident, _id: { $ne: rem._id }, executionStatus: { $in: ACTIVE_EXECUTION }, approvalStatus: { $ne: 'REJECTED' } })
    : true;
  await updateIncidentFor(rem, othersActive ? 'PENDING_APPROVAL' : 'INVESTIGATING', `Remediation ${rem.actionId} rejected: ${reason}`, user.name);
  publish(rem);
  return summarize(rem);
}

/** Validate and queue an approved action for the device's agent (or the simulator). */
export async function executeRemediation(id, user) {
  const rem = await findRemediation(id);
  if (rem.approvalStatus !== 'APPROVED') throw conflict('Remediation must be approved before it can be executed');
  if (rem.executionStatus !== 'NOT_STARTED') throw conflict(`Remediation is already ${rem.executionStatus}`);

  const device = await Device.findOne({ deviceId: rem.deviceId }).lean();
  if (!device) throw conflict('Target device no longer exists');
  if (device.status === 'OFFLINE') throw conflict(`Device ${device.hostname} is offline; it cannot receive the action`);
  if (!deviceSupports(device, rem.actionType)) throw conflict('Device no longer supports this action');
  try {
    rem.parameters = validateParams(rem.actionType, rem.parameters);
  } catch (err) {
    throw conflict(`Stored parameters failed validation: ${err.message}`);
  }

  const now = new Date();
  rem.executionStatus = 'QUEUED';
  rem.executionMode = device.agentType === 'simulated' ? 'SIMULATED' : 'REAL';
  rem.executedBy = actorOf(user);
  rem.queuedAt = now;
  rem.timeoutAt = new Date(now.getTime() + (PICKUP_TIMEOUT_SECONDS + env.remediationGraceSeconds) * 1000);
  rem.log.push({ message: `Validated and queued for ${device.hostname} by ${user.name} (${rem.executionMode})` });
  await rem.save();

  await audit({ actor: user, action: 'remediation.executed', entityType: 'remediation', entityId: rem.actionId, details: { actionType: rem.actionType, deviceId: rem.deviceId, mode: rem.executionMode } });
  await updateIncidentFor(rem, 'REMEDIATION_IN_PROGRESS', `Remediation ${rem.actionId} (${rem.label}) dispatched to device`, user.name);
  publish(rem);
  if (rem.executionMode === 'SIMULATED') bus.emit('remediation:queued', summarize(rem));
  return summarize(rem);
}

export async function cancelRemediation(id, user) {
  const rem = await findRemediation(id);
  if (rem.executionStatus === 'RUNNING') throw conflict('The action is already running on the device and cannot be cancelled');
  if (!['NOT_STARTED', 'QUEUED'].includes(rem.executionStatus)) throw conflict(`Remediation is already ${rem.executionStatus}`);
  rem.executionStatus = 'CANCELLED';
  rem.completedAt = new Date();
  rem.log.push({ level: 'warn', message: `Cancelled by ${user.name}` });
  await rem.save();
  await audit({ actor: user, action: 'remediation.cancelled', entityType: 'remediation', entityId: rem.actionId });
  await updateIncidentFor(rem, 'INVESTIGATING', `Remediation ${rem.actionId} cancelled`, user.name);
  publish(rem);
  return summarize(rem);
}

/** Agent poll: atomically claim queued commands for this device and mark them RUNNING. */
export async function claimCommands(device, max = 5) {
  const commands = [];
  for (let i = 0; i < max; i++) {
    const now = new Date();
    const rem = await Remediation.findOneAndUpdate(
      { deviceId: device.deviceId, executionStatus: 'QUEUED' },
      { $set: { executionStatus: 'RUNNING', startedAt: now }, $push: { log: { at: now, message: 'Picked up by device agent' } } },
      { returnDocument: 'after', sort: { queuedAt: 1 } }
    );
    if (!rem) break;
    rem.timeoutAt = new Date(now.getTime() + (rem.timeoutSeconds + env.remediationGraceSeconds) * 1000);
    await rem.save();
    publish(rem);
    commands.push({ actionId: rem.actionId, actionType: rem.actionType, parameters: rem.parameters, timeoutSeconds: rem.timeoutSeconds });
  }
  return commands;
}

/** Record the execution result reported by the agent or simulator. */
export async function submitResult(device, actionId, result) {
  const rem = await Remediation.findOne({ actionId, deviceId: device.deviceId });
  if (!rem) throw notFound('Remediation');
  if (rem.executionStatus !== 'RUNNING') throw conflict(`Remediation is ${rem.executionStatus}; result not accepted`);
  if (result.mode && result.mode !== rem.executionMode) throw badRequest('Result mode does not match the execution mode');

  rem.executionStatus = result.status;
  rem.completedAt = new Date();
  rem.executionResult = {
    summary: result.summary,
    data: result.data,
    verification: result.verification,
    error: result.error,
    durationMs: result.durationMs,
  };
  rem.log.push({
    level: result.status === 'SUCCEEDED' ? 'info' : 'error',
    message: `${result.status}: ${result.summary}${result.error ? ` — ${result.error}` : ''}`,
  });
  await rem.save();

  await audit({
    actor: device,
    actorType: 'device',
    action: result.status === 'SUCCEEDED' ? 'remediation.succeeded' : 'remediation.failed',
    entityType: 'remediation',
    entityId: rem.actionId,
    details: { summary: result.summary, error: result.error, mode: rem.executionMode },
  });

  const action = ACTIONS[rem.actionType];
  if (result.status === 'SUCCEEDED') {
    await updateIncidentFor(
      rem,
      action.readOnly ? 'INVESTIGATING' : 'REMEDIATION_IN_PROGRESS',
      action.readOnly
        ? `Diagnostic ${rem.actionId} completed: ${result.summary}`
        : `Remediation ${rem.actionId} completed: ${result.summary}. Awaiting telemetry to verify the condition cleared.`
    );
  } else {
    await updateIncidentFor(rem, 'FAILED', `Remediation ${rem.actionId} failed: ${result.error || result.summary}`);
  }
  publish(rem);
  return summarize(rem);
}

/** Mark queued/running actions whose deadline has passed as TIMED_OUT. */
export async function sweepTimeouts(now = new Date()) {
  const expired = await Remediation.find({ executionStatus: { $in: ['QUEUED', 'RUNNING'] }, timeoutAt: { $lt: now } });
  for (const rem of expired) {
    const wasQueued = rem.executionStatus === 'QUEUED';
    rem.executionStatus = 'TIMED_OUT';
    rem.completedAt = now;
    rem.executionResult = {
      ...(rem.executionResult || {}),
      error: wasQueued ? 'Device did not pick up the action in time' : 'Device did not report a result before the timeout',
    };
    rem.log.push({ level: 'error', message: `Timed out (${wasQueued ? 'never picked up' : 'no result'})` });
    await rem.save();
    await audit({ action: 'remediation.timed_out', entityType: 'remediation', entityId: rem.actionId });
    await updateIncidentFor(rem, 'FAILED', `Remediation ${rem.actionId} timed out`);
    publish(rem);
  }
  return expired.length;
}

export async function listRemediations(q) {
  const filter = {};
  if (q.approvalStatus) filter.approvalStatus = q.approvalStatus;
  if (q.executionStatus) filter.executionStatus = q.executionStatus;
  if (q.deviceId) filter.deviceId = q.deviceId;
  if (q.incidentId) filter.incidentId = q.incidentId;
  if (q.view === 'pending') filter.approvalStatus = 'PENDING';
  if (q.view === 'approved') Object.assign(filter, { approvalStatus: 'APPROVED', executionStatus: { $in: ['NOT_STARTED', 'QUEUED', 'RUNNING'] } });
  if (q.view === 'history') filter.executionStatus = { $in: ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'] };
  return paginate(Remediation, filter, {
    page: q.page,
    limit: q.limit,
    sort: q.view === 'history' ? { completedAt: -1 } : { createdAt: -1 },
  });
}

export async function getRemediation(id) {
  return summarize(await findRemediation(id));
}
