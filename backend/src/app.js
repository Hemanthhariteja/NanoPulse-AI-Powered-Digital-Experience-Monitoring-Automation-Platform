import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import helmet from 'helmet';
import mongoose from 'mongoose';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { sanitizeInput } from './middleware/sanitize.js';
import agentRoutes from './routes/agent.js';
import analyticsRoutes from './routes/analytics.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import deviceRoutes from './routes/devices.js';
import incidentRoutes from './routes/incidents.js';
import remediationRoutes from './routes/remediations.js';
import settingsRoutes from './routes/settings.js';
import simulationRoutes from './routes/simulation.js';
import telemetryRoutes from './routes/telemetry.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        // Agents and server-to-server calls send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(null, false);
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(sanitizeInput);
  if (!env.isTest) app.use(morgan(env.isProduction ? 'combined' : 'dev', { skip: (req) => req.path === '/api/health' }));

  app.get('/api/health', (_req, res) => {
    const db = mongoose.connection.readyState === 1 ? 'up' : 'down';
    res.status(db === 'up' ? 200 : 503).json({ status: db === 'up' ? 'ok' : 'degraded', db, time: new Date() });
  });

  app.use('/api', apiLimiter);
  app.use('/api/auth', authRoutes);
  app.use('/api/devices', deviceRoutes);
  app.use('/api/telemetry', telemetryRoutes);
  app.use('/api/agent', agentRoutes);
  app.use('/api/incidents', incidentRoutes);
  app.use('/api/remediations', remediationRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/simulation', simulationRoutes);
  app.use('/api/audit', auditRoutes);

  // Single-service deployment: serve the built React dashboard (frontend/dist) from the same origin.
  const distDir = process.env.FRONTEND_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
  if (fs.existsSync(path.join(distDir, 'index.html'))) {
    app.use(express.static(distDir, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/|socket\.io\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
