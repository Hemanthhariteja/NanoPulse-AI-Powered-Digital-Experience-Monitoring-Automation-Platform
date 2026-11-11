import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { INCIDENT_STATUSES, SEVERITIES } from '../models/index.js';
import { MANUAL_STATUSES, getIncident, listIncidents, resolveIncident, updateIncident } from '../services/incidentService.js';
import { asyncHandler } from '../utils/errors.js';
import { paginationSchema } from '../utils/pagination.js';

const router = Router();
router.use(requireAuth);
const idParam = { id: z.string().min(1).max(64) };

router.get(
  '/',
  validate({
    query: {
      ...paginationSchema,
      status: z.enum([...INCIDENT_STATUSES, 'OPEN']).optional(),
      severity: z.enum(SEVERITIES).optional(),
      deviceId: z.string().max(64).optional(),
      simulated: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
      search: z.string().trim().max(100).optional(),
      sort: z.enum(['severity', '-severity', 'newest', 'oldest']).optional(),
    },
  }),
  asyncHandler(async (req, res) => res.json(await listIncidents(req.valid.query)))
);

router.get('/:id', validate({ params: idParam }), asyncHandler(async (req, res) => res.json(await getIncident(req.valid.params.id))));

router.patch(
  '/:id',
  validate({
    params: idParam,
    body: z.object({
      status: z.enum(MANUAL_STATUSES).optional(),
      severity: z.enum(SEVERITIES).optional(),
      assignedTo: objectId.nullable().optional(),
      note: z.string().trim().min(1).max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => res.json(await updateIncident(req.valid.params.id, req.valid.body, req.user)))
);

router.post(
  '/:id/resolve',
  validate({ params: idParam, body: { notes: z.string().trim().min(3, 'Resolution notes are required').max(4000) } }),
  asyncHandler(async (req, res) => res.json(await resolveIncident(req.valid.params.id, req.valid.body.notes, req.user)))
);

export default router;
