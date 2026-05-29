import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';

import { queryClient } from './api/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Shell } from './layout/Shell';
import { Agents } from './pages/Agents';
import { Audit } from './pages/Audit';
import { Dashboard } from './pages/Dashboard';
import { LoginStub } from './pages/LoginStub';
import { Placeholder } from './pages/Placeholder';
import { RequestDetail } from './pages/RequestDetail';
import { Requests } from './pages/Requests';
import { Assignments } from './pages/admin/Assignments';
import { Integrations } from './pages/admin/Integrations';
import { Policies } from './pages/admin/Policies';
import { Projects } from './pages/admin/Projects';
import { Roles } from './pages/admin/Roles';
import { Workflows } from './pages/admin/Workflows';

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Routes>
        <Route path="/login" element={<LoginStub />} />
        <Route
          element={
            <RequireAuth>
              <Shell />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/requests/:id" element={<RequestDetail />} />
          <Route
            path="/secrets"
            element={<Placeholder title="Discovered Secrets" note="Search by cluster / provider / labels." />}
          />
          <Route path="/audit" element={<Audit />} />
          <Route path="/admin/projects" element={<Projects />} />
          <Route path="/admin/roles" element={<Roles />} />
          <Route path="/admin/assignments" element={<Assignments />} />
          <Route path="/admin/workflows" element={<Workflows />} />
          <Route path="/admin/policies" element={<Policies />} />
          <Route path="/admin/integrations" element={<Integrations />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  );
}
