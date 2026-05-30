/**
 * /users/me hydration — wraps GET /api/v1/users/me. Returns the
 * caller's identity (id / email / display_name) along with the deduped
 * permission set + direct team memberships + accessible projects.
 *
 * AuthProvider auto-fetches this whenever a token lands (login OR
 * sessionStorage hydration on reload) and writes the response into
 * the identity stored on the context. After that, every nav gate +
 * profile page reads from the same context object.
 *
 * Cache key: ['me', tokenFingerprint]. The fingerprint is a stable
 * derivative of the bearer token so a new session forces a refetch
 * but identical tokens hit the cache.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from './client';
import type { MeResponse } from './types';

export const meKey = {
  all: ['me'] as const,
  forToken: (fp: string) => ['me', fp] as const,
};

export function useMe(opts?: { enabled?: boolean }): UseQueryResult<MeResponse, Error> {
  return useQuery({
    queryKey: meKey.all,
    queryFn: () => api.get<MeResponse>('/api/v1/users/me'),
    // The token is automatically injected by the api client; query
    // result reflects whatever caller identity the current token
    // resolves to. AuthProvider invalidates this key on logout.
    enabled: opts?.enabled ?? true,
    staleTime: 60_000,
    retry: (failureCount, error) => {
      // 401 / 404 / 422 are permanent for this token — don't retry.
      const msg = String(error?.message ?? '');
      if (/^4(0[14]|22)/.test(msg)) return false;
      return failureCount < 2;
    },
  });
}
