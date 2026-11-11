import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { LoadingBlock } from './components/ui/States';
import { useAuth } from './context/AuthContext';
import { RealtimeProvider } from './context/RealtimeContext';
import LoginPage from './pages/LoginPage';

const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const AutomationPage = lazy(() => import('./pages/AutomationPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const DeviceDetailPage = lazy(() => import('./pages/DeviceDetailPage'));
const DevicesPage = lazy(() => import('./pages/DevicesPage'));
const IncidentDetailPage = lazy(() => import('./pages/IncidentDetailPage'));
const IncidentsPage = lazy(() => import('./pages/IncidentsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const SimulationPage = lazy(() => import('./pages/SimulationPage'));

function RequireAuth({ children }) {
  const { token, user, initializing } = useAuth();
  const location = useLocation();
  if (!token) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (initializing || !user) return <LoadingBlock label="Restoring your session…" className="h-full" />;
  return (
    <RealtimeProvider>
      <Suspense fallback={<LoadingBlock />}>{children}</Suspense>
    </RealtimeProvider>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="devices/:id" element={<DeviceDetailPage />} />
        <Route path="incidents" element={<IncidentsPage />} />
        <Route path="incidents/:id" element={<IncidentDetailPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="simulation" element={<SimulationPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
