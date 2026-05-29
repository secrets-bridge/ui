import { QueryClientProvider } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';

import { queryClient } from './api/queryClient';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth } from './auth/RequireAuth';
import { Shell } from './layout/Shell';
import { Agents } from './pages/Agents';
import { LoginStub } from './pages/LoginStub';
import { Placeholder } from './pages/Placeholder';
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
          <Route path="/" element={<Navigate to="/agents" replace />} />
          <Route path="/agents" element={<Agents />} />
          <Route
            path="/requests"
            element={<Placeholder title="Requests" note="Submit + approve / reject patch and read requests." />}
          />
          <Route
            path="/secrets"
            element={<Placeholder title="Discovered Secrets" note="Search by cluster / provider / labels." />}
          />
          <Route
            path="/audit"
            element={<Placeholder title="Audit Log" note="Filter by actor / action / resource / correlation_id." />}
          />
          <Route
            path="/admin/roles"
            element={<Placeholder title="Roles" note="Dynamic permission bundles." />}
          />
          <Route path="/admin/workflows" element={<Workflows />} />
          <Route
            path="/admin/policies"
            element={<Placeholder title="Policies" note="Selectors that map request scope to workflow." />}
          />
          <Route
            path="/admin/integrations"
            element={
              <Placeholder
                title="Integrations"
                note="ArgoCD endpoints + app mappings (when GitOps observation is enabled)."
              />
            }
          />
          <Route path="*" element={<Navigate to="/agents" replace />} />
        </Route>
        </Routes>
      </AuthProvider>
    </QueryClientProvider>
  );
}
