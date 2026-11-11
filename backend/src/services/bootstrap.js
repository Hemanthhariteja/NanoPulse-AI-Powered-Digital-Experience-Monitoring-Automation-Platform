import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { getSettingsInternal } from './settingsService.js';

/**
 * Create the seed accounts from SEED_* environment variables if they do not exist yet.
 * Lets hosted deployments without shell access (e.g. Render free tier) start with a usable admin.
 */
export async function ensureSeedUsers() {
  const accounts = [
    ['IT Administrator', process.env.SEED_ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD, 'admin'],
    ['Field Technician', process.env.SEED_TECH_EMAIL, process.env.SEED_TECH_PASSWORD, 'technician'],
  ];
  for (const [name, email, password, role] of accounts) {
    if (!email || !password) continue;
    if (await User.exists({ email: email.toLowerCase() })) continue;
    if (password.length < 8) {
      logger.warn(`Skipping seed ${role} ${email}: password must be at least 8 characters`);
      continue;
    }
    await User.create({ name, email, passwordHash: await bcrypt.hash(password, 10), role });
    logger.info(`Created seed ${role} account ${email}`);
  }
  await getSettingsInternal(); // ensures settings + enrollment key exist
}
