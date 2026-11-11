import mongoose from 'mongoose';

export const INCIDENT_STATUSES = [
  'NEW',
  'INVESTIGATING',
  'PENDING_APPROVAL',
  'REMEDIATION_IN_PROGRESS',
  'RESOLVED',
  'FAILED',
];
export const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];
export const SEVERITY_RANK = { INFO: 1, WARNING: 2, CRITICAL: 3 };

const timelineSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    type: { type: String, required: true },
    message: { type: String, required: true },
    by: { type: String, default: 'system' },
  },
  { _id: false }
);

const incidentSchema = new mongoose.Schema(
  {
    incidentId: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true, index: true },
    deviceHostname: String,
    simulated: { type: Boolean, default: false },
    ruleId: { type: String, required: true },
    /** "<deviceId>:<ruleId>" — combined with isOpen gives duplicate prevention. */
    fingerprint: { type: String, required: true },
    isOpen: { type: Boolean, default: true },
    title: { type: String, required: true },
    description: String,
    detectionReason: String,
    severity: { type: String, enum: SEVERITIES, required: true },
    severityRank: { type: Number, required: true },
    /** Set when a technician changes severity manually; detections no longer overwrite it. */
    severityOverridden: { type: Boolean, default: false },
    rootCause: String,
    recommendation: String,
    recommendedActions: [String],
    confidence: Number,
    confidenceBreakdown: { persistence: Number, margin: Number, corroboration: Number },
    metrics: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: INCIDENT_STATUSES, default: 'NEW' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolutionNotes: String,
    resolvedBy: String,
    resolvedAt: Date,
    resolutionTimeSeconds: Number,
    firstDetectedAt: { type: Date, default: Date.now },
    lastDetectedAt: { type: Date, default: Date.now },
    occurrences: { type: Number, default: 1 },
    /** Consecutive telemetry samples in which the rule did not fire. */
    clearSamples: { type: Number, default: 0 },
    timeline: [timelineSchema],
  },
  { timestamps: true }
);

incidentSchema.index({ fingerprint: 1 }, { unique: true, partialFilterExpression: { isOpen: true } });
incidentSchema.index({ isOpen: 1, severityRank: -1, createdAt: -1 });
incidentSchema.index({ status: 1, createdAt: -1 });
incidentSchema.index({ createdAt: -1 });

export const Incident = mongoose.model('Incident', incidentSchema);
