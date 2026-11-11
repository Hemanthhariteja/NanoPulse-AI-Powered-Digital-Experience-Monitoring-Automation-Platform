/** Deterministic profiles for virtual endpoints so every run produces the same fleet. */

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KINDS = [
  { prefix: 'WS', deviceType: 'workstation', os: 'Windows 11 Pro', osVersion: '10.0.22631', ramGb: 16, diskGb: 512 },
  { prefix: 'LT', deviceType: 'laptop', os: 'Windows 11 Enterprise', osVersion: '10.0.26100', ramGb: 16, diskGb: 256 },
  { prefix: 'LT', deviceType: 'laptop', os: 'Windows 10 Enterprise', osVersion: '10.0.19045', ramGb: 8, diskGb: 256 },
  { prefix: 'SRV', deviceType: 'server', os: 'Windows Server 2022', osVersion: '10.0.20348', ramGb: 32, diskGb: 1024 },
];

const DEPARTMENTS = ['FIN', 'HR', 'ENG', 'OPS', 'SALES', 'MKT'];

/**
 * Baselines are mostly healthy; a few devices are intentionally close to or over warning
 * thresholds so the fleet shows a realistic mix of health states.
 */
const BASELINE_OVERRIDES = {
  3: { disk: 84 },
  7: { ram: 79 },
  12: { cpu: 66 },
  16: { disk: 92 },
};

export function buildProfile(index) {
  const rnd = seededRandom(1000 + index);
  const kind = KINDS[index % 7 === 3 ? 3 : Math.floor(rnd() * 3)];
  const dept = DEPARTMENTS[index % DEPARTMENTS.length];
  const n = String(index + 1).padStart(3, '0');
  const o = BASELINE_OVERRIDES[index] || {};
  return {
    index,
    hostname: `SIM-${dept}-${kind.prefix}${n}`,
    deviceType: kind.deviceType,
    operatingSystem: kind.os,
    osVersion: kind.osVersion,
    architecture: 'AMD64',
    ipAddress: `10.20.${Math.floor(index / 50) + 1}.${(index % 250) + 10}`,
    cpuCount: kind.deviceType === 'server' ? 16 : 8,
    ramTotalBytes: kind.ramGb * 1024 ** 3,
    diskTotalBytes: kind.diskGb * 1024 ** 3,
    base: {
      cpu: o.cpu ?? 8 + rnd() * 35,
      ram: o.ram ?? 35 + rnd() * 30,
      disk: o.disk ?? 35 + rnd() * 40,
      netDown: 20_000 + rnd() * 1_500_000,
      netUp: 5_000 + rnd() * 400_000,
    },
    uptimeSeconds: Math.floor(3600 + rnd() * 86400 * 12),
  };
}

export const BACKGROUND_PROCESSES = [
  'explorer.exe',
  'chrome.exe',
  'msedge.exe',
  'Teams.exe',
  'OUTLOOK.EXE',
  'svchost.exe',
  'MsMpEng.exe',
  'SearchIndexer.exe',
  'Code.exe',
  'OneDrive.exe',
];

export const DEMO_APP_NAME = 'nanopulse-demo-worker.exe';
