import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { audit } from '../services/auditService.js';
import { getSettings, getSettingsInternal, rotateEnrollmentKey, updateSettings } from '../services/settingsService.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const pct = z.number().min(1).max(100);

router.get('/', asyncHandler(async (_req, res) => res.json(await getSettings())));

router.patch(
  '/',
  requireRole('admin'),
  validate({
    body: z
      .object({
        thresholds: z
          .object({
            cpuWarning: pct,
            cpuCritical: pct,
            ramWarning: pct,
            ramCritical: pct,
            diskWarning: pct,
            diskCritical: pct,
            networkThroughputMBps: z.number().min(1).max(10000),
          })
          .partial()
          .optional(),
        telemetryIntervalSeconds: z.number().int().min(5).max(300).optional(),
        offlineAfterSeconds: z.number().int().min(15).max(3600).optional(),
        autoResolveAfterSamples: z.number().int().min(1).max(20).optional(),
        autoRequestRemediation: z.boolean().optional(),
        auditRetentionDays: z.number().int().min(7).max(3650).optional(),
      })
      .strict(),
  }),
  asyncHandler(async (req, res) => {
    const updated = await updateSettings(req.valid.body, req.user);
    await audit({ actor: req.user, action: 'settings.updated', entityType: 'settings', entityId: 'global', details: req.valid.body });
    res.json(updated);
  })
);

router.get(
  '/enrollment-key',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const s = await getSettingsInternal();
    await audit({ actor: req.user, action: 'settings.enrollment_key_viewed', entityType: 'settings', entityId: 'global' });
    res.json({ enrollmentKey: s.enrollmentKey });
  })
);

router.post(
  '/enrollment-key/rotate',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const enrollmentKey = await rotateEnrollmentKey();
    await audit({ actor: req.user, action: 'settings.enrollment_key_rotated', entityType: 'settings', entityId: 'global' });
    res.json({ enrollmentKey });
  })
);

export default router;
