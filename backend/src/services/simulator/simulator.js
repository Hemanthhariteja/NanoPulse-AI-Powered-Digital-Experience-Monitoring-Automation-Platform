import { Device, Incident, Remediation, Telemetry } from '../../models/index.js';
import { nameUuid } from '../../utils/crypto.js';
import { conflict } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { audit } from '../auditService.js';
import { bus } from '../bus.js';
import { registerDevice } from '../deviceService.js';
import { resolveAllForDevice } from '../incidentService.js';
import { emit } from '../realtime.js';
import { claimCommands, submitResult } from '../remediation/remediationService.js';
import { ingest } from '../telemetryService.js';
import { BACKGROUND_PROCESSES, DEMO_APP_NAME, buildProfile } from './profiles.js';

export const SCENARIOS = ['high_cpu', 'high_ram', 'low_disk', 'network_down', 'restore'];
const MAX_DEVICES = 100;

const clamp = (v, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const r1 = (n) => Math.round(n * 10) / 10;
const noise = (amp) => (Math.random() - 0.5) * 2 * amp;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Virtual endpoint fleet. Each tick produces telemetry for every virtual device and sends it
 * through telemetryService.ingest() — the exact pipeline used by real agents — so diagnostics,
 * incidents, remediation and realtime updates behave identically. Remediations dispatched to
 * simulated devices are executed here and their results are explicitly labelled SIMULATED.
 */
class Simulator {
  constructor() {
    this.devices = new Map();
    this.timer = null;
    this.running = false;
    this.startedAt = null;
    this.intervalMs = 5000;
    this.ticking = false;
    this.onQueued = (rem) => this.handleRemediation(rem).catch((err) => logger.error(`Simulated remediation failed: ${err.message}`));
  }

  state() {
    return {
      running: this.running,
      startedAt: this.startedAt,
      intervalMs: this.intervalMs,
      deviceCount: this.devices.size,
      scenarios: [...this.devices.values()]
        .filter((d) => d.scenario)
        .map((d) => ({ deviceId: d.deviceId, hostname: d.profile.hostname, scenario: d.scenario, since: d.scenarioSince })),
      availableScenarios: SCENARIOS,
    };
  }

  broadcast() {
    emit('simulation:state', this.state());
  }

  /** Called at boot: leftover virtual devices from a previous run must not raise offline incidents. */
  async init() {
    await Device.updateMany({ agentType: 'simulated' }, { $set: { status: 'OFFLINE', monitoringPaused: true } });
    // A crash or kill skips stop(); close incidents left open by the previous run.
    const ids = await Incident.distinct('deviceId', { simulated: true, isOpen: true });
    for (const id of ids) await resolveAllForDevice(id, 'Closed: simulation was not running after server restart.');
    await Remediation.updateMany(
      { simulated: true, executionStatus: { $in: ['NOT_STARTED', 'QUEUED', 'RUNNING'] } },
      { $set: { executionStatus: 'CANCELLED', completedAt: new Date() }, $push: { log: { message: 'Cancelled: server restarted' } } }
    );
  }

  async start({ count = 20, intervalMs = 5000 } = {}, user) {
    if (this.running) throw conflict('Simulation is already running');
    const n = Math.min(MAX_DEVICES, Math.max(1, count));
    this.intervalMs = Math.max(1000, intervalMs);
    this.devices.clear();

    for (let i = 0; i < n; i++) {
      const profile = buildProfile(i);
      const deviceId = nameUuid(`sim:${profile.hostname}`);
      await registerDevice(
        {
          deviceId,
          hostname: profile.hostname,
          operatingSystem: profile.operatingSystem,
          osVersion: profile.osVersion,
          architecture: profile.architecture,
          ipAddress: profile.ipAddress,
          deviceType: profile.deviceType,
          agentType: 'simulated',
          agentVersion: 'simulator-1.0',
          capabilities: { demoApp: true, safeTempDir: true },
        },
        { trusted: true }
      );
      this.devices.set(deviceId, {
        deviceId,
        profile,
        status: 'PENDING',
        cpu: profile.base.cpu,
        ram: profile.base.ram,
        disk: profile.base.disk,
        uptime: profile.uptimeSeconds,
        demoPid: 4000 + i * 17,
        scenario: null,
        scenarioSince: null,
      });
    }

    this.running = true;
    this.startedAt = new Date();
    bus.on('remediation:queued', this.onQueued);
    await this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    await audit({ actor: user, action: 'simulation.started', entityType: 'simulation', details: { count: n, intervalMs: this.intervalMs } });
    this.broadcast();
    logger.info(`Simulation started with ${n} virtual devices`);
    return this.state();
  }

  async stop(user) {
    if (!this.running) throw conflict('Simulation is not running');
    clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    bus.off('remediation:queued', this.onQueued);
    const ids = [...this.devices.keys()];
    await Device.updateMany({ deviceId: { $in: ids } }, { $set: { status: 'OFFLINE', monitoringPaused: true } });
    for (const id of ids) await resolveAllForDevice(id, 'Closed: simulation stopped.');
    await Remediation.updateMany(
      { deviceId: { $in: ids }, executionStatus: { $in: ['NOT_STARTED', 'QUEUED'] } },
      { $set: { executionStatus: 'CANCELLED', completedAt: new Date() }, $push: { log: { message: 'Cancelled: simulation stopped' } } }
    );
    for (const d of this.devices.values()) {
      d.scenario = null;
      emit('device:updated', { deviceId: d.deviceId, status: 'OFFLINE', monitoringPaused: true });
    }
    this.devices.clear();
    await audit({ actor: user, action: 'simulation.stopped', entityType: 'simulation', details: { devices: ids.length } });
    this.broadcast();
    logger.info('Simulation stopped');
    return this.state();
  }

  /** Remove every simulated device and its telemetry, incidents and remediations. */
  async reset(user) {
    if (this.running) await this.stop(user);
    const filter = { agentType: 'simulated' };
    const ids = (await Device.find(filter).select('deviceId').lean()).map((d) => d.deviceId);
    const [t, i, r, d] = await Promise.all([
      Telemetry.deleteMany({ deviceId: { $in: ids } }),
      Incident.deleteMany({ deviceId: { $in: ids } }),
      Remediation.deleteMany({ deviceId: { $in: ids } }),
      Device.deleteMany(filter),
    ]);
    const details = { devices: d.deletedCount, telemetry: t.deletedCount, incidents: i.deletedCount, remediations: r.deletedCount };
    await audit({ actor: user, action: 'simulation.reset', entityType: 'simulation', details });
    for (const id of ids) emit('device:updated', { deviceId: id, deleted: true });
    this.broadcast();
    return details;
  }

  applyScenario(scenario, { deviceIds, count = 1 } = {}, user) {
    if (!this.running) throw conflict('Start the simulation before injecting scenarios');
    let targets;
    if (deviceIds?.length) {
      targets = deviceIds.map((id) => this.devices.get(id)).filter(Boolean);
    } else if (scenario === 'restore') {
      targets = [...this.devices.values()].filter((d) => d.scenario);
    } else {
      const candidates = [...this.devices.values()].filter((d) => !d.scenario);
      candidates.sort(() => Math.random() - 0.5);
      targets = candidates.slice(0, Math.max(1, count));
    }
    if (!targets.length) throw conflict('No matching simulated devices for this scenario');

    for (const d of targets) {
      if (scenario === 'restore') {
        d.scenario = null;
        d.scenarioSince = null;
        d.cpu = d.profile.base.cpu;
        d.ram = d.profile.base.ram;
        d.disk = Math.min(d.disk, d.profile.base.disk);
      } else {
        d.scenario = scenario;
        d.scenarioSince = new Date();
      }
    }
    audit({
      actor: user,
      action: 'simulation.scenario',
      entityType: 'simulation',
      details: { scenario, devices: targets.map((d) => d.profile.hostname) },
    });
    this.broadcast();
    return { scenario, devices: targets.map((d) => ({ deviceId: d.deviceId, hostname: d.profile.hostname })) };
  }

  /** Produce one controlled-random telemetry sample for a virtual device. */
  sample(d) {
    const p = d.profile;
    // Mean-reverting random walk around the baseline keeps values plausible.
    d.cpu = clamp(d.cpu + (p.base.cpu - d.cpu) * 0.3 + noise(5), 2, 100);
    d.ram = clamp(d.ram + (p.base.ram - d.ram) * 0.2 + noise(2), 10, 100);
    d.disk = clamp(d.disk + 0.002, 5, 100);
    d.uptime += this.intervalMs / 1000;

    let cpu = d.cpu;
    let ram = d.ram;
    let disk = d.disk;
    let demoCpu = clamp(0.5 + noise(0.5), 0, 5);
    let demoMem = 1.2 + noise(0.3);
    let connected = true;
    let down = clamp(p.base.netDown * (1 + noise(0.4)), 0, Infinity);
    let up = clamp(p.base.netUp * (1 + noise(0.4)), 0, Infinity);

    switch (d.scenario) {
      case 'high_cpu':
        demoCpu = 72 + Math.random() * 8;
        cpu = clamp(demoCpu + 14 + noise(3), 0, 99.5);
        break;
      case 'high_ram':
        demoMem = 58 + Math.random() * 4;
        ram = clamp(93 + noise(2), 0, 99.5);
        break;
      case 'low_disk':
        disk = clamp(Math.max(disk, 94 + noise(1)), 0, 99.8);
        break;
      case 'network_down':
        connected = false;
        down = Math.random() * 500;
        up = Math.random() * 200;
        break;
      default:
        break;
    }

    let remainingCpu = Math.max(0, cpu - demoCpu);
    const processes = BACKGROUND_PROCESSES.map((name, i) => {
      const share = remainingCpu * (0.35 / (i + 1)) * (0.7 + Math.random() * 0.6);
      return {
        pid: 1000 + i * 113 + p.index,
        name,
        cpuPercent: r1(Math.min(share, remainingCpu)),
        memoryPercent: r1(Math.max(0.2, (ram / 12) * (1 / (1 + i * 0.4)) + noise(0.5))),
        isDemoApp: false,
      };
    });
    processes.push({ pid: d.demoPid, name: DEMO_APP_NAME, cpuPercent: r1(demoCpu), memoryPercent: r1(demoMem), isDemoApp: true });
    processes.forEach((pr) => (pr.memoryBytes = Math.round((pr.memoryPercent / 100) * p.ramTotalBytes)));
    processes.sort((a, b) => b.cpuPercent - a.cpuPercent);
    remainingCpu = 0;

    return {
      cpuUsage: r1(cpu),
      cpuCount: p.cpuCount,
      ramUsage: r1(ram),
      ramTotalBytes: p.ramTotalBytes,
      ramAvailableBytes: Math.round(p.ramTotalBytes * (1 - ram / 100)),
      diskUsage: r1(disk),
      diskTotalBytes: p.diskTotalBytes,
      diskFreeBytes: Math.round(p.diskTotalBytes * (1 - disk / 100)),
      networkUpload: Math.round(up),
      networkDownload: Math.round(down),
      networkConnected: connected,
      uptimeSeconds: Math.round(d.uptime),
      processes: processes.slice(0, 10),
      interfaces: [{ name: 'Ethernet', addresses: [p.ipAddress], isUp: true, speedMbps: 1000 }],
      ipAddress: p.ipAddress,
    };
  }

  async tick() {
    if (!this.running || this.ticking) return;
    this.ticking = true;
    try {
      await Promise.all(
        [...this.devices.values()].map(async (d) => {
          d.lastSample = this.sample(d);
          const res = await ingest({ deviceId: d.deviceId, agentType: 'simulated', status: d.status }, d.lastSample);
          d.status = res.status;
        })
      );
    } catch (err) {
      logger.error(`Simulation tick failed: ${err.message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Execute a dispatched remediation against a virtual device. Results are labelled SIMULATED. */
  async handleRemediation(rem) {
    const d = this.devices.get(rem.deviceId);
    if (!d) return;
    const device = { deviceId: d.deviceId, hostname: d.profile.hostname, agentType: 'simulated' };
    const [command] = await claimCommands(device, 1);
    if (!command) return;
    const started = Date.now();
    await sleep(1200 + Math.random() * 1500);
    const last = d.lastSample || this.sample(d);
    const result = this.simulateAction(d, command, last);
    await submitResult(device, command.actionId, { ...result, mode: 'SIMULATED', durationMs: Date.now() - started });
  }

  simulateAction(d, command, last) {
    const limit = command.parameters?.limit || 10;
    const label = 'SIMULATED';
    switch (command.actionType) {
      case 'list_top_cpu_processes': {
        const top = [...last.processes].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, limit);
        return {
          status: 'SUCCEEDED',
          summary: `${label}: top CPU consumer is ${top[0].name} (${top[0].cpuPercent}% CPU)`,
          data: { processes: top },
          verification: { cpuUsage: last.cpuUsage },
        };
      }
      case 'list_top_memory_processes': {
        const top = [...last.processes].sort((a, b) => b.memoryPercent - a.memoryPercent).slice(0, limit);
        return {
          status: 'SUCCEEDED',
          summary: `${label}: largest memory consumer is ${top[0].name} (${top[0].memoryPercent}% RAM)`,
          data: { processes: top },
          verification: { ramUsage: last.ramUsage },
        };
      }
      case 'check_network_connectivity': {
        const ok = d.scenario !== 'network_down';
        const probes = ['1.1.1.1:53', '8.8.8.8:53', 'www.microsoft.com:443'].map((target) => ({
          target,
          reachable: ok,
          latencyMs: ok ? Math.round(8 + Math.random() * 30) : null,
          error: ok ? null : 'timed out',
        }));
        return {
          status: 'SUCCEEDED',
          summary: `${label}: ${probes.filter((p) => p.reachable).length}/${probes.length} probes reachable${ok ? '' : '; DNS resolution failed'}`,
          data: { probes, dns: ok ? 'ok' : 'failed' },
          verification: { networkConnected: ok },
        };
      }
      case 'network_diagnostics': {
        const ok = d.scenario !== 'network_down';
        return {
          status: 'SUCCEEDED',
          summary: `${label}: 1 interface up, ${ok ? 'gateway reachable' : 'default gateway not responding'}`,
          data: {
            interfaces: last.interfaces,
            gatewayReachable: ok,
            connections: { established: Math.round(20 + Math.random() * 60), listening: 14 },
            throughput: { uploadBytesPerSec: last.networkUpload, downloadBytesPerSec: last.networkDownload },
          },
          verification: { networkConnected: ok },
        };
      }
      case 'clear_temp_files': {
        const before = last.diskUsage;
        const freedPct = d.scenario === 'low_disk' ? 12 + Math.random() * 6 : 1 + Math.random() * 2;
        const freedBytes = Math.round((freedPct / 100) * d.profile.diskTotalBytes);
        const files = Math.round(freedBytes / 2_500_000);
        if (!command.parameters?.dryRun) {
          d.disk = clamp(Math.min(d.disk, before) - freedPct, 5, 100);
          d.profile.base.disk = Math.min(d.profile.base.disk, d.disk);
          if (d.scenario === 'low_disk') d.scenario = null;
        }
        return {
          status: 'SUCCEEDED',
          summary: `${label}: ${command.parameters?.dryRun ? 'would delete' : 'deleted'} ${files} files (${(freedBytes / 1024 ** 3).toFixed(1)} GB) from the safe temp directory`,
          data: { filesDeleted: command.parameters?.dryRun ? 0 : files, bytesFreed: freedBytes, dryRun: Boolean(command.parameters?.dryRun) },
          verification: { diskUsageBefore: before, diskUsageAfter: r1(d.disk) },
        };
      }
      case 'restart_demo_app': {
        const oldPid = d.demoPid;
        d.demoPid = oldPid + 7;
        const before = { cpuUsage: last.cpuUsage, ramUsage: last.ramUsage };
        if (d.scenario === 'high_cpu' || d.scenario === 'high_ram') {
          d.scenario = null;
          d.cpu = d.profile.base.cpu;
          d.ram = d.profile.base.ram;
        }
        this.broadcast();
        return {
          status: 'SUCCEEDED',
          summary: `${label}: restarted ${DEMO_APP_NAME} (PID ${oldPid} → ${d.demoPid})`,
          data: { process: DEMO_APP_NAME, oldPid, newPid: d.demoPid },
          verification: { before, after: { cpuUsage: r1(d.cpu), ramUsage: r1(d.ram) }, processRunning: true },
        };
      }
      default:
        return { status: 'FAILED', summary: `${label}: unsupported action`, error: `Unknown action ${command.actionType}` };
    }
  }
}

export const simulator = new Simulator();
