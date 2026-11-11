import { Server } from 'socket.io';
import { userFromToken } from '../middleware/auth.js';
import { logger } from '../utils/logger.js';

let io = null;

export function initRealtime(httpServer, { corsOrigins }) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    pingInterval: 20000,
    pingTimeout: 20000,
  });

  io.use(async (socket, next) => {
    try {
      const user = await userFromToken(socket.handshake.auth?.token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch (err) {
      next(err);
    }
  });

  io.on('connection', (socket) => {
    socket.join('dashboard');
    logger.debug(`Socket connected: ${socket.data.user.email}`);
    socket.on('disconnect', (reason) => logger.debug(`Socket disconnected (${reason})`));
  });

  return io;
}

/** Broadcast an event to every authenticated dashboard client. No-op when realtime is not running (tests). */
export function emit(event, payload) {
  if (io) io.to('dashboard').emit(event, payload);
}

export function closeRealtime() {
  if (io) io.close();
  io = null;
}
