import { Device } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { pruneAuditLogs } from './auditService.js';
import { offlineFinding } from './diagnostics/rules.js';
import { LIST_PROJECTION, deviceSummary } from './deviceService.js';
import { upsertFromFinding } from './incidentService.js';
import { emit } from './realtime.js';
import { sweepTimeouts } from './remediation/remediationService.js';
import { getSettingsInternal } from './settingsService.js';

/** Mark devices that missed heartbeats as OFFLINE and raise a device_offline incident. */
export async function sweepOffline(now = new Date()) {
  const settings = await getSettingsInternal();
  const cutoff = new Date(now.getTime() - settings.offlineAfterSeconds * 1000);
  const stale = await Device.find({
    status: { $ne: 'OFFLINE' },
    monitoringPaused: { $ne: true },
    lastHeartbeat: { $lt: cutoff },
  })
    .select(LIST_PROJECTION)
    .lean();

  for (const device of stale) {
    const updated = await Device.findOneAndUpdate(
      { _id: device._id, status: { $ne: 'OFFLINE' } },
      { $set: { status: 'OFFLINE', activeRules: ['device_offline'] } },
      { returnDocument: 'after', projection: LIST_PROJECTION }
    ).lean();
    if (!updated) continue;
    await upsertFromFinding(updated, offlineFinding(updated, settings.offlineAfterSeconds), settings);
    emit('device:updated', deviceSummary(updated));
    logger.info(`Device ${device.hostname} marked OFFLINE`);
  }
  return stale.length;
}

let timer = null;
let lastPrune = 0;

export async function runSweep() {
  const offline = await sweepOffline();
  const timedOut = await sweepTimeouts();
  if (Date.now() - lastPrune > 86400_000) {
    lastPrune = Date.now();
    const settings = await getSettingsInternal();
    await pruneAuditLogs(settings.auditRetentionDays);
  }
  return { offline, timedOut };
}

export function startHealthMonitor(intervalMs) {
  if (timer) return;
  let running = false;
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runSweep();
    } catch (err) {
      logger.error(`Health sweep failed: ${err.message}`);
    } finally {
      running = false;
    }
  }, intervalMs);
  timer.unref?.();
}

export function stopHealthMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
