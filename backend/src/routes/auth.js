import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, signToken, userFromToken } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { ROLES, User } from '../models/index.js';
import { audit } from '../services/auditService.js';
import { asyncHandler, conflict, forbidden, unauthorized } from '../utils/errors.js';

const router = Router();

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(200),
  password,
  role: z.enum(ROLES).optional(),
});

/**
 * Create a user. The very first user may self-register and becomes an admin (bootstrap);
 * afterwards only authenticated admins can create accounts.
 */
router.post(
  '/register',
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const userCount = await User.estimatedDocumentCount();
    let actor = null;
    if (userCount > 0) {
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      actor = token ? await userFromToken(token) : null;
      if (!actor) throw unauthorized('Only administrators can create users');
      if (actor.role !== 'admin') throw forbidden('Only administrators can create users');
    }
    const { name, email, password: pw, role } = req.valid.body;
    if (await User.exists({ email })) throw conflict('A user with this email already exists');
    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(pw, 10),
      role: userCount === 0 ? 'admin' : role || 'technician',
    });
    await audit({ actor: actor || user, action: 'user.created', entityType: 'user', entityId: user._id, details: { email, role: user.role }, ip: req.ip });
    res.status(201).json({ user: user.toSafeJSON() });
  })
);

router.post(
  '/login',
  loginLimiter,
  validate({ body: { email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(128) } }),
  asyncHandler(async (req, res) => {
    const { email, password: pw } = req.valid.body;
    const user = await User.findOne({ email }).select('+passwordHash');
    const ok = user && user.active && (await bcrypt.compare(pw, user.passwordHash));
    if (!ok) {
      await audit({ action: 'auth.login_failed', entityType: 'user', details: { email }, ip: req.ip });
      throw unauthorized('Invalid email or password');
    }
    user.lastLoginAt = new Date();
    await user.save();
    await audit({ actor: user, action: 'auth.login', entityType: 'user', entityId: user._id, ip: req.ip });
    res.json({ token: signToken(user), user: user.toSafeJSON() });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    res.json({ user: user.toSafeJSON() });
  })
);

router.patch(
  '/me',
  requireAuth,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(100).optional(),
      preferences: z.object({ theme: z.enum(['light', 'dark', 'system']) }).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (req.valid.body.name) user.name = req.valid.body.name;
    if (req.valid.body.preferences) user.preferences = req.valid.body.preferences;
    await user.save();
    res.json({ user: user.toSafeJSON() });
  })
);

router.get(
  '/users',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const users = await User.find({ active: true }).select('name email role').sort({ name: 1 }).lean();
    res.json({ data: users.map((u) => ({ id: u._id, name: u.name, email: u.email, role: u.role })) });
  })
);

export default router;
