import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { SCENARIOS, simulator } from '../services/simulator/simulator.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

router.get('/', (_req, res) => res.json(simulator.state()));

router.post(
  '/start',
  requireRole('admin'),
  validate({
    body: z.object({
      count: z.number().int().min(1).max(100).default(20),
      intervalMs: z.number().int().min(1000).max(60000).default(env.simulatorIntervalMs),
    }),
  }),
  asyncHandler(async (req, res) => res.json(await simulator.start(req.valid.body, req.user)))
);

router.post('/stop', requireRole('admin'), asyncHandler(async (req, res) => res.json(await simulator.stop(req.user))));

router.post('/reset', requireRole('admin'), asyncHandler(async (req, res) => res.json(await simulator.reset(req.user))));

router.post(
  '/scenario',
  requireRole('admin'),
  validate({
    body: z.object({
      scenario: z.enum(SCENARIOS),
      deviceIds: z.array(z.string().max(64)).max(100).optional(),
      count: z.number().int().min(1).max(100).default(1),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { scenario, ...opts } = req.valid.body;
    res.json(simulator.applyScenario(scenario, opts, req.user));
  })
);

export default router;
