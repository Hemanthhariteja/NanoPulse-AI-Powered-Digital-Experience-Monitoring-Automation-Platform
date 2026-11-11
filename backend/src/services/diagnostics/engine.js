import { DEFAULT_THRESHOLDS } from '../../models/Settings.js';
import { TELEMETRY_RULES } from './rules.js';

export const HISTORY_SIZE = 4;

/**
 * Run every telemetry rule against a sample.
 * @param sample   normalised telemetry sample (cpuUsage, ramUsage, diskUsage, processes, ...)
 * @param history  previous samples for the device, oldest → newest (up to HISTORY_SIZE)
 * @param thresholds configured thresholds
 * @returns {{ status: 'HEALTHY'|'WARNING'|'CRITICAL', findings: object[] }}
 */
export function assess(sample, history = [], thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const findings = TELEMETRY_RULES.map((rule) => rule(sample, history, t)).filter(Boolean);
  return { status: healthStatus(findings), findings };
}

export function healthStatus(findings) {
  if (findings.some((f) => f.severity === 'CRITICAL')) return 'CRITICAL';
  if (findings.some((f) => f.severity === 'WARNING')) return 'WARNING';
  return 'HEALTHY';
}
