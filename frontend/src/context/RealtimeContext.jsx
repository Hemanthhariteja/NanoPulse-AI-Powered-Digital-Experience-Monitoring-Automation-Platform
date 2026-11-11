import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../lib/api';
import { useAuth } from './AuthContext';

const RealtimeContext = createContext(null);

/**
 * One Socket.IO connection per session. Pages subscribe to individual events and patch
 * their own state, so a metric change never reloads a whole page. After a reconnect a
 * synthetic "resync" event tells subscribers to refetch what they may have missed.
 */
export function RealtimeProvider({ children }) {
  const { token, logout } = useAuth();
  const [status, setStatus] = useState('disconnected');
  const listeners = useRef(new Map());
  const socketRef = useRef(null);

  const dispatch = useCallback((event, payload) => {
    listeners.current.get(event)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`Realtime handler for ${event} failed`, err);
      }
    });
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    socketRef.current = socket;
    setStatus('connecting');
    let wasConnected = false;

    socket.on('connect', () => {
      setStatus('connected');
      if (wasConnected) dispatch('resync');
      wasConnected = true;
    });
    socket.on('disconnect', () => setStatus('reconnecting'));
    socket.on('connect_error', (err) => {
      if (err.message === 'unauthorized') logout();
      setStatus('reconnecting');
    });
    socket.onAny((event, payload) => dispatch(event, payload));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      setStatus('disconnected');
    };
  }, [token, logout, dispatch]);

  const subscribe = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(fn);
    return () => listeners.current.get(event)?.delete(fn);
  }, []);

  const value = useMemo(() => ({ status, subscribe }), [status, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeStatus() {
  return useContext(RealtimeContext)?.status ?? 'disconnected';
}

/** Subscribe to one or more realtime events; the handler always sees fresh props/state. */
export function useRealtime(events, handler) {
  const ctx = useContext(RealtimeContext);
  const ref = useRef(handler);
  ref.current = handler;
  const key = Array.isArray(events) ? events.join('|') : events;
  useEffect(() => {
    if (!ctx) return undefined;
    const names = key.split('|');
    const offs = names.map((name) => ctx.subscribe(name, (payload) => ref.current(payload, name)));
    return () => offs.forEach((off) => off());
  }, [ctx, key]);
}
