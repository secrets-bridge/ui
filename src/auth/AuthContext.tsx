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
import { useMe } from '../api/me';
import type { MeResponse } from '../api/types';

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
  // Permission strings — sourced from GET /users/me after login.
  // While the hydration request is in flight, this array is empty
  // and any nav item / button gated by a permission stays hidden
  // (fail-closed). The Login page sets a placeholder identity with
  // the email + a transient `pending` marker; AuthProvider replaces
  // it with the full /users/me payload as soon as it lands.
  permissions: string[];
}

interface AuthState {
  identity: Identity | null;
  // The stub uses a fake bearer token so the API client wires the
  // Authorization header consistently. Real OIDC will issue a short-
  // lived access token here.
  token: string | null;
  // Full /users/me payload — the source of truth for teams +
  // accessible projects. Null while the hydration request is in
  // flight or before the user logs in. The /me profile page reads
  // from here; nav-gate paths use `hasPermission` instead.
  me: MeResponse | null;
  // Status of the post-login /users/me hydration. `idle` = no token
  // yet; `loading` = fetch in flight; `ready` = identity is fully
  // hydrated with real permissions; `error` = fetch failed (token
  // still valid; UI shows a small banner asking the user to retry).
  meStatus: 'idle' | 'loading' | 'ready' | 'error';
  // Convenience predicate the sidebar + buttons use to gate against
  // the live permission set. Returns false until /users/me has
  // landed — strictly fail-closed.
  hasPermission: (perm: string) => boolean;
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

  // /users/me hydration — fires whenever a token is present. The
  // query auto-attaches the Bearer token via setAuthTokenProvider
  // wired above. Disabled when no token (avoid 401 on /login page).
  const meQuery = useMe({ enabled: !!token });

  // When /users/me lands, merge the hydrated permission + display
  // metadata onto the locally-held identity so the rest of the app
  // reads from one place.
  useEffect(() => {
    if (!meQuery.data) return;
    const next: Identity = {
      id: meQuery.data.id,
      email: meQuery.data.email,
      display_name: meQuery.data.display_name || meQuery.data.email,
      permissions: meQuery.data.permissions,
    };
    setIdentity(next);
    if (token) persistSession(token, next);
    // Stringify deps so a refetch with identical contents doesn't
    // re-run this effect on every render (TanStack returns a new
    // object reference per query result).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(meQuery.data), token]);

  const meStatus: AuthState['meStatus'] = !token
    ? 'idle'
    : meQuery.isLoading || meQuery.isFetching
      ? 'loading'
      : meQuery.isError
        ? 'error'
        : meQuery.data
          ? 'ready'
          : 'idle';

  const login = useCallback((i: Identity, t: string) => {
    setIdentity(i);
    setToken(t);
    persistSession(t, i);
    // /users/me will refetch automatically once the token is in the
    // client; no manual call needed.
  }, []);

  const logout = useCallback(() => {
    setIdentity(null);
    setToken(null);
    clearSession();
  }, []);

  const hasPermission = useCallback(
    (perm: string) => {
      if (!identity) return false;
      // Strictly fail-closed: only allow when the live perm set
      // (post-hydration) contains the requested key.
      return identity.permissions.includes(perm);
    },
    [identity],
  );

  const value = useMemo<AuthState>(
    () => ({
      identity,
      token,
      me: meQuery.data ?? null,
      meStatus,
      hasPermission,
      login,
      logout,
    }),
    [identity, token, meQuery.data, meStatus, hasPermission, login, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
