import { Settings } from '../models/index.js';
import { randomSecret } from '../utils/crypto.js';
import { badRequest } from '../utils/errors.js';

let cache = null;

async function ensure() {
  let doc = await Settings.findOne({ key: 'global' }).select('+enrollmentKey');
  if (!doc) {
    try {
      doc = await Settings.create({ key: 'global', enrollmentKey: randomSecret(18) });
    } catch (err) {
      if (err.code !== 11000) throw err;
      doc = await Settings.findOne({ key: 'global' }).select('+enrollmentKey');
    }
  }
  if (!doc.enrollmentKey) {
    doc.enrollmentKey = randomSecret(18);
    await doc.save();
  }
  return doc;
}

/** Settings including the enrollment key. Server-side use only. */
export async function getSettingsInternal() {
  if (!cache) cache = (await ensure()).toObject();
  return cache;
}

export function toPublic(settings) {
  const { enrollmentKey: _omit, _id, __v, ...rest } = settings;
  return rest;
}

export async function getSettings() {
  return toPublic(await getSettingsInternal());
}

export async function updateSettings(patch, user) {
  const doc = await ensure();
  if (patch.thresholds) {
    const t = { ...doc.thresholds.toObject(), ...patch.thresholds };
    for (const k of ['cpu', 'ram', 'disk']) {
      if (t[`${k}Warning`] >= t[`${k}Critical`]) {
        throw badRequest(`${k.toUpperCase()} warning threshold must be lower than the critical threshold`);
      }
    }
    doc.thresholds = t;
  }
  for (const key of [
    'telemetryIntervalSeconds',
    'offlineAfterSeconds',
    'autoResolveAfterSamples',
    'autoRequestRemediation',
    'auditRetentionDays',
  ]) {
    if (patch[key] !== undefined) doc[key] = patch[key];
  }
  if (doc.offlineAfterSeconds < doc.telemetryIntervalSeconds * 2) {
    throw badRequest('offlineAfterSeconds must be at least twice the telemetry interval');
  }
  doc.updatedBy = user?.name;
  await doc.save();
  cache = null;
  return getSettings();
}

export async function rotateEnrollmentKey() {
  const doc = await ensure();
  doc.enrollmentKey = randomSecret(18);
  await doc.save();
  cache = null;
  return doc.enrollmentKey;
}

export function clearSettingsCache() {
  cache = null;
}
