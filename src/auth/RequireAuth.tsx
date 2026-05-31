import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from './AuthContext';

/**
 * Route guard — gates children behind `meStatus`.
 *
 * Critical: must NOT redirect while `meStatus === 'loading'`.
 * After the OIDC callback, the browser lands on a protected route
 * (typically '/') with the session cookie already set, but
 * `useMe()` hasn't resolved yet. If we redirect on null identity
 * during that window, the user bounces to /login even though they
 * are authenticated — which is exactly the post-SSO regression the
 * UAT pilot caught.
 *
 * State machine:
 *   - loading → render a placeholder so the URL stays on the
 *               protected route; once /users/me resolves the next
 *               render flips to either 'ready' or 'idle'.
 *   - ready   → render children.
 *   - idle    → genuinely unauthenticated, redirect to /login.
 *   - error   → also redirect; the Login page surfaces the retry.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { identity, meStatus } = useAuth();
  const location = useLocation();

  if (meStatus === 'loading') {
    return <AuthHydratingFallback />;
  }
  if (!identity) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
}

function AuthHydratingFallback() {
  return (
    <div className="h-full flex items-center justify-center bg-bg">
      <div className="text-muted text-sm">Loading session…</div>
    </div>
  );
}
