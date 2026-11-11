import mongoose from 'mongoose';

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
export const EXECUTION_STATUSES = [
  'NOT_STARTED',
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'TIMED_OUT',
  'CANCELLED',
];
export const TERMINAL_EXECUTION = ['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'CANCELLED'];

const actorSchema = new mongoose.Schema(
  { id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, name: String, type: { type: String, default: 'user' } },
  { _id: false }
);

const logSchema = new mongoose.Schema(
  { at: { type: Date, default: Date.now }, level: { type: String, default: 'info' }, message: String },
  { _id: false }
);

const remediationSchema = new mongoose.Schema(
  {
    actionId: { type: String, required: true, unique: true },
    incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident', default: null },
    incidentId: { type: String, default: null },
    deviceId: { type: String, required: true, index: true },
    deviceHostname: String,
    simulated: { type: Boolean, default: false },
    actionType: { type: String, required: true },
    label: String,
    riskLevel: String,
    parameters: { type: mongoose.Schema.Types.Mixed, default: {} },
    requestedBy: actorSchema,
    approvalStatus: { type: String, enum: APPROVAL_STATUSES, default: 'PENDING' },
    approvedBy: actorSchema,
    approvedAt: Date,
    rejectedReason: String,
    executionStatus: { type: String, enum: EXECUTION_STATUSES, default: 'NOT_STARTED' },
    executionMode: { type: String, enum: ['REAL', 'SIMULATED'] },
    executedBy: actorSchema,
    executionResult: {
      summary: String,
      data: mongoose.Schema.Types.Mixed,
      verification: mongoose.Schema.Types.Mixed,
      error: String,
      durationMs: Number,
    },
    timeoutSeconds: Number,
    queuedAt: Date,
    startedAt: Date,
    timeoutAt: Date,
    completedAt: Date,
    log: [logSchema],
  },
  { timestamps: true }
);

remediationSchema.index({ deviceId: 1, executionStatus: 1 });
remediationSchema.index({ approvalStatus: 1, createdAt: -1 });
remediationSchema.index({ executionStatus: 1, timeoutAt: 1 });
remediationSchema.index({ incident: 1 });

export const Remediation = mongoose.model('Remediation', remediationSchema);
