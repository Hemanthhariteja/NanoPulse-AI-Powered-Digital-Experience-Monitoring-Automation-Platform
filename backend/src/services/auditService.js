import { AuditLog } from '../models/index.js';
import { logger } from '../utils/logger.js';

/**
 * Record an audit entry. `actor` is a req.user-like object, a device, or omitted for system actions.
 * Audit failures are logged but never break the business operation that triggered them.
 */
export async function audit({ actor, actorType, action, entityType, entityId, details, ip }) {
  try {
    const type = actorType || (actor ? 'user' : 'system');
    await AuditLog.create({
      userId: type === 'user' ? actor?._id || actor?.id : null,
      actorName: actor?.name || actor?.hostname || 'system',
      actorType: type,
      action,
      entityType,
      entityId: entityId ? String(entityId) : undefined,
      details,
      ip,
    });
  } catch (err) {
    logger.error(`Failed to write audit log for ${action}: ${err.message}`);
  }
}

export async function pruneAuditLogs(retentionDays) {
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  const { deletedCount } = await AuditLog.deleteMany({ timestamp: { $lt: cutoff } });
  if (deletedCount) logger.info(`Pruned ${deletedCount} audit log entries older than ${retentionDays} days`);
  return deletedCount;
}
