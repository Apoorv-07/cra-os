import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { AppShell } from './components/layout';
import { Spinner } from './components/ui';
import { ErrorBoundary } from './components/errors';

/**
 * Every screen is loaded on demand.
 *
 * The marketing site and the product share one bundle otherwise, which makes
 * the first impression — the page a prospect loads before they have an account
 * — pay for the entire authenticated application. Splitting at the route is the
 * cheapest performance win available and costs nothing in complexity.
 */

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const PricingPage = lazy(() => import('./pages/Pricing').then((m) => ({ default: m.PricingPage })));
const LegalPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.LegalPage })));
const Login = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Login })));
const Signup = lazy(() => import('./pages/Auth').then((m) => ({ default: m.Signup })));
const Onboarding = lazy(() => import('./pages/Onboarding').then((m) => ({ default: m.Onboarding })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Repositories = lazy(() => import('./pages/Repositories').then((m) => ({ default: m.Repositories })));
const RepositoryDetail = lazy(() => import('./pages/RepositoryDetail').then((m) => ({ default: m.RepositoryDetail })));
const ReadinessPage = lazy(() => import('./pages/Readiness').then((m) => ({ default: m.ReadinessPage })));
const Findings = lazy(() => import('./pages/Findings').then((m) => ({ default: m.Findings })));
const EvidenceVault = lazy(() => import('./pages/Evidence').then((m) => ({ default: m.EvidenceVault })));
const Incidents = lazy(() => import('./pages/Incidents').then((m) => ({ default: m.Incidents })));
const IncidentDetail = lazy(() => import('./pages/IncidentDetail').then((m) => ({ default: m.IncidentDetail })));
const Reports = lazy(() => import('./pages/Reports').then((m) => ({ default: m.Reports })));
const Billing = lazy(() => import('./pages/Billing').then((m) => ({ default: m.Billing })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const AdminConsole = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminConsole })));
const ShareReport = lazy(() => import('./pages/ShareReport').then((m) => ({ default: m.ShareReport })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));
const Guide = lazy(() => import('./pages/Guide'));

function RouteFallback() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Spinner size={20} />
    </div>
  );
}

/** Blocks app routes until the session resolves, then redirects if absent. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { ready, user } = useAuth();
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner size={20} />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/**
 * Every app route gets its own error boundary, so a failure in one screen
 * never takes the whole product down with it.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>
        <ErrorBoundary>{children}</ErrorBoundary>
      </AppShell>
    </RequireAuth>
  );
}

/** Public routes get the boundary but not the shell. */
function Public({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}

export function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public marketing */}
        <Route
          path="/"
          element={
            <Public>
              <Home />
            </Public>
          }
        />
        <Route
          path="/pricing"
          element={
            <Public>
              <PricingPage />
            </Public>
          }
        />
        <Route
          path="/legal/:page"
          element={
            <Public>
              <LegalPage />
            </Public>
          }
        />
        {/* Long-form CRA reference content. Public and indexable. */}
        <Route
          path="/guides/:slug"
          element={
            <Public>
              <Guide />
            </Public>
          }
        />
        <Route
          path="/guides"
          element={
            <Public>
              <Guide />
            </Public>
          }
        />
        <Route
          path="/share/:token"
          element={
            <Public>
              <ShareReport />
            </Public>
          }
        />

        {/* Auth */}
        <Route
          path="/login"
          element={
            <Public>
              <Login />
            </Public>
          }
        />
        <Route
          path="/signup"
          element={
            <Public>
              <Signup />
            </Public>
          }
        />

        {/* Product */}
        <Route path="/app" element={<Shell><Dashboard /></Shell>} />
        <Route path="/app/onboarding" element={<Shell><Onboarding /></Shell>} />
        <Route path="/app/repositories" element={<Shell><Repositories /></Shell>} />
        <Route path="/app/repositories/:repositoryId" element={<Shell><RepositoryDetailRoute /></Shell>} />
        <Route path="/app/compliance" element={<Shell><ReadinessPage /></Shell>} />
        <Route path="/app/compliance/:repositoryId" element={<Shell><ReadinessPage /></Shell>} />
        {/* Kept for bookmarks and links sent before the navigation was renamed. */}
        <Route path="/app/readiness" element={<Navigate to="/app/compliance" replace />} />
        <Route path="/app/readiness/:repositoryId" element={<ReadinessRedirect />} />
        <Route path="/app/findings" element={<Shell><Findings /></Shell>} />
        <Route path="/app/evidence" element={<Shell><EvidenceVault /></Shell>} />
        <Route path="/app/incidents" element={<Shell><Incidents /></Shell>} />
        <Route path="/app/incidents/:incidentId" element={<Shell><IncidentDetailRoute /></Shell>} />
        <Route path="/app/reports" element={<Shell><Reports /></Shell>} />
        <Route path="/app/billing" element={<Shell><Billing /></Shell>} />
        <Route path="/app/settings" element={<Shell><Settings /></Shell>} />
        <Route path="/app/admin" element={<Shell><AdminConsole /></Shell>} />

        <Route
          path="*"
          element={
            <Public>
              <NotFound />
            </Public>
          }
        />
      </Routes>
    </Suspense>
  );
}

/** Thin wrappers so route params are typed at the page boundary. */
function RepositoryDetailRoute() {
  const { repositoryId } = useParams();
  return <RepositoryDetail repositoryId={repositoryId!} />;
}

function IncidentDetailRoute() {
  const { incidentId } = useParams();
  return <IncidentDetail incidentId={incidentId!} />;
}

function ReadinessRedirect() {
  const { repositoryId } = useParams();
  return <Navigate to={`/app/compliance/${repositoryId}`} replace />;
}
