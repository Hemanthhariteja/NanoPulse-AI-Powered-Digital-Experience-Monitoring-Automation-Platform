import { Device, Telemetry } from '../models/index.js';
import { HISTORY_SIZE, assess } from './diagnostics/engine.js';
import { LIST_PROJECTION, deviceSummary } from './deviceService.js';
import { reconcileFindings } from './incidentService.js';
import { emit } from './realtime.js';
import { getSettingsInternal } from './settingsService.js';

const BUCKETS = {
  '1h': { ms: 3600_000, unit: 'minute', binSize: 1 },
  '6h': { ms: 6 * 3600_000, unit: 'minute', binSize: 5 },
  '24h': { ms: 24 * 3600_000, unit: 'minute', binSize: 15 },
  '7d': { ms: 7 * 86400_000, unit: 'hour', binSize: 2 },
};
export const RANGES = Object.keys(BUCKETS);

/**
 * The single telemetry processing pipeline, shared by real agents (HTTP) and the simulator:
 * persist → diagnose → update device health → reconcile incidents → push realtime events.
 */
export async function ingest(device, sample, { now = new Date() } = {}) {
  const settings = await getSettingsInternal();
  const history = (
    await Telemetry.find({ deviceId: device.deviceId })
      .sort({ timestamp: -1 })
      .limit(HISTORY_SIZE)
      .select('cpuUsage ramUsage diskUsage networkUpload networkDownload networkConnected')
      .lean()
  ).reverse();

  const { status, findings } = assess(sample, history, settings.thresholds);
  const simulated = device.agentType === 'simulated';

  await Telemetry.create({
    deviceId: device.deviceId,
    cpuUsage: sample.cpuUsage,
    ramUsage: sample.ramUsage,
    diskUsage: sample.diskUsage,
    networkUpload: sample.networkUpload,
    networkDownload: sample.networkDownload,
    networkConnected: sample.networkConnected,
    uptime: sample.uptimeSeconds,
    status,
    simulated,
    timestamp: now,
  });

  const set = {
    status,
    lastHeartbeat: now,
    monitoringPaused: false,
    activeRules: findings.map((f) => f.ruleId),
    latest: { ...sample, at: now },
  };
  if (sample.ipAddress) set.ipAddress = sample.ipAddress;
  delete set.latest.ipAddress;

  const updated = await Device.findOneAndUpdate({ deviceId: device.deviceId }, { $set: set }, { returnDocument: 'after', projection: LIST_PROJECTION }).lean();

  await reconcileFindings(updated, findings, settings);

  emit('telemetry:update', {
    deviceId: device.deviceId,
    hostname: updated.hostname,
    simulated,
    status,
    at: now,
    metrics: {
      cpuUsage: sample.cpuUsage,
      ramUsage: sample.ramUsage,
      diskUsage: sample.diskUsage,
      networkUpload: sample.networkUpload,
      networkDownload: sample.networkDownload,
      networkConnected: sample.networkConnected,
      uptimeSeconds: sample.uptimeSeconds,
    },
  });
  if (device.status !== status) emit('device:updated', deviceSummary(updated));

  return {
    status,
    findings: findings.map(({ ruleId, severity, title, confidence }) => ({ ruleId, severity, title, confidence })),
    telemetryIntervalSeconds: settings.telemetryIntervalSeconds,
  };
}

export async function latestTelemetry(deviceId, limit = 60) {
  const samples = await Telemetry.find({ deviceId }).sort({ timestamp: -1 }).limit(limit).select('-_id -deviceId').lean();
  return samples.reverse();
}

/** Downsampled history using $dateTrunc buckets so charts never load unbounded raw data. */
export async function telemetryHistory(deviceId, range = '24h') {
  const b = BUCKETS[range] || BUCKETS['24h'];
  const since = new Date(Date.now() - b.ms);
  const points = await Telemetry.aggregate([
    { $match: { deviceId, timestamp: { $gte: since } } },
    {
      $group: {
        _id: { $dateTrunc: { date: '$timestamp', unit: b.unit, binSize: b.binSize } },
        cpuUsage: { $avg: '$cpuUsage' },
        cpuMax: { $max: '$cpuUsage' },
        ramUsage: { $avg: '$ramUsage' },
        diskUsage: { $avg: '$diskUsage' },
        networkUpload: { $avg: '$networkUpload' },
        networkDownload: { $avg: '$networkDownload' },
        samples: { $sum: 1 },
        critical: { $sum: { $cond: [{ $eq: ['$status', 'CRITICAL'] }, 1, 0] } },
        warning: { $sum: { $cond: [{ $eq: ['$status', 'WARNING'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        t: '$_id',
        cpuUsage: { $round: ['$cpuUsage', 1] },
        cpuMax: { $round: ['$cpuMax', 1] },
        ramUsage: { $round: ['$ramUsage', 1] },
        diskUsage: { $round: ['$diskUsage', 1] },
        networkUpload: { $round: ['$networkUpload', 0] },
        networkDownload: { $round: ['$networkDownload', 0] },
        samples: 1,
        critical: 1,
        warning: 1,
      },
    },
  ]);
  return { range, bucket: `${b.binSize} ${b.unit}`, points };
}
