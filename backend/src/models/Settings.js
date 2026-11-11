import mongoose from 'mongoose';

export const DEFAULT_THRESHOLDS = {
  cpuWarning: 70,
  cpuCritical: 85,
  ramWarning: 75,
  ramCritical: 90,
  diskWarning: 80,
  diskCritical: 90,
  networkThroughputMBps: 50,
};

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'global', unique: true },
    thresholds: {
      cpuWarning: { type: Number, default: DEFAULT_THRESHOLDS.cpuWarning },
      cpuCritical: { type: Number, default: DEFAULT_THRESHOLDS.cpuCritical },
      ramWarning: { type: Number, default: DEFAULT_THRESHOLDS.ramWarning },
      ramCritical: { type: Number, default: DEFAULT_THRESHOLDS.ramCritical },
      diskWarning: { type: Number, default: DEFAULT_THRESHOLDS.diskWarning },
      diskCritical: { type: Number, default: DEFAULT_THRESHOLDS.diskCritical },
      networkThroughputMBps: { type: Number, default: DEFAULT_THRESHOLDS.networkThroughputMBps },
    },
    telemetryIntervalSeconds: { type: Number, default: 10 },
    offlineAfterSeconds: { type: Number, default: 45 },
    autoResolveAfterSamples: { type: Number, default: 2 },
    autoRequestRemediation: { type: Boolean, default: false },
    auditRetentionDays: { type: Number, default: 90 },
    enrollmentKey: { type: String, select: false },
    updatedBy: String,
  },
  { timestamps: true }
);

export const Settings = mongoose.model('Settings', settingsSchema);
