import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ANALYTICS_RANGES, deviceHealth, incidentAnalytics, overview, remediationAnalytics } from '../services/analyticsService.js';
import { asyncHandler } from '../utils/errors.js';
import { rangeQuery } from './schemas.js';

const router = Router();
router.use(requireAuth);
const range = validate({ query: rangeQuery(ANALYTICS_RANGES) });

router.get('/overview', asyncHandler(async (_req, res) => res.json(await overview())));
router.get('/device-health', range, asyncHandler(async (req, res) => res.json(await deviceHealth(req.valid.query.range))));
router.get('/incidents', range, asyncHandler(async (req, res) => res.json(await incidentAnalytics(req.valid.query.range))));
router.get('/remediation', range, asyncHandler(async (req, res) => res.json(await remediationAnalytics(req.valid.query.range))));

export default router;
