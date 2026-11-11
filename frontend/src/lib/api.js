import axios from 'axios';

// Dev: the API runs separately on :5000. Production build: the backend serves this app, so use the same origin.
export const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? '/api' : 'http://localhost:5000/api');
export const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || new URL(API_URL, window.location.origin).origin;

const TOKEN_KEY = 'np-token';

export const tokenStore = {
  get: () => {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set: (t) => {
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      /* storage unavailable: session lasts until reload */
    }
  },
  clear: () => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export const api = axios.create({ baseURL: API_URL, timeout: 15000 });

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('np:unauthorized'));
    }
    return Promise.reject(error);
  }
);

/** Human-readable message from an API/network error. */
export function errorMessage(error, fallback = 'Something went wrong') {
  if (!error) return fallback;
  if (error.response?.data?.error?.message) return error.response.data.error.message;
  if (error.code === 'ECONNABORTED') return 'The server took too long to respond';
  if (error.message === 'Network Error' || !error.response) return 'Cannot reach the NanoPulse server. Check that the backend is running.';
  return error.message || fallback;
}
