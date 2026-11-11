import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { signToken } from '../src/middleware/auth.js';
import { User } from '../src/models/index.js';
import { clearSettingsCache, getSettingsInternal } from '../src/services/settingsService.js';

export const app = createApp();
export const api = () => request(app);

export async function connect() {
  if (!process.env.MONGO_URI.includes('test')) throw new Error('Refusing to run tests against a non-test database');
  if (mongoose.connection.readyState !== 1) await mongoose.connect(process.env.MONGO_URI);
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

export async function reset() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
  clearSettingsCache();
}

export async function disconnect() {
  await mongoose.disconnect();
}

export async function createUser(role = 'admin', email = `${role}-${Date.now()}-${Math.random()}@test.local`) {
  const user = await User.create({ name: `Test ${role}`, email, passwordHash: await bcrypt.hash('Password1', 4), role });
  return { user, token: signToken(user), auth: { Authorization: `Bearer ${signToken(user)}` } };
}

export async function enrollmentKey() {
  return (await getSettingsInternal()).enrollmentKey;
}

export async function registerAgent(overrides = {}) {
  const res = await api()
    .post('/api/devices/register')
    .send({ enrollmentKey: await enrollmentKey(), hostname: 'TEST-PC', operatingSystem: 'Windows 11', ...overrides });
  if (res.status >= 300) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return {
    ...res.body,
    headers: { 'X-Device-Id': res.body.deviceId, 'X-Device-Secret': res.body.deviceSecret },
  };
}

export const sample = (overrides = {}) => ({
  cpuUsage: 20,
  ramUsage: 40,
  diskUsage: 50,
  networkUpload: 1000,
  networkDownload: 5000,
  networkConnected: true,
  uptimeSeconds: 3600,
  processes: [
    { pid: 10, name: 'explorer.exe', cpuPercent: 2, memoryPercent: 3 },
    { pid: 20, name: 'chrome.exe', cpuPercent: 5, memoryPercent: 8 },
  ],
  ...overrides,
});

export async function sendTelemetry(agent, overrides = {}) {
  return api().post('/api/telemetry').set(agent.headers).send(sample(overrides));
}
