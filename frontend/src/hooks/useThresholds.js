import { useEffect, useState } from 'react';
import { api } from '../lib/api';

export const DEFAULT_THRESHOLDS = { cpuWarning: 70, cpuCritical: 85, ramWarning: 75, ramCritical: 90, diskWarning: 80, diskCritical: 90 };

let cached = null;
let inflight = null;
const subscribers = new Set();

export function invalidateThresholds(next) {
  cached = next || null;
  subscribers.forEach((fn) => fn(cached || DEFAULT_THRESHOLDS));
}

/** Configured monitoring thresholds (shared, fetched once per session). */
export function useThresholds() {
  const [t, setT] = useState(cached || DEFAULT_THRESHOLDS);
  useEffect(() => {
    subscribers.add(setT);
    if (!cached) {
      inflight =
        inflight ||
        api
          .get('/settings')
          .then((r) => (cached = r.data.thresholds))
          .catch(() => DEFAULT_THRESHOLDS)
          .finally(() => (inflight = null));
      inflight.then((v) => setT(v || DEFAULT_THRESHOLDS));
    }
    return () => subscribers.delete(setT);
  }, []);
  return t;
}
