import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } });

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.rateLimitPerMinute,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip: () => env.isTest,
});

export const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.loginRateLimitPer15Min,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skipSuccessfulRequests: true,
  skip: () => env.isTest && !process.env.TEST_RATE_LIMIT,
});

export const registerDeviceLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
  skip: () => env.isTest,
});
