import { CORROBORATION, margin, persistence, score } from './confidence.js';

/**
 * Deterministic, explainable diagnostic rules.
 *
 * Every rule receives the current sample, the previous samples for the same device
 * (oldest → newest) and the configured thresholds, and returns either null or a finding.
 * Root causes are phrased as *possible* causes: a resource threshold on its own
 * never proves why a resource is exhausted.
 */

const r1 = (n) => Math.round(n * 10) / 10;
const fmtBytes = (b) => {
  if (typeof b !== 'number') return 'unknown';
  const gb = b / 1024 ** 3;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(0)} MB`;
};

export function severityFor(value, warn, crit) {
  if (typeof value !== 'number') return null;
  if (value > crit) return 'CRITICAL';
  if (value >= warn) return 'WARNING';
  return null;
}

const topBy = (processes, key) =>
  (processes || []).filter((p) => typeof p[key] === 'number').sort((a, b) => b[key] - a[key])[0];

function finding(base) {
  const confidence = score(base.confidenceBreakdown);
  return {
    ...base,
    confidence,
    description: `${base.detectionReason} ${base.rootCause}`,
    detectedAt: base.detectedAt || new Date(),
  };
}

export function cpuRule(sample, history, t) {
  const value = sample.cpuUsage;
  const severity = severityFor(value, t.cpuWarning, t.cpuCritical);
  if (!severity) return null;

  const values = [...history.map((h) => h.cpuUsage), value];
  const top = topBy(sample.processes, 'cpuPercent');
  let rootCause;
  let corroboration;
  const actions = ['list_top_cpu_processes'];

  if (!sample.processes?.length) {
    corroboration = CORROBORATION.unknown;
    rootCause = 'Possible root cause: undetermined — the endpoint did not report process data, so the load cannot be attributed to a specific process.';
  } else if (top && top.cpuPercent >= 40) {
    corroboration = CORROBORATION.strong;
    rootCause = `Possible root cause: process "${top.name}" (PID ${top.pid}) is using ${r1(top.cpuPercent)}% of total CPU and is the most likely contributor.`;
    if (top.isDemoApp) actions.push('restart_demo_app');
  } else {
    corroboration = CORROBORATION.weak;
    rootCause = `Possible root cause: load is spread across several processes (largest: "${top?.name}" at ${r1(top?.cpuPercent ?? 0)}%). This pattern often comes from concurrent background work such as updates, indexing or scans, or from a workload exceeding the CPU capacity.`;
  }

  return finding({
    ruleId: 'cpu_high',
    title: severity === 'CRITICAL' ? 'Critical CPU utilization' : 'High CPU utilization',
    severity,
    detectionReason: `CPU utilization is ${r1(value)}%, ${severity === 'CRITICAL' ? `above the critical threshold of ${t.cpuCritical}%` : `at or above the warning threshold of ${t.cpuWarning}%`}.`,
    rootCause,
    recommendation: top?.isDemoApp
      ? `Review the top CPU consumers. "${top.name}" is the configured demo application and can be restarted safely through an approved remediation.`
      : 'Review the top CPU consumers and confirm whether the load is expected. Restart only known, non-system applications; never terminate system processes.',
    recommendedActions: actions,
    metrics: { cpuUsage: r1(value), warning: t.cpuWarning, critical: t.cpuCritical, topProcess: top || null },
    confidenceBreakdown: {
      persistence: persistence(values, t.cpuWarning),
      margin: margin(value, t.cpuWarning),
      corroboration,
    },
  });
}

export function memoryRule(sample, history, t) {
  const value = sample.ramUsage;
  const severity = severityFor(value, t.ramWarning, t.ramCritical);
  if (!severity) return null;

  const values = [...history.map((h) => h.ramUsage), value];
  const top = topBy(sample.processes, 'memoryPercent');
  let rootCause;
  let corroboration;
  const actions = ['list_top_memory_processes'];

  if (!sample.processes?.length) {
    corroboration = CORROBORATION.unknown;
    rootCause = 'Possible root cause: undetermined — no process data was reported.';
  } else if (top && top.memoryPercent >= 25) {
    corroboration = CORROBORATION.strong;
    rootCause = `Possible root cause: process "${top.name}" (PID ${top.pid}) holds ${r1(top.memoryPercent)}% of physical memory${top.memoryBytes ? ` (${fmtBytes(top.memoryBytes)})` : ''}; a leak or oversized working set in this process is the most likely contributor.`;
    if (top.isDemoApp) actions.push('restart_demo_app');
  } else {
    corroboration = CORROBORATION.weak;
    rootCause = `Possible root cause: memory is consumed by many processes (largest: "${top?.name}" at ${r1(top?.memoryPercent ?? 0)}%). The device may simply be running more applications than its RAM supports.`;
  }

  return finding({
    ruleId: 'memory_high',
    title: severity === 'CRITICAL' ? 'Critical memory pressure' : 'High memory utilization',
    severity,
    detectionReason: `Memory utilization is ${r1(value)}%${sample.ramAvailableBytes ? ` (${fmtBytes(sample.ramAvailableBytes)} available)` : ''}, ${severity === 'CRITICAL' ? `above the critical threshold of ${t.ramCritical}%` : `at or above the warning threshold of ${t.ramWarning}%`}.`,
    rootCause,
    recommendation: top?.isDemoApp
      ? `Inspect memory-intensive processes. "${top.name}" is the configured demo application and can be restarted to release its memory.`
      : 'Inspect memory-intensive processes and close or restart applications that are not needed. Consider a RAM upgrade if pressure is persistent.',
    recommendedActions: actions,
    metrics: { ramUsage: r1(value), ramAvailableBytes: sample.ramAvailableBytes, warning: t.ramWarning, critical: t.ramCritical, topProcess: top || null },
    confidenceBreakdown: {
      persistence: persistence(values, t.ramWarning),
      margin: margin(value, t.ramWarning),
      corroboration,
    },
  });
}

export function diskRule(sample, history, t) {
  const value = sample.diskUsage;
  const severity = severityFor(value, t.diskWarning, t.diskCritical);
  if (!severity) return null;
  const values = [...history.map((h) => h.diskUsage), value];

  return finding({
    ruleId: 'disk_high',
    title: severity === 'CRITICAL' ? 'Critically low disk space' : 'Low disk space',
    severity,
    detectionReason: `System disk is ${r1(value)}% full${sample.diskFreeBytes !== undefined ? ` (${fmtBytes(sample.diskFreeBytes)} free)` : ''}, ${severity === 'CRITICAL' ? `above the critical threshold of ${t.diskCritical}%` : `at or above the warning threshold of ${t.diskWarning}%`}.`,
    rootCause:
      'Possible root cause: accumulated temporary files, logs, caches or large downloads. Disk utilization alone does not identify which files are responsible.',
    recommendation:
      'Clear eligible temporary files from the agent’s designated safe directory, then review large folders manually. User documents are never deleted automatically.',
    recommendedActions: ['clear_temp_files'],
    metrics: { diskUsage: r1(value), diskFreeBytes: sample.diskFreeBytes, warning: t.diskWarning, critical: t.diskCritical },
    confidenceBreakdown: {
      persistence: persistence(values, t.diskWarning),
      margin: margin(value, t.diskWarning),
      corroboration: CORROBORATION.unknown,
    },
  });
}

export function networkDownRule(sample, history) {
  if (sample.networkConnected !== false) return null;
  const values = [...history.map((h) => (h.networkConnected === false ? 1 : 0)), 1];
  return finding({
    ruleId: 'network_down',
    title: 'External network connectivity lost',
    severity: 'CRITICAL',
    detectionReason:
      'The agent reported that connectivity probes to its configured external hosts failed, while it could still reach the NanoPulse server.',
    rootCause:
      'Possible root cause: DNS or default-gateway failure, proxy/firewall change, or an upstream ISP outage. Running network diagnostics will narrow this down.',
    recommendation: 'Run the connectivity check and network diagnostics actions, then verify adapter, DNS and gateway configuration.',
    recommendedActions: ['check_network_connectivity', 'network_diagnostics'],
    metrics: { networkConnected: false },
    confidenceBreakdown: { persistence: persistence(values, 1), margin: 1, corroboration: CORROBORATION.unknown },
  });
}

export const TRAFFIC_STREAK = 3;

export function networkTrafficRule(sample, history, t) {
  const limit = t.networkThroughputMBps * 1e6;
  const throughput = (s) => (s.networkUpload || 0) + (s.networkDownload || 0);
  const recent = [...history.slice(-(TRAFFIC_STREAK - 1)), sample];
  if (recent.length < TRAFFIC_STREAK || !recent.every((s) => throughput(s) > limit)) return null;

  const current = throughput(sample);
  const values = [...history.map((h) => throughput(h)), current];
  const direction = (sample.networkUpload || 0) > (sample.networkDownload || 0) ? 'upload' : 'download';
  return finding({
    ruleId: 'network_traffic_abnormal',
    title: 'Sustained abnormal network traffic',
    severity: 'WARNING',
    detectionReason: `Network throughput has exceeded ${t.networkThroughputMBps} MB/s for ${TRAFFIC_STREAK} consecutive samples (current ${(current / 1e6).toFixed(1)} MB/s, mostly ${direction}).`,
    rootCause:
      'Possible root cause: large file transfers, backup or sync clients, software updates, or an unexpected process generating traffic.',
    recommendation: 'Run network diagnostics to review active connections and confirm the traffic is expected.',
    recommendedActions: ['network_diagnostics'],
    metrics: {
      uploadBytesPerSec: Math.round(sample.networkUpload || 0),
      downloadBytesPerSec: Math.round(sample.networkDownload || 0),
      limitMBps: t.networkThroughputMBps,
    },
    confidenceBreakdown: {
      persistence: persistence(values, limit),
      margin: margin(current, limit, limit * 4),
      corroboration: CORROBORATION.unknown,
    },
  });
}

/** Finding raised by the heartbeat sweeper, not by telemetry. */
export function offlineFinding(device, offlineAfterSeconds) {
  const seconds = device.lastHeartbeat ? Math.round((Date.now() - new Date(device.lastHeartbeat)) / 1000) : null;
  return finding({
    ruleId: 'device_offline',
    title: 'Device stopped reporting',
    severity: 'WARNING',
    detectionReason: `No heartbeat received for ${seconds ?? 'an unknown number of'} seconds (limit ${offlineAfterSeconds}s).`,
    rootCause:
      'Possible root cause: the device is powered off, asleep, disconnected from the network, or the monitoring agent stopped unexpectedly.',
    recommendation: 'Confirm the device is powered on and connected, then check that the NanoPulse agent is running.',
    recommendedActions: [],
    metrics: { lastHeartbeat: device.lastHeartbeat, secondsSinceHeartbeat: seconds },
    confidenceBreakdown: { persistence: 1, margin: 1, corroboration: CORROBORATION.unknown },
  });
}

export const TELEMETRY_RULES = [cpuRule, memoryRule, diskRule, networkDownRule, networkTrafficRule];
