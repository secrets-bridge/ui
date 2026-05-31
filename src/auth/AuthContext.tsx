/**
 * Auth context — cookie-only after Slice C (ui#TBD).
 *
 * Auth model:
 * - The api sets an HttpOnly Secure SameSite=Strict cookie on
 *   successful login (`POST /auth/login`) or OIDC callback
 *   (`GET /auth/oidc/callback`).
 * - Every subsequent request carries the cookie automatically
 *   (api client uses `credentials: 'include'`).
 * - The SPA NEVER sees the token value. There is no localStorage /
 *   sessionStorage path; reload reissues the same /users/me with
 *   the cookie the browser already holds.
 * - The identity surface is `GET /users/me`. While that's in flight
 *   `meStatus === 'loading'`, after it lands `'ready'`, on 401
 *   `'idle'` (unauthenticated) — we don't surface a generic error
 *   for 401 because that's the "you need to sign in" state.
 * - Logout calls `POST /auth/logout` (local) or
 *   `POST /auth/oidc/logout` (OIDC). Both revoke the server-side
 *   session and clear the cookie; the SPA invalidates the /users/me
 *   cache to flip back to the login screen.
 *
 * Hard rules retained from earlier slices:
 * - Permission gating is FAIL-CLOSED: until /users/me resolves,
 *   `hasPermission(...)` is `false` for every key.
 * - Identity carries no token field — there is nothing to leak.
 */

import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { api, ApiError } from '../api/client';
import { meKey, useMe } from '../api/me';
import type { MeResponse } from '../api/types';

export interface Identity {
  id: string;
  email: string;
  display_name: string;
  // Permission strings — sourced from GET /users/me after sign-in.
  // Until /users/me resolves this stays empty; every nav gate +
  // gated button stays hidden (fail-closed).
  permissions: string[];
}

interface AuthState {
  identity: Identity | null;
  me: MeResponse | null;
  // `idle` = unauthenticated (no cookie or invalid cookie);
  // `loading` = /users/me request in flight;
  // `ready` = identity is fully hydrated with real permissions;
  // `error` = non-401 fetch failure (UI surfaces a retry banner).
  meStatus: 'idle' | 'loading' | 'ready' | 'error';
  hasPermission: (perm: string) => boolean;
  // After a successful login (local or OIDC), call this to force
  // the auth context to refetch /users/me. The cookie was set
  // server-side; the SPA simply needs to re-read identity.
  refresh: () => void;
  // Hits the api's logout endpoint, invalidates the cache, and
  // clears the local identity. The caller still has to navigate
  // away from gated pages.
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Single source of truth. The query is always enabled — on the
  // login page the browser has no cookie, so the api returns 401
  // and we treat that as `meStatus === 'idle'`. On every other page
  // the cookie is present and the query lands `ready` quickly.
  const meQuery = useMe();

  const identity: Identity | null = meQuery.data
    ? {
        id: meQuery.data.id,
        email: meQuery.data.email,
        display_name: meQuery.data.display_name || meQuery.data.email,
        permissions: meQuery.data.permissions,
      }
    : null;

  // Map the query state to the auth state machine. A 401 surfaces as
  // an unauthenticated session ('idle'), not a generic error — the
  // user just needs to sign in. Status is read from ApiError.status
  // directly; the regex over error.message used to live here but the
  // api returns {"error":"authentication required"} on 401 so the
  // message-based check always failed and 401s mapped to 'error'.
  const meStatus: AuthState['meStatus'] = (() => {
    if (meQuery.isLoading || meQuery.isFetching) return 'loading';
    if (meQuery.isError) {
      const err = meQuery.error;
      if (err instanceof ApiError && err.status === 401) return 'idle';
      return 'error';
    }
    if (meQuery.data) return 'ready';
    return 'idle';
  })();

  const refresh = useCallback(() => {
    // Invalidate so a subsequent render sees fresh /users/me.
    queryClient.invalidateQueries({ queryKey: meKey.all });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/v1/auth/logout');
    } catch {
      // Network failure shouldn't trap the user — clearing local
      // identity is the user-visible effect either way.
    }
    queryClient.removeQueries({ queryKey: meKey.all });
    // After remove, the next render shows meStatus === 'idle' so
    // ProtectedRoute kicks the user back to /login.
  }, [queryClient]);

  const hasPermission = useCallback(
    (perm: string) => {
      if (!identity) return false;
      return identity.permissions.includes(perm);
    },
    [identity],
  );

  const value = useMemo<AuthState>(
    () => ({
      identity,
      me: meQuery.data ?? null,
      meStatus,
      hasPermission,
      refresh,
      logout,
    }),
    [identity, meQuery.data, meStatus, hasPermission, refresh, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
