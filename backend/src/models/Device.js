import mongoose from 'mongoose';

export const DEVICE_STATUSES = ['PENDING', 'HEALTHY', 'WARNING', 'CRITICAL', 'OFFLINE'];

const processSchema = new mongoose.Schema(
  {
    pid: Number,
    name: String,
    cpuPercent: Number,
    memoryPercent: Number,
    memoryBytes: Number,
    isDemoApp: Boolean,
  },
  { _id: false }
);

const interfaceSchema = new mongoose.Schema(
  { name: String, addresses: [String], isUp: Boolean, speedMbps: Number },
  { _id: false }
);

const deviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true },
    hostname: { type: String, required: true, trim: true, maxlength: 255 },
    operatingSystem: { type: String, default: 'Unknown', maxlength: 100 },
    osVersion: { type: String, maxlength: 200 },
    architecture: { type: String, maxlength: 50 },
    ipAddress: { type: String, maxlength: 64 },
    deviceType: { type: String, enum: ['workstation', 'laptop', 'server', 'virtual'], default: 'workstation' },
    agentType: { type: String, enum: ['python-agent', 'simulated'], required: true },
    agentVersion: { type: String, maxlength: 50 },
    capabilities: {
      demoApp: { type: Boolean, default: false },
      safeTempDir: { type: Boolean, default: false },
      actions: [String],
    },
    status: { type: String, enum: DEVICE_STATUSES, default: 'PENDING', index: true },
    /** True when the agent shut down intentionally or the simulator is stopped: no offline incident. */
    monitoringPaused: { type: Boolean, default: false },
    secretHash: { type: String, required: true, select: false },
    lastHeartbeat: Date,
    registeredAt: { type: Date, default: Date.now },
    latest: {
      cpuUsage: Number,
      cpuCount: Number,
      ramUsage: Number,
      ramTotalBytes: Number,
      ramAvailableBytes: Number,
      diskUsage: Number,
      diskTotalBytes: Number,
      diskFreeBytes: Number,
      networkUpload: Number,
      networkDownload: Number,
      networkBytesSent: Number,
      networkBytesRecv: Number,
      networkConnected: Boolean,
      uptimeSeconds: Number,
      processes: [processSchema],
      interfaces: [interfaceSchema],
      at: Date,
    },
    activeRules: [String],
  },
  { timestamps: true }
);

deviceSchema.index({ agentType: 1, status: 1 });
deviceSchema.index({ lastHeartbeat: -1 });
deviceSchema.index({ hostname: 'text' });

export const Device = mongoose.model('Device', deviceSchema);
