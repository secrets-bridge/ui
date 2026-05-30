/**
 * Auth context — currently a STUB until api P0-1 (real OIDC) lands.
 *
 * Hard rules:
 * - Token MUST NEVER live in localStorage. localStorage persists to
 *   disk across browser restarts and is read by every script on the
 *   origin including extensions — exactly what a long-lived bearer
 *   token should not touch. (Per BRD §15 Frontend boundary.)
 *
 * - sessionStorage IS acceptable as a stopgap for the page-reload UX:
 *     · same-tab only (a new tab is a fresh session)
 *     · cleared on tab close
 *     · isolated per origin
 *   This trades a small additional risk window (a script running on
 *   the same origin DURING the session can read it) for not signing
 *   the user out on every refresh. Once api P0-1 ships, we'll swap
 *   to in-memory access token + HttpOnly refresh cookie and drop the
 *   sessionStorage path.
 *
 * - The provider exposes `login(identity)` for the stub login page;
 *   the real OIDC implementation will swap this for the PKCE-callback
 *   path without changing the consumer-side API of the context.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { setAuthTokenProvider, setIdentityProvider } from '../api/client';

// sessionStorage keys. Namespaced so other tools / future tenants
// don't collide.
const SS_TOKEN = 'sb:auth:token';
const SS_IDENTITY = 'sb:auth:identity';

// Reads + parses the stored session. Returns null if absent or
// corrupted. Storage access is wrapped in try/catch because in some
// hardened browser configs (Safari private, locked-down profiles)
// sessionStorage throws on read.
function loadSession(): { token: string; identity: Identity } | null {
  try {
    const t = sessionStorage.getItem(SS_TOKEN);
    const raw = sessionStorage.getItem(SS_IDENTITY);
    if (!t || !raw) return null;
    const identity = JSON.parse(raw) as Identity;
    if (!identity || typeof identity.id !== 'string') return null;
    return { token: t, identity };
  } catch {
    return null;
  }
}

function persistSession(token: string, identity: Identity) {
  try {
    sessionStorage.setItem(SS_TOKEN, token);
    sessionStorage.setItem(SS_IDENTITY, JSON.stringify(identity));
  } catch {
    // Storage quota / disabled / private-mode — degrade to memory-only.
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SS_TOKEN);
    sessionStorage.removeItem(SS_IDENTITY);
  } catch {
    // best-effort
  }
}

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
  // Hydrate from sessionStorage on first render so a page reload
  // keeps the user signed in. Storage is cleared on tab close.
  const initial = loadSession();
  const [identity, setIdentity] = useState<Identity | null>(initial?.identity ?? null);
  const [token, setToken] = useState<string | null>(initial?.token ?? null);

  // Wire the token into the API client so `Authorization: Bearer ...`
  // gets attached automatically. Token lookup is a function so the
  // client stays decoupled from React state mechanics.
  useEffect(() => {
    setAuthTokenProvider(() => token);
  }, [token]);

  useEffect(() => {
    setIdentityProvider(() => (identity ? identity.id : null));
  }, [identity]);

  const login = useCallback((i: Identity, t: string) => {
    setIdentity(i);
    setToken(t);
    persistSession(t, i);
  }, []);

  const logout = useCallback(() => {
    setIdentity(null);
    setToken(null);
    clearSession();
  }, []);

  const value = useMemo<AuthState>(() => ({ identity, token, login, logout }), [identity, token, login, logout]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
