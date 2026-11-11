import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { registerDeviceLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { DEVICE_STATUSES } from '../models/index.js';
import { deleteDevice, getDevice, listDevices, registerDevice } from '../services/deviceService.js';
import { asyncHandler } from '../utils/errors.js';
import { paginationSchema } from '../utils/pagination.js';
import { deviceRegisterSchema } from './schemas.js';

const router = Router();
const idParam = { id: z.string().min(1).max(64) };

/** Agent enrollment — authenticated by the enrollment key, not a user session. */
router.post(
  '/register',
  registerDeviceLimiter,
  validate({ body: deviceRegisterSchema }),
  asyncHandler(async (req, res) => {
    const result = await registerDevice(req.valid.body, { ip: req.ip });
    res.status(result.reenrolled ? 200 : 201).json(result);
  })
);

router.get(
  '/',
  requireAuth,
  validate({
    query: {
      ...paginationSchema,
      status: z.enum(DEVICE_STATUSES).optional(),
      agentType: z.enum(['python-agent', 'simulated']).optional(),
      search: z.string().trim().max(100).optional(),
      sort: z.enum(['hostname', 'status', 'cpu', 'ram', 'disk', 'heartbeat']).optional(),
    },
  }),
  asyncHandler(async (req, res) => res.json(await listDevices(req.valid.query)))
);

router.get(
  '/:id',
  requireAuth,
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await getDevice(req.valid.params.id)))
);

router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await deleteDevice(req.valid.params.id, req.user)))
);

export default router;
