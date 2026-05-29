/**
 * Auth context — currently a STUB until api P0-1 (real OIDC) lands.
 *
 * Hard rules respected even in the stub:
 * - Token MUST live in memory only. NEVER localStorage / sessionStorage.
 *   (Per BRD §15 Frontend boundary.)
 * - The provider exposes `login(identity)` for the stub login page; the
 *   real OIDC implementation will swap this for the PKCE-callback path
 *   without changing the consumer-side API of the context.
 * - When the page reloads, the user is signed out (memory-only token).
 *   The real OIDC implementation will use a short-lived in-memory access
 *   token + a server-side session cookie (HttpOnly + Secure + SameSite=Lax)
 *   to handle reload. NEVER a JWT in localStorage.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { setAuthTokenProvider } from '../api/client';

export interface Identity {
  id: string;
  email: string;
  display_name: string;
  // Permission strings — the real RBAC enforcement lands with api
  // P0-2; today the stub fills in admin so every page is reachable
  // during scaffold review.
  permissions: string[];
}

interface AuthState {
  identity: Identity | null;
  // The stub uses a fake bearer token so the API client wires the
  // Authorization header consistently. Real OIDC will issue a short-
  // lived access token here.
  token: string | null;
  login: (i: Identity, token: string) => void;
  logout: () => void;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Wire the token into the API client so `Authorization: Bearer ...`
  // gets attached automatically. Token lookup is a function so the
  // client stays decoupled from React state mechanics.
  useEffect(() => {
    setAuthTokenProvider(() => token);
  }, [token]);

  const login = useCallback((i: Identity, t: string) => {
    setIdentity(i);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    setIdentity(null);
    setToken(null);
  }, []);

  const value = useMemo<AuthState>(() => ({ identity, token, login, logout }), [identity, token, login, logout]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
