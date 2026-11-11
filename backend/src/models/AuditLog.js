import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorName: { type: String, default: 'system' },
    actorType: { type: String, enum: ['user', 'system', 'device'], default: 'system' },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String },
    details: mongoose.Schema.Types.Mixed,
    ip: String,
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

auditLogSchema.index({ timestamp: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
