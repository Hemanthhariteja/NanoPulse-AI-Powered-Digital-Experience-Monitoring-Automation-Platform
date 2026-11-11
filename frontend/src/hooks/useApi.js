import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../lib/api';

/**
 * Fetch JSON from the API with loading / error state.
 * `path` may be null to skip fetching. `refetch({ silent: true })` refreshes without
 * flipping back to the loading state (used for realtime-triggered refreshes).
 */
export function useApi(path, { params, keepPrevious = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(path));
  const requestId = useRef(0);
  const paramsKey = JSON.stringify(params ?? {});

  const load = useCallback(
    async ({ silent = false } = {}) => {
      if (!path) return;
      const id = ++requestId.current;
      if (!silent) setLoading(true);
      try {
        const res = await api.get(path, { params: JSON.parse(paramsKey) });
        if (id === requestId.current) {
          setData(res.data);
          setError(null);
        }
      } catch (err) {
        if (id === requestId.current) setError(errorMessage(err));
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [path, paramsKey]
  );

  useEffect(() => {
    if (!keepPrevious) setData(null);
    load();
  }, [load, keepPrevious]);

  return { data, error, loading, refetch: load, setData };
}

/** Debounced callback: collapses bursts of realtime events into one refresh. */
export function useDebouncedCallback(fn, delay = 800) {
  const timer = useRef(null);
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(
    (...args) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), delay);
    },
    [delay]
  );
}

export function useDebouncedValue(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Re-render periodically so relative timestamps ("12s ago") stay current. */
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
