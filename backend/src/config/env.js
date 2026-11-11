import 'dotenv/config';

function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${name} must be an integer`);
  return n;
}

const nodeEnv = process.env.NODE_ENV || 'development';

export const env = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  isProduction: nodeEnv === 'production',
  port: int('PORT', 5000),
  mongoUri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/nanopulse',
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  telemetryRetentionDays: int('TELEMETRY_RETENTION_DAYS', 7),
  remediationGraceSeconds: int('REMEDIATION_GRACE_SECONDS', 30),
  sweepIntervalMs: int('SWEEP_INTERVAL_MS', 5000),
  simulatorIntervalMs: int('SIMULATOR_INTERVAL_MS', 5000),
  rateLimitPerMinute: int('RATE_LIMIT_PER_MINUTE', 600),
  loginRateLimitPer15Min: int('LOGIN_RATE_LIMIT_PER_15_MIN', 20),
};

export function assertEnv() {
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    throw new Error(
      'JWT_SECRET is missing or shorter than 32 characters. Copy backend/.env.example to backend/.env and set a strong secret.'
    );
  }
}
