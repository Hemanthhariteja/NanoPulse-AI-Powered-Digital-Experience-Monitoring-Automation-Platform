import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { AuditLog } from '../models/index.js';
import { asyncHandler } from '../utils/errors.js';
import { escapeRegex, paginate, paginationSchema } from '../utils/pagination.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  validate({
    query: {
      ...paginationSchema,
      entityType: z.string().max(40).optional(),
      entityId: z.string().max(64).optional(),
      action: z.string().max(60).optional(),
      search: z.string().trim().max(100).optional(),
    },
  }),
  asyncHandler(async (req, res) => {
    const { entityType, entityId, action, search, page, limit } = req.valid.query;
    const filter = {};
    if (entityType) filter.entityType = entityType;
    if (entityId) filter.entityId = entityId;
    if (action) filter.action = new RegExp(`^${escapeRegex(action)}`);
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ action: rx }, { actorName: rx }, { entityId: rx }];
    }
    res.json(await paginate(AuditLog, filter, { page, limit, sort: { timestamp: -1 } }));
  })
);

export default router;
