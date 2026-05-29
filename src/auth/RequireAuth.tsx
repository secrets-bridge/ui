import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from './AuthContext';

/**
 * Route guard — redirects to /login if no identity is loaded yet.
 * Once api P0-1 lands, this layer becomes the OIDC-handshake gate.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { identity } = useAuth();
  const location = useLocation();
  if (!identity) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}
