import crypto from 'node:crypto';
import { Device, Incident, Remediation, Telemetry } from '../models/index.js';
import { randomSecret, sha256 } from '../utils/crypto.js';
import { notFound, unauthorized } from '../utils/errors.js';
import { escapeRegex, paginate } from '../utils/pagination.js';
import { audit } from './auditService.js';
import { resolveAllForDevice } from './incidentService.js';
import { emit } from './realtime.js';
import { getSettingsInternal } from './settingsService.js';

export const LIST_PROJECTION = '-latest.processes -latest.interfaces -__v';

function keyMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(sha256(given), 'hex');
  const b = Buffer.from(sha256(expected), 'hex');
  return crypto.timingSafeEqual(a, b);
}

export function deviceSummary(device) {
  const d = typeof device.toObject === 'function' ? device.toObject() : { ...device };
  delete d.secretHash;
  delete d.__v;
  if (d.latest) {
    const { processes: _p, interfaces: _i, ...latest } = d.latest;
    d.latest = latest;
  }
  return d;
}

/**
 * Register a device (or re-enroll an existing deviceId, rotating its secret).
 * Agents must present the enrollment key; the in-process simulator passes trusted=true.
 * Returns the plaintext secret exactly once — only its SHA-256 hash is stored.
 */
export async function registerDevice(input, { trusted = false, ip } = {}) {
  const settings = await getSettingsInternal();
  if (!trusted && !keyMatches(input.enrollmentKey, settings.enrollmentKey)) {
    throw unauthorized('Invalid enrollment key');
  }

  const deviceId = input.deviceId || crypto.randomUUID();
  const secret = randomSecret(32);
  const fields = {
    hostname: input.hostname,
    operatingSystem: input.operatingSystem,
    osVersion: input.osVersion,
    architecture: input.architecture,
    ipAddress: input.ipAddress || ip,
    deviceType: input.deviceType || 'workstation',
    agentType: trusted && input.agentType === 'simulated' ? 'simulated' : 'python-agent',
    agentVersion: input.agentVersion,
    capabilities: input.capabilities || {},
    secretHash: sha256(secret),
  };

  const existing = await Device.findOne({ deviceId }).lean();
  let device;
  if (existing) {
    device = await Device.findOneAndUpdate({ deviceId }, { $set: fields }, { returnDocument: 'after' });
  } else {
    device = await Device.create({ deviceId, ...fields, status: 'PENDING', registeredAt: new Date() });
  }

  if (fields.agentType !== 'simulated') {
    await audit({
      actorType: 'device',
      actor: { name: fields.hostname },
      action: existing ? 'device.reenrolled' : 'device.registered',
      entityType: 'device',
      entityId: deviceId,
      details: { hostname: fields.hostname, os: fields.operatingSystem, ip: fields.ipAddress },
      ip,
    });
  }
  emit('device:updated', deviceSummary(device));
  return {
    deviceId,
    deviceSecret: secret,
    telemetryIntervalSeconds: settings.telemetryIntervalSeconds,
    reenrolled: Boolean(existing),
  };
}

export async function listDevices(q) {
  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.agentType) filter.agentType = q.agentType;
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    filter.$or = [{ hostname: rx }, { deviceId: rx }, { operatingSystem: rx }, { ipAddress: rx }];
  }
  const sortMap = {
    hostname: { hostname: 1 },
    status: { status: 1, hostname: 1 },
    cpu: { 'latest.cpuUsage': -1 },
    ram: { 'latest.ramUsage': -1 },
    disk: { 'latest.diskUsage': -1 },
    heartbeat: { lastHeartbeat: -1 },
  };
  return paginate(Device, filter, {
    page: q.page,
    limit: q.limit,
    sort: sortMap[q.sort] || { agentType: 1, hostname: 1 },
    select: LIST_PROJECTION,
  });
}

async function findDevice(id) {
  const filter = /^[a-f0-9]{24}$/i.test(id) ? { $or: [{ _id: id }, { deviceId: id }] } : { deviceId: id };
  const device = await Device.findOne(filter).lean();
  if (!device) throw notFound('Device');
  return device;
}

export async function getDevice(id) {
  const device = await findDevice(id);
  const [incidents, remediations] = await Promise.all([
    Incident.find({ deviceId: device.deviceId }).sort({ createdAt: -1 }).limit(25).select('-timeline').lean(),
    Remediation.find({ deviceId: device.deviceId }).sort({ createdAt: -1 }).limit(25).lean(),
  ]);
  const { __v, ...rest } = device;
  return { ...rest, incidents, remediations };
}

export async function deleteDevice(id, user) {
  const device = await findDevice(id);
  await resolveAllForDevice(device.deviceId, 'Closed: device was removed from NanoPulse.');
  await Remediation.updateMany(
    { deviceId: device.deviceId, executionStatus: { $in: ['NOT_STARTED', 'QUEUED'] } },
    { $set: { executionStatus: 'CANCELLED', completedAt: new Date() }, $push: { log: { message: 'Cancelled: device removed' } } }
  );
  const { deletedCount } = await Telemetry.deleteMany({ deviceId: device.deviceId });
  await Device.deleteOne({ _id: device._id });
  await audit({
    actor: user,
    action: 'device.deleted',
    entityType: 'device',
    entityId: device.deviceId,
    details: { hostname: device.hostname, telemetryDeleted: deletedCount },
  });
  emit('device:updated', { deviceId: device.deviceId, deleted: true });
  return { deviceId: device.deviceId, telemetryDeleted: deletedCount };
}

/** Called by the agent on graceful shutdown: offline without raising an incident. */
export async function markShutdown(device) {
  const updated = await Device.findOneAndUpdate(
    { deviceId: device.deviceId },
    { $set: { status: 'OFFLINE', monitoringPaused: true } },
    { returnDocument: 'after', projection: LIST_PROJECTION }
  ).lean();
  await audit({ actorType: 'device', actor: device, action: 'device.agent_stopped', entityType: 'device', entityId: device.deviceId });
  emit('device:updated', deviceSummary(updated));
}
