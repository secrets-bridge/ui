import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';

import { queryClient } from './api/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { StepUpModalProvider } from './auth/StepUpModal';
import { Shell } from './layout/Shell';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Agents } from './pages/Agents';
import { Audit } from './pages/Audit';
import { Dashboard } from './pages/Dashboard';
import { Inbox } from './pages/Inbox';
import { InboxFill } from './pages/InboxFill';
import { Login } from './pages/Login';
import { Me } from './pages/Me';
import { MFASettings } from './pages/MFASettings';
import { MyProjects } from './pages/MyProjects';
import { ProjectEnv } from './pages/ProjectEnv';
import { ProjectPolicies } from './pages/ProjectPolicies';
import { ProjectPoliciesPicker } from './pages/ProjectPoliciesPicker';
import { RequestDetail } from './pages/RequestDetail';
import { Requests } from './pages/Requests';
import { RevealSession } from './pages/RevealSession';
import { Secrets } from './pages/Secrets';
import { Assignments } from './pages/admin/Assignments';
import { Integrations } from './pages/admin/Integrations';
import { PlatformSettings } from './pages/admin/PlatformSettings';
import { Policies } from './pages/admin/Policies';
import { Projects } from './pages/admin/Projects';
import { ProviderConnections } from './pages/admin/ProviderConnections';
import { Roles } from './pages/admin/Roles';
import { Teams } from './pages/admin/Teams';
import { Workflows } from './pages/admin/Workflows';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ErrorBoundary>
        <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <StepUpModalProvider>
                <Shell />
              </StepUpModalProvider>
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
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
          <Route
            path="/projects/:id/env/:env_id/reveal/:request_id"
            element={<RevealSession />}
          />
          <Route path="/admin/projects" element={<Projects />} />
          <Route path="/admin/teams" element={<Teams />} />
          <Route path="/admin/roles" element={<Roles />} />
          <Route path="/admin/assignments" element={<Assignments />} />
          <Route path="/admin/workflows" element={<Workflows />} />
          <Route path="/admin/policies" element={<Policies />} />
          <Route path="/admin/platform-settings" element={<PlatformSettings />} />
          <Route path="/admin/provider-connections" element={<ProviderConnections />} />
          <Route path="/admin/integrations" element={<Integrations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        </Routes>
        </ErrorBoundary>
      </AuthProvider>
    </QueryClientProvider>
  );
}
