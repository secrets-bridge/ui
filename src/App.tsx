import { QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';

import { queryClient } from './api/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { StepUpModalProvider } from './auth/StepUpModal';
import { Shell } from './layout/Shell';
import { ScopeProvider } from './requests/ScopeProvider';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { ToastProvider } from './ui/Toast';
import { Agents } from './pages/Agents';
import { Audit } from './pages/Audit';
import { Inbox } from './pages/Inbox';
import { InboxFill } from './pages/InboxFill';
import { Login } from './pages/Login';
import { Pending } from './pages/Pending';
import { Overview } from './pages/Overview';
import { Me } from './pages/Me';
import { MFASettings } from './pages/MFASettings';
import { MyProjects } from './pages/MyProjects';
import { ProjectEnv } from './pages/ProjectEnv';
import { ProjectPolicies } from './pages/ProjectPolicies';
import { ProjectPoliciesPicker } from './pages/ProjectPoliciesPicker';
import { ProjectPolicyDetail } from './pages/ProjectPolicyDetail';
import { TeamPolicies } from './pages/TeamPolicies';
import { TeamPoliciesPicker } from './pages/TeamPoliciesPicker';
import { TeamPolicyDetail } from './pages/TeamPolicyDetail';
import { RequestDetail } from './pages/RequestDetail';
import { Requests } from './pages/Requests';
import { Secrets } from './pages/Secrets';
import { Assignments } from './pages/admin/Assignments';
import { Integrations } from './pages/admin/Integrations';
import { PlatformSettings } from './pages/admin/PlatformSettings';
import { Policies } from './pages/admin/Policies';
import { AdminPolicyDetail } from './pages/admin/PolicyDetail';
import { Projects } from './pages/admin/Projects';
import { ProviderConnections } from './pages/admin/ProviderConnections';
import { Roles } from './pages/admin/Roles';
import { SignIn } from './pages/admin/SignIn';
import { Teams } from './pages/admin/Teams';
import { Users } from './pages/admin/Users';
import { Workflows } from './pages/admin/Workflows';

// Admin-only and rarely opened: loaded on first visit.
const Gateways = lazy(() => import('./pages/admin/Gateways').then((m) => ({ default: m.Gateways })));

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ErrorBoundary>
        <ToastProvider>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/pending" element={<Pending />} />
        <Route
          element={
            <RequireAuth>
              <StepUpModalProvider>
                <ScopeProvider>
                  <Shell />
                </ScopeProvider>
              </StepUpModalProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<Overview />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/requests/:id" element={<RequestDetail />} />
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inbox/:request_id" element={<InboxFill />} />
          <Route path="/secrets" element={<Secrets />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/me" element={<Me />} />
          <Route path="/me/mfa" element={<MFASettings />} />
          <Route path="/projects" element={<MyProjects />} />
          <Route path="/projects/:id/env/:env_id" element={<ProjectEnv />} />
          <Route path="/projects/policies" element={<ProjectPoliciesPicker />} />
          <Route path="/projects/:id/policies" element={<ProjectPolicies />} />
          {/* R-follow-up #5 (api#132) — per-rule Detail page; carries
              the History tab. */}
          <Route path="/projects/:id/policies/:ruleID" element={<ProjectPolicyDetail />} />
          <Route path="/teams/policies" element={<TeamPoliciesPicker />} />
          <Route path="/teams/:id/policies" element={<TeamPolicies />} />
          <Route path="/teams/:id/policies/:ruleID" element={<TeamPolicyDetail />} />
          {/* The reveal moved inline to the request page. Old links land
              there; nothing is revealed until the requester asks. */}
          <Route path="/projects/:id/env/:env_id/reveal/:request_id" element={<RevealRedirect />} />
          <Route path="/admin/projects" element={<Projects />} />
          <Route path="/admin/teams" element={<Teams />} />
          <Route path="/admin/roles" element={<Roles />} />
          <Route path="/admin/assignments" element={<Assignments />} />
          <Route path="/admin/users" element={<Users />} />
          <Route path="/admin/sign-in" element={<SignIn />} />
          <Route path="/admin/workflows" element={<Workflows />} />
          <Route path="/admin/policies" element={<Policies />} />
          <Route path="/admin/policies/:id" element={<AdminPolicyDetail />} />
          <Route path="/admin/platform-settings" element={<PlatformSettings />} />
          <Route path="/admin/provider-connections" element={<ProviderConnections />} />
          <Route path="/admin/integrations" element={<Integrations />} />
          <Route
            path="/admin/gateways"
            element={
              <Suspense fallback={<p className="text-muted">Loading…</p>}>
                <Gateways />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        </Routes>
        </ToastProvider>
        </ErrorBoundary>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RevealRedirect() {
  const { request_id = '' } = useParams<{ request_id: string }>();
  return <Navigate to={`/requests/${request_id}`} replace />;
}
