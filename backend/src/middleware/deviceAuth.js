import { Device } from '../models/index.js';
import { sha256, safeEqualHex } from '../utils/crypto.js';
import { asyncHandler, unauthorized } from '../utils/errors.js';

/** Authenticates a monitoring agent by its device id + secret issued at registration. */
export const requireDevice = asyncHandler(async (req, _res, next) => {
  const deviceId = req.get('X-Device-Id');
  const secret = req.get('X-Device-Secret');
  if (!deviceId || !secret || deviceId.length > 64 || secret.length > 128) {
    throw unauthorized('Device credentials required');
  }
  const device = await Device.findOne({ deviceId }).select('+secretHash');
  if (!device || !safeEqualHex(device.secretHash, sha256(secret))) {
    throw unauthorized('Invalid device credentials');
  }
  req.device = device;
  next();
});
