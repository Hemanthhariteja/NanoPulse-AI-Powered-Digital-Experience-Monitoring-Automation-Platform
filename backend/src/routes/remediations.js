import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { APPROVAL_STATUSES, EXECUTION_STATUSES } from '../models/index.js';
import { ACTION_TYPES, publicCatalog } from '../services/remediation/catalog.js';
import {
  approveRemediation,
  cancelRemediation,
  executeRemediation,
  getRemediation,
  listRemediations,
  rejectRemediation,
  requestRemediation,
} from '../services/remediation/remediationService.js';
import { asyncHandler } from '../utils/errors.js';
import { paginationSchema } from '../utils/pagination.js';

const router = Router();
router.use(requireAuth);
const idParam = { id: z.string().min(1).max(64) };

const listQuery = {
  ...paginationSchema,
  view: z.enum(['pending', 'approved', 'history']).optional(),
  approvalStatus: z.enum(APPROVAL_STATUSES).optional(),
  executionStatus: z.enum(EXECUTION_STATUSES).optional(),
  deviceId: z.string().max(64).optional(),
  incidentId: z.string().max(64).optional(),
};

router.get('/catalog', (_req, res) => res.json({ data: publicCatalog() }));

router.get('/', validate({ query: listQuery }), asyncHandler(async (req, res) => res.json(await listRemediations(req.valid.query))));

router.get(
  '/history',
  validate({ query: listQuery }),
  asyncHandler(async (req, res) => res.json(await listRemediations({ ...req.valid.query, view: 'history' })))
);

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await getRemediation(req.valid.params.id))));

/** Technicians and admins may request; nothing runs until an admin approves and executes. */
router.post(
  '/',
  validate({
    body: z
      .object({
        incidentId: z.string().max(64).optional(),
        deviceId: z.string().max(64).optional(),
        actionType: z.enum(ACTION_TYPES),
        parameters: z.record(z.string(), z.unknown()).optional(),
      })
      .refine((b) => b.incidentId || b.deviceId, 'incidentId or deviceId is required'),
  }),
  asyncHandler(async (req, res) => res.status(201).json(await requestRemediation(req.valid.body, req.user)))
);

router.post(
  '/:id/approve',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await approveRemediation(req.valid.params.id, req.user)))
);

router.post(
  '/:id/reject',
  requireRole('admin'),
  validate({ params: idParam, body: { reason: z.string().trim().min(3, 'A rejection reason is required').max(1000) } }),
  asyncHandler(async (req, res) => res.json(await rejectRemediation(req.valid.params.id, req.valid.body.reason, req.user)))
);

router.post(
  '/:id/execute',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.status(202).json(await executeRemediation(req.valid.params.id, req.user)))
);

router.post(
  '/:id/cancel',
  requireRole('admin'),
  validate({ params: idParam }),
  asyncHandler(async (req, res) => res.json(await cancelRemediation(req.valid.params.id, req.user)))
);

export default router;
