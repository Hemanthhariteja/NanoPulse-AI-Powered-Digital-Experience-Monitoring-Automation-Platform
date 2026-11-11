import { Device, Incident, Remediation, Telemetry } from '../models/index.js';
import { LIST_PROJECTION } from './deviceService.js';

const RANGE_MS = { '1h': 3600_000, '6h': 6 * 3600_000, '24h': 86400_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 };
const BUCKET = {
  '1h': { unit: 'minute', binSize: 1 },
  '6h': { unit: 'minute', binSize: 15 },
  '24h': { unit: 'hour', binSize: 1 },
  '7d': { unit: 'hour', binSize: 6 },
  '30d': { unit: 'day', binSize: 1 },
};
export const ANALYTICS_RANGES = Object.keys(RANGE_MS);

const since = (range) => new Date(Date.now() - (RANGE_MS[range] || RANGE_MS['24h']));
const bucketExpr = (field, range) => ({ $dateTrunc: { date: field, unit: BUCKET[range].unit, binSize: BUCKET[range].binSize } });
const round = (n, d = 1) => (typeof n === 'number' ? Math.round(n * 10 ** d) / 10 ** d : 0);

export async function overview() {
  const [statusCounts, typeCounts, fleet, openBySeverity, incidentCounts, mttr, pendingApprovals, recentIncidents, recentDevices] =
    await Promise.all([
      Device.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Device.aggregate([{ $group: { _id: '$agentType', n: { $sum: 1 } } }]),
      Device.aggregate([
        { $match: { status: { $in: ['HEALTHY', 'WARNING', 'CRITICAL'] } } },
        { $group: { _id: null, cpu: { $avg: '$latest.cpuUsage' }, ram: { $avg: '$latest.ramUsage' }, disk: { $avg: '$latest.diskUsage' } } },
      ]),
      Incident.aggregate([{ $match: { isOpen: true } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
      Incident.aggregate([{ $group: { _id: '$isOpen', n: { $sum: 1 } } }]),
      Incident.aggregate([
        { $match: { isOpen: false, resolutionTimeSeconds: { $ne: null } } },
        { $group: { _id: null, avg: { $avg: '$resolutionTimeSeconds' } } },
      ]),
      Remediation.countDocuments({ approvalStatus: 'PENDING' }),
      Incident.find().sort({ createdAt: -1 }).limit(6).select('-timeline').lean(),
      Device.find({ lastHeartbeat: { $ne: null } }).sort({ lastHeartbeat: -1 }).limit(6).select(LIST_PROJECTION).lean(),
    ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s._id, s.n]));
  const total = statusCounts.reduce((a, s) => a + s.n, 0);
  const monitored = total - (byStatus.PENDING || 0);
  const counts = Object.fromEntries(incidentCounts.map((c) => [String(c._id), c.n]));

  return {
    devices: {
      total,
      healthy: byStatus.HEALTHY || 0,
      warning: byStatus.WARNING || 0,
      critical: byStatus.CRITICAL || 0,
      offline: byStatus.OFFLINE || 0,
      pending: byStatus.PENDING || 0,
      real: typeCounts.find((t) => t._id === 'python-agent')?.n || 0,
      simulated: typeCounts.find((t) => t._id === 'simulated')?.n || 0,
      healthPercentage: monitored ? round(((byStatus.HEALTHY || 0) / monitored) * 100) : 0,
    },
    fleet: { avgCpu: round(fleet[0]?.cpu), avgRam: round(fleet[0]?.ram), avgDisk: round(fleet[0]?.disk) },
    incidents: {
      active: counts.true || 0,
      resolved: counts.false || 0,
      avgResolutionSeconds: mttr[0] ? Math.round(mttr[0].avg) : null,
      openBySeverity: {
        CRITICAL: openBySeverity.find((s) => s._id === 'CRITICAL')?.n || 0,
        WARNING: openBySeverity.find((s) => s._id === 'WARNING')?.n || 0,
        INFO: openBySeverity.find((s) => s._id === 'INFO')?.n || 0,
      },
    },
    remediation: { pendingApprovals },
    recentIncidents,
    recentDevices,
    generatedAt: new Date(),
  };
}

export async function deviceHealth(range = '24h') {
  const from = since(range);
  const [trend, availabilityRaw, devices] = await Promise.all([
    Telemetry.aggregate([
      { $match: { timestamp: { $gte: from } } },
      {
        $group: {
          _id: bucketExpr('$timestamp', range),
          cpu: { $avg: '$cpuUsage' },
          ram: { $avg: '$ramUsage' },
          disk: { $avg: '$diskUsage' },
          samples: { $sum: 1 },
          healthy: { $sum: { $cond: [{ $eq: ['$status', 'HEALTHY'] }, 1, 0] } },
          warning: { $sum: { $cond: [{ $eq: ['$status', 'WARNING'] }, 1, 0] } },
          critical: { $sum: { $cond: [{ $eq: ['$status', 'CRITICAL'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    // Availability: share of 5-minute slots (since registration or range start) with at least one heartbeat.
    Telemetry.aggregate([
      { $match: { timestamp: { $gte: from } } },
      { $group: { _id: { d: '$deviceId', s: { $dateTrunc: { date: '$timestamp', unit: 'minute', binSize: 5 } } } } },
      { $group: { _id: '$_id.d', slots: { $sum: 1 } } },
    ]),
    Device.find().select('deviceId hostname agentType registeredAt status').lean(),
  ]);

  const slotMs = 5 * 60_000;
  const now = Date.now();
  const slotsById = Object.fromEntries(availabilityRaw.map((a) => [a._id, a.slots]));
  const availability = devices
    .map((d) => {
      const start = Math.max(from.getTime(), new Date(d.registeredAt).getTime());
      const expected = Math.max(1, Math.ceil((now - start) / slotMs));
      return {
        deviceId: d.deviceId,
        hostname: d.hostname,
        agentType: d.agentType,
        status: d.status,
        availability: round(Math.min(100, ((slotsById[d.deviceId] || 0) / expected) * 100)),
      };
    })
    .sort((a, b) => a.availability - b.availability);

  const statusDistribution = devices.reduce((acc, d) => ({ ...acc, [d.status]: (acc[d.status] || 0) + 1 }), {});

  return {
    range,
    trend: trend.map((b) => ({
      t: b._id,
      avgCpu: round(b.cpu),
      avgRam: round(b.ram),
      avgDisk: round(b.disk),
      healthyPct: round((b.healthy / b.samples) * 100),
      warningPct: round((b.warning / b.samples) * 100),
      criticalPct: round((b.critical / b.samples) * 100),
      samples: b.samples,
    })),
    statusDistribution,
    availability,
    fleetAvailability: availability.length ? round(availability.reduce((a, d) => a + d.availability, 0) / availability.length) : 0,
  };
}

export async function incidentAnalytics(range = '24h') {
  const from = since(range);
  const [created, resolved, common, mttrBySeverity, statusDist] = await Promise.all([
    Incident.aggregate([
      { $match: { createdAt: { $gte: from } } },
      {
        $group: {
          _id: bucketExpr('$createdAt', range),
          total: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'CRITICAL'] }, 1, 0] } },
          warning: { $sum: { $cond: [{ $eq: ['$severity', 'WARNING'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    Incident.aggregate([
      { $match: { resolvedAt: { $gte: from } } },
      { $group: { _id: bucketExpr('$resolvedAt', range), resolved: { $sum: 1 } } },
    ]),
    Incident.aggregate([
      { $match: { createdAt: { $gte: from } } },
      { $group: { _id: '$ruleId', title: { $first: '$title' }, count: { $sum: 1 }, devices: { $addToSet: '$deviceId' } } },
      { $project: { _id: 0, ruleId: '$_id', title: 1, count: 1, devices: { $size: '$devices' } } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]),
    Incident.aggregate([
      { $match: { resolvedAt: { $gte: from }, resolutionTimeSeconds: { $ne: null } } },
      { $group: { _id: '$severity', avg: { $avg: '$resolutionTimeSeconds' }, n: { $sum: 1 } } },
    ]),
    Incident.aggregate([{ $match: { createdAt: { $gte: from } } }, { $group: { _id: '$status', n: { $sum: 1 } } }]),
  ]);

  const resolvedMap = Object.fromEntries(resolved.map((r) => [new Date(r._id).getTime(), r.resolved]));
  const keys = new Set([...created.map((c) => new Date(c._id).getTime()), ...Object.keys(resolvedMap).map(Number)]);
  const createdMap = Object.fromEntries(created.map((c) => [new Date(c._id).getTime(), c]));
  const trend = [...keys]
    .sort((a, b) => a - b)
    .map((k) => ({
      t: new Date(k),
      created: createdMap[k]?.total || 0,
      critical: createdMap[k]?.critical || 0,
      warning: createdMap[k]?.warning || 0,
      resolved: resolvedMap[k] || 0,
    }));

  const totalResolved = mttrBySeverity.reduce((a, m) => a + m.n, 0);
  const mttrSeconds = totalResolved ? Math.round(mttrBySeverity.reduce((a, m) => a + m.avg * m.n, 0) / totalResolved) : null;

  return {
    range,
    trend,
    commonProblems: common,
    mttrSeconds,
    mttrBySeverity: mttrBySeverity.map((m) => ({ severity: m._id, avgSeconds: Math.round(m.avg), resolved: m.n })),
    statusDistribution: Object.fromEntries(statusDist.map((s) => [s._id, s.n])),
  };
}

export async function remediationAnalytics(range = '24h') {
  const from = since(range);
  const [byStatus, byAction, approval, duration] = await Promise.all([
    Remediation.aggregate([{ $match: { createdAt: { $gte: from } } }, { $group: { _id: '$executionStatus', n: { $sum: 1 } } }]),
    Remediation.aggregate([
      { $match: { createdAt: { $gte: from } } },
      {
        $group: {
          _id: '$actionType',
          label: { $first: '$label' },
          total: { $sum: 1 },
          succeeded: { $sum: { $cond: [{ $eq: ['$executionStatus', 'SUCCEEDED'] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $in: ['$executionStatus', ['FAILED', 'TIMED_OUT']] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]),
    Remediation.aggregate([{ $match: { createdAt: { $gte: from } } }, { $group: { _id: '$approvalStatus', n: { $sum: 1 } } }]),
    Remediation.aggregate([
      { $match: { createdAt: { $gte: from }, executionStatus: 'SUCCEEDED' } },
      { $group: { _id: null, avg: { $avg: '$executionResult.durationMs' } } },
    ]),
  ]);

  const s = Object.fromEntries(byStatus.map((b) => [b._id, b.n]));
  const finished = (s.SUCCEEDED || 0) + (s.FAILED || 0) + (s.TIMED_OUT || 0);
  return {
    range,
    byStatus: s,
    successRate: finished ? round(((s.SUCCEEDED || 0) / finished) * 100) : null,
    finished,
    byAction: byAction.map((a) => ({ actionType: a._id, label: a.label, total: a.total, succeeded: a.succeeded, failed: a.failed })),
    approval: Object.fromEntries(approval.map((a) => [a._id, a.n])),
    avgDurationMs: duration[0] ? Math.round(duration[0].avg) : null,
  };
}
