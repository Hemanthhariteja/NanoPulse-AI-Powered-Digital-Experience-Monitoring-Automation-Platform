/**
 * Creates the initial admin and technician accounts from environment variables.
 * Safe to run repeatedly: existing users are left untouched.
 *
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   SEED_TECH_EMAIL  / SEED_TECH_PASSWORD   (optional)
 */
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { getSettingsInternal } from '../services/settingsService.js';

async function upsertUser(name, email, password, role) {
  if (!email || !password) return;
  if (await User.exists({ email: email.toLowerCase() })) {
    console.log(`= ${role.padEnd(10)} ${email} already exists`);
    return;
  }
  await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), role });
  console.log(`+ ${role.padEnd(10)} ${email} created`);
}

async function main() {
  await connectDb(env.mongoUri);
  if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) {
    throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in backend/.env');
  }
  await upsertUser('IT Administrator', process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, 'admin');
  await upsertUser('Field Technician', process.env.SEED_TECH_EMAIL, process.env.SEED_TECH_PASSWORD, 'technician');
  const settings = await getSettingsInternal();
  console.log(`Settings initialised. Agent enrollment key: ${settings.enrollmentKey}`);
  await disconnectDb();
}

main().catch(async (err) => {
  console.error(err.message);
  await disconnectDb().catch(() => {});
  process.exit(1);
});
