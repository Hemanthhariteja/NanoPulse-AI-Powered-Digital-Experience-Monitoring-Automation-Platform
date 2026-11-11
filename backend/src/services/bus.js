import { EventEmitter } from 'node:events';

/**
 * In-process event bus used to decouple services (e.g. remediationService → simulator)
 * without circular imports. Realtime browser events go through services/realtime.js.
 */
export const bus = new EventEmitter();
bus.setMaxListeners(50);
