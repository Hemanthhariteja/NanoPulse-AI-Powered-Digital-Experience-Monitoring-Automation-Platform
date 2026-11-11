import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { requireDevice } from '../middleware/deviceAuth.js';
import { validate } from '../middleware/validate.js';
import { Device } from '../models/index.js';
import { RANGES, ingest, latestTelemetry, telemetryHistory } from '../services/telemetryService.js';
import { asyncHandler, notFound } from '../utils/errors.js';
import { rangeQuery, telemetrySchema } from './schemas.js';

const router = Router();
const deviceParam = { deviceId: z.string().min(1).max(64) };

router.post(
  '/',
  requireDevice,
  validate({ body: telemetrySchema }),
  asyncHandler(async (req, res) => {
    const result = await ingest(req.device, req.valid.body);
    res.status(202).json(result);
  })
);

const ensureDevice = async (deviceId) => {
  if (!(await Device.exists({ deviceId }))) throw notFound('Device');
};

router.get(
  '/:deviceId',
  requireAuth,
  validate({ params: deviceParam, query: { limit: z.coerce.number().int().min(1).max(500).default(60) } }),
  asyncHandler(async (req, res) => {
    await ensureDevice(req.valid.params.deviceId);
    res.json({ data: await latestTelemetry(req.valid.params.deviceId, req.valid.query.limit) });
  })
);

router.get(
  '/:deviceId/history',
  requireAuth,
  validate({ params: deviceParam, query: rangeQuery(RANGES) }),
  asyncHandler(async (req, res) => {
    await ensureDevice(req.valid.params.deviceId);
    res.json(await telemetryHistory(req.valid.params.deviceId, req.valid.query.range));
  })
);

export default router;
