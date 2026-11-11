import { Router } from 'express';
import { z } from 'zod';
import { requireDevice } from '../middleware/deviceAuth.js';
import { validate } from '../middleware/validate.js';
import { markShutdown } from '../services/deviceService.js';
import { claimCommands, submitResult } from '../services/remediation/remediationService.js';
import { getSettingsInternal } from '../services/settingsService.js';
import { asyncHandler } from '../utils/errors.js';
import { commandResultSchema } from './schemas.js';

/** Endpoints used by monitoring agents, authenticated with device credentials. */
const router = Router();
router.use(requireDevice);

router.get(
  '/config',
  asyncHandler(async (_req, res) => {
    const s = await getSettingsInternal();
    res.json({ telemetryIntervalSeconds: s.telemetryIntervalSeconds, thresholds: s.thresholds });
  })
);

router.get(
  '/commands',
  asyncHandler(async (req, res) => res.json({ commands: await claimCommands(req.device) }))
);

router.post(
  '/commands/:actionId/result',
  validate({ params: { actionId: z.string().regex(/^ACT-\d{6,}$/) }, body: commandResultSchema }),
  asyncHandler(async (req, res) => {
    const rem = await submitResult(req.device, req.valid.params.actionId, req.valid.body);
    res.json({ actionId: rem.actionId, executionStatus: rem.executionStatus });
  })
);

router.post(
  '/shutdown',
  asyncHandler(async (req, res) => {
    await markShutdown(req.device);
    res.status(204).end();
  })
);

export default router;
