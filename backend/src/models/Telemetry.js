import mongoose from 'mongoose';
import { env } from '../config/env.js';

const telemetrySchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true },
    cpuUsage: { type: Number, required: true },
    ramUsage: { type: Number, required: true },
    diskUsage: { type: Number, required: true },
    /** Bytes per second since the previous sample. */
    networkUpload: { type: Number, default: 0 },
    networkDownload: { type: Number, default: 0 },
    networkConnected: { type: Boolean, default: true },
    uptime: { type: Number, default: 0 },
    status: { type: String },
    simulated: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

telemetrySchema.index({ deviceId: 1, timestamp: -1 });
// Retention policy: MongoDB removes raw samples automatically after the retention window.
telemetrySchema.index({ timestamp: 1 }, { expireAfterSeconds: env.telemetryRetentionDays * 86400 });

export const Telemetry = mongoose.model('Telemetry', telemetrySchema);
