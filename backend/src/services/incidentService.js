import { Incident, Remediation, SEVERITY_RANK, User, nextId } from '../models/index.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { escapeRegex, paginate } from '../utils/pagination.js';
import { audit } from './auditService.js';
import { emit } from './realtime.js';

/** Allowed lifecycle transitions. RESOLVED is terminal. */
export const TRANSITIONS = {
  NEW: ['INVESTIGATING', 'PENDING_APPROVAL', 'REMEDIATION_IN_PROGRESS', 'RESOLVED', 'FAILED'],
  INVESTIGATING: ['PENDING_APPROVAL', 'REMEDIATION_IN_PROGRESS', 'RESOLVED', 'FAILED'],
  PENDING_APPROVAL: ['INVESTIGATING', 'REMEDIATION_IN_PROGRESS', 'RESOLVED', 'FAILED'],
  REMEDIATION_IN_PROGRESS: ['INVESTIGATING', 'PENDING_APPROVAL', 'RESOLVED', 'FAILED'],
  FAILED: ['INVESTIGATING', 'PENDING_APPROVAL', 'REMEDIATION_IN_PROGRESS', 'RESOLVED'],
  RESOLVED: [],
};

/** Statuses a person may set through PATCH; RESOLVED goes through /resolve (notes required). */
export const MANUAL_STATUSES = ['INVESTIGATING', 'FAILED'];

export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to) ?? false;

export function summarize(inc) {
  const o = typeof inc.toObject === 'function' ? inc.toObject() : inc;
  const { timeline: _t, __v, ...rest } = o;
  return rest;
}

/**
 * Change status, maintaining resolution bookkeeping and the timeline.
 * Returns false (without throwing) when the transition is not allowed and `strict` is false.
 */
export function applyStatus(inc, to, { by = 'system', message, strict = true } = {}) {
  if (inc.status === to) return false;
  if (!canTransition(inc.status, to)) {
    if (strict) throw conflict(`Cannot move incident from ${inc.status} to ${to}`);
    return false;
  }
  const from = inc.status;
  inc.status = to;
  if (to === 'RESOLVED') {
    inc.isOpen = false;
    inc.resolvedAt = new Date();
    inc.resolvedBy = by;
    inc.resolutionTimeSeconds = Math.round((inc.resolvedAt - inc.createdAt) / 1000);
  }
  inc.timeline.push({ type: 'status', message: message || `Status changed from ${from} to ${to}`, by });
  return true;
}

function incidentFields(device, finding) {
  return {
    title: finding.title,
    description: finding.description,
    detectionReason: finding.detectionReason,
    severity: finding.severity,
    severityRank: SEVERITY_RANK[finding.severity],
    rootCause: finding.rootCause,
    recommendation: finding.recommendation,
    recommendedActions: finding.recommendedActions,
    confidence: finding.confidence,
    confidenceBreakdown: finding.confidenceBreakdown,
    metrics: finding.metrics,
    deviceHostname: device.hostname,
  };
}

/**
 * Create an incident for a finding, or update the open incident with the same fingerprint.
 * The partial unique index on { fingerprint } (isOpen: true) guarantees one open incident
 * per device+rule, even when two telemetry messages are processed concurrently.
 */
export async function upsertFromFinding(device, finding, settings) {
  const fingerprint = `${device.deviceId}:${finding.ruleId}`;
  let inc = await Incident.findOne({ fingerprint, isOpen: true });
  let created = false;

  if (!inc) {
    try {
      inc = await Incident.create({
        incidentId: await nextId('incident', 'INC'),
        deviceId: device.deviceId,
        simulated: device.agentType === 'simulated',
        ruleId: finding.ruleId,
        fingerprint,
        ...incidentFields(device, finding),
        firstDetectedAt: finding.detectedAt,
        lastDetectedAt: finding.detectedAt,
        timeline: [{ type: 'detected', message: finding.detectionReason }],
      });
      created = true;
    } catch (err) {
      if (err.code !== 11000) throw err;
      inc = await Incident.findOne({ fingerprint, isOpen: true });
      if (!inc) throw err;
    }
  }

  if (created) {
    await audit({
      action: 'incident.created',
      entityType: 'incident',
      entityId: inc.incidentId,
      details: { deviceId: device.deviceId, ruleId: finding.ruleId, severity: finding.severity },
    });
    emit('incident:created', summarize(inc));
    if (settings?.autoRequestRemediation && finding.recommendedActions?.length) {
      const { requestRemediation } = await import('./remediation/remediationService.js');
      await requestRemediation({ incidentId: inc.incidentId, actionType: finding.recommendedActions[0] }, null).catch(
        () => {}
      );
    }
    return { incident: inc, created: true };
  }

  const previousSeverity = inc.severity;
  const fields = incidentFields(device, finding);
  if (inc.severityOverridden) {
    delete fields.severity;
    delete fields.severityRank;
  }
  Object.assign(inc, fields, {
    lastDetectedAt: finding.detectedAt,
    occurrences: inc.occurrences + 1,
    clearSamples: 0,
  });
  const severityChanged = previousSeverity !== inc.severity;
  if (severityChanged) {
    inc.timeline.push({ type: 'severity', message: `Severity changed from ${previousSeverity} to ${inc.severity}` });
  }
  await inc.save();
  if (severityChanged) emit('incident:updated', summarize(inc));
  return { incident: inc, created: false };
}

async function closeIncident(inc, message, by = 'system') {
  applyStatus(inc, 'RESOLVED', { by, message });
  if (!inc.resolutionNotes) inc.resolutionNotes = message;
  await inc.save();
  await audit({
    action: 'incident.resolved',
    entityType: 'incident',
    entityId: inc.incidentId,
    details: { automatic: by === 'system', message },
  });
  emit('incident:updated', summarize(inc));
}

/**
 * Called after each telemetry sample: upsert incidents for firing rules and auto-resolve
 * incidents whose rule has stayed clear for `autoResolveAfterSamples` consecutive samples.
 */
export async function reconcileFindings(device, findings, settings) {
  const results = [];
  for (const f of findings) results.push(await upsertFromFinding(device, f, settings));

  const firing = findings.map((f) => f.ruleId);
  const stale = await Incident.find({ deviceId: device.deviceId, isOpen: true, ruleId: { $nin: firing } });
  const needed = settings?.autoResolveAfterSamples ?? 2;

  for (const inc of stale) {
    if (inc.ruleId === 'device_offline') {
      await closeIncident(inc, 'Auto-resolved: the device resumed reporting telemetry.');
      continue;
    }
    inc.clearSamples += 1;
    if (inc.clearSamples >= needed) {
      await closeIncident(
        inc,
        `Auto-resolved: condition no longer detected for ${inc.clearSamples} consecutive telemetry samples.`
      );
    } else {
      await Incident.updateOne({ _id: inc._id }, { $set: { clearSamples: inc.clearSamples } });
    }
  }
  return results;
}

/** Resolve every open incident for a device (used when a device is deleted or simulation stops). */
export async function resolveAllForDevice(deviceId, message) {
  const open = await Incident.find({ deviceId, isOpen: true });
  for (const inc of open) await closeIncident(inc, message);
  return open.length;
}

async function findIncident(id) {
  const filter = /^[a-f0-9]{24}$/i.test(id) ? { _id: id } : { incidentId: id };
  const inc = await Incident.findOne(filter);
  if (!inc) throw notFound('Incident');
  return inc;
}

export async function listIncidents(q) {
  const filter = {};
  if (q.status === 'OPEN') filter.isOpen = true;
  else if (q.status) filter.status = q.status;
  if (q.severity) filter.severity = q.severity;
  if (q.deviceId) filter.deviceId = q.deviceId;
  if (q.simulated !== undefined) filter.simulated = q.simulated;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ title: rx }, { incidentId: rx }, { deviceHostname: rx }, { rootCause: rx }];
  }
  const sortMap = {
    severity: { severityRank: -1, createdAt: -1 },
    '-severity': { severityRank: 1, createdAt: -1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
  };
  return paginate(Incident, filter, {
    page: q.page,
    limit: q.limit,
    sort: sortMap[q.sort] || sortMap.newest,
    select: '-timeline',
    populate: { path: 'assignedTo', select: 'name email role' },
  });
}

export async function getIncident(id) {
  const inc = await findIncident(id);
  await inc.populate({ path: 'assignedTo', select: 'name email role' });
  const remediations = await Remediation.find({ incident: inc._id }).sort({ createdAt: -1 }).lean();
  return { ...inc.toObject(), remediations };
}

export async function updateIncident(id, patch, user) {
  const inc = await findIncident(id);
  if (!inc.isOpen) throw conflict('Resolved incidents cannot be modified');
  const by = user.name;
  const changes = {};

  if (patch.status) {
    if (!MANUAL_STATUSES.includes(patch.status)) {
      throw badRequest(`Status can only be set to ${MANUAL_STATUSES.join(' or ')}; use /resolve to resolve`);
    }
    applyStatus(inc, patch.status, { by, message: patch.note ? `${patch.status}: ${patch.note}` : undefined });
    changes.status = patch.status;
  }
  if (patch.severity && patch.severity !== inc.severity) {
    inc.timeline.push({ type: 'severity', message: `Severity manually changed from ${inc.severity} to ${patch.severity}`, by });
    inc.severity = patch.severity;
    inc.severityRank = SEVERITY_RANK[patch.severity];
    inc.severityOverridden = true;
    changes.severity = patch.severity;
  }
  if (patch.assignedTo !== undefined) {
    if (patch.assignedTo === null) {
      inc.assignedTo = null;
      inc.timeline.push({ type: 'assignment', message: 'Unassigned', by });
    } else {
      const assignee = await User.findOne({ _id: patch.assignedTo, active: true }).lean();
      if (!assignee) throw badRequest('Assignee not found');
      inc.assignedTo = assignee._id;
      inc.timeline.push({ type: 'assignment', message: `Assigned to ${assignee.name}`, by });
    }
    changes.assignedTo = patch.assignedTo;
  }
  if (patch.note && !patch.status) {
    inc.timeline.push({ type: 'note', message: patch.note, by });
    changes.note = patch.note;
  }
  if (!Object.keys(changes).length) throw badRequest('No changes supplied');

  await inc.save();
  await audit({ actor: user, action: 'incident.updated', entityType: 'incident', entityId: inc.incidentId, details: changes });
  emit('incident:updated', summarize(inc));
  return getIncident(inc.incidentId);
}

export async function resolveIncident(id, notes, user) {
  const inc = await findIncident(id);
  if (!inc.isOpen) throw conflict('Incident is already resolved');
  inc.resolutionNotes = notes;
  applyStatus(inc, 'RESOLVED', { by: user.name, message: `Resolved manually: ${notes}` });
  await inc.save();
  await Remediation.updateMany(
    { incident: inc._id, approvalStatus: 'PENDING' },
    { $set: { approvalStatus: 'REJECTED', rejectedReason: 'Incident resolved before approval' } }
  );
  await audit({ actor: user, action: 'incident.resolved', entityType: 'incident', entityId: inc.incidentId, details: { notes } });
  emit('incident:updated', summarize(inc));
  return getIncident(inc.incidentId);
}
