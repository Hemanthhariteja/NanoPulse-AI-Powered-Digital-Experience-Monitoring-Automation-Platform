import { describe, expect, it } from 'vitest';
import { margin, persistence, score } from '../src/services/diagnostics/confidence.js';
import { assess } from '../src/services/diagnostics/engine.js';
import { cpuRule, networkTrafficRule, offlineFinding, severityFor } from '../src/services/diagnostics/rules.js';
import { DEFAULT_THRESHOLDS as T } from '../src/models/Settings.js';

const base = { cpuUsage: 20, ramUsage: 40, diskUsage: 50, networkConnected: true, processes: [] };

describe('threshold classification', () => {
  it('maps values to severities at the documented boundaries', () => {
    expect(severityFor(69.9, 70, 85)).toBeNull();
    expect(severityFor(70, 70, 85)).toBe('WARNING');
    expect(severityFor(85, 70, 85)).toBe('WARNING');
    expect(severityFor(85.1, 70, 85)).toBe('CRITICAL');
  });

  it('healthy sample yields no findings', () => {
    expect(assess(base)).toEqual({ status: 'HEALTHY', findings: [] });
  });

  it('detects every resource rule and derives the worst status', () => {
    const { status, findings } = assess({ ...base, cpuUsage: 90, ramUsage: 80, diskUsage: 95, networkConnected: false });
    expect(status).toBe('CRITICAL');
    expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([
      ['cpu_high', 'CRITICAL'],
      ['memory_high', 'WARNING'],
      ['disk_high', 'CRITICAL'],
      ['network_down', 'CRITICAL'],
    ]);
  });

  it('respects custom thresholds', () => {
    expect(assess({ ...base, cpuUsage: 55 }, [], { ...T, cpuWarning: 50, cpuCritical: 60 }).status).toBe('WARNING');
  });
});

describe('explainable findings', () => {
  it('attributes CPU load to a dominant process and recommends restart only for the demo app', () => {
    const f = cpuRule({ ...base, cpuUsage: 92, processes: [{ pid: 7, name: 'worker', cpuPercent: 70, isDemoApp: true }] }, [], T);
    expect(f.rootCause).toMatch(/Possible root cause: process "worker" \(PID 7\)/);
    expect(f.recommendedActions).toEqual(['list_top_cpu_processes', 'restart_demo_app']);
    const g = cpuRule({ ...base, cpuUsage: 92, processes: [{ pid: 7, name: 'svc', cpuPercent: 70 }] }, [], T);
    expect(g.recommendedActions).toEqual(['list_top_cpu_processes']);
  });

  it('does not claim a cause when load is spread or process data is missing', () => {
    const spread = cpuRule({ ...base, cpuUsage: 80, processes: [{ pid: 1, name: 'a', cpuPercent: 10 }] }, [], T);
    expect(spread.rootCause).toMatch(/spread across several processes/);
    expect(spread.confidenceBreakdown.corroboration).toBe(0.25);
    const none = cpuRule({ ...base, cpuUsage: 80 }, [], T);
    expect(none.rootCause).toMatch(/undetermined/);
    expect(none.confidenceBreakdown.corroboration).toBe(0.5);
  });

  it('includes every required explanation field', () => {
    const [f] = assess({ ...base, diskUsage: 93 }).findings;
    for (const key of ['title', 'severity', 'detectionReason', 'metrics', 'rootCause', 'recommendation', 'confidence', 'detectedAt']) {
      expect(f[key]).toBeDefined();
    }
  });
});

describe('confidence scoring', () => {
  it('computes 0.5·persistence + 0.3·margin + 0.2·corroboration', () => {
    expect(persistence([80, 80, 10, 80, 80], 70)).toBe(0.8);
    expect(persistence([80], 70)).toBe(0.2); // a single spike has low persistence
    expect(margin(85, 70)).toBe(0.5);
    expect(margin(50, 70)).toBe(0);
    expect(score({ persistence: 0.8, margin: 0.5, corroboration: 1 })).toBe(0.75);
  });

  it('a sustained breach scores higher than a single spike', () => {
    const procs = [{ pid: 1, name: 'x', cpuPercent: 60 }];
    const spike = cpuRule({ ...base, cpuUsage: 90, processes: procs }, [], T);
    const sustained = cpuRule({ ...base, cpuUsage: 90, processes: procs }, [{ cpuUsage: 88 }, { cpuUsage: 91 }, { cpuUsage: 89 }, { cpuUsage: 92 }], T);
    expect(sustained.confidence).toBeGreaterThan(spike.confidence);
    expect(sustained.confidenceBreakdown.persistence).toBe(1);
  });
});

describe('network rules', () => {
  it('requires 3 consecutive high-throughput samples', () => {
    const high = { ...base, networkDownload: 80e6, networkUpload: 0 };
    expect(networkTrafficRule(high, [high], T)).toBeNull();
    expect(networkTrafficRule(high, [high, high], T).ruleId).toBe('network_traffic_abnormal');
    expect(networkTrafficRule(high, [high, { ...high, networkDownload: 1 }], T)).toBeNull();
  });

  it('builds an offline finding', () => {
    const f = offlineFinding({ lastHeartbeat: new Date(Date.now() - 60_000) }, 45);
    expect(f.ruleId).toBe('device_offline');
    expect(f.metrics.secondsSinceHeartbeat).toBeGreaterThanOrEqual(59);
  });
});
