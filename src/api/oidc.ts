/**
 * OIDC availability probe (Slice C).
 *
 * The api mounts /auth/oidc/start only when SB_OIDC_ISSUER is set.
 * The SPA discovers whether SSO is wired by issuing a cheap HEAD-
 * style probe: a GET that the api will 302 (when OIDC is enabled)
 * or 404 (when it isn't). Either response is conclusive without
 * exposing anything sensitive.
 *
 * `redirect: 'manual'` keeps fetch from following the 302 across to
 * the IdP — we only care whether the route exists.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

const buildTimeBase =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

async function probe(): Promise<boolean> {
  const url =
    (buildTimeBase ? buildTimeBase.replace(/\/$/, '') : '') +
    '/api/v1/auth/oidc/start';
  try {
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'include',
    });
    // `redirect: 'manual'` reports an opaqueredirect response when
    // the server returned 3xx. The TypeScript lib.dom union for
    // ResponseType omits 'opaqueredirect' even though runtime
    // browsers emit it — cast through string to dodge the union
    // mismatch without losing runtime correctness.
    const t: string = resp.type;
    if (t === 'opaqueredirect') return true;
    if (resp.status === 302 || resp.status === 303 || resp.status === 307) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface OidcStatus {
  enabled: boolean;
  loading: boolean;
}

/**
 * Probes the env-var OIDC provider. Each probe mints a sign-in state and
 * spends the start route's rate limit, so the login page only uses it
 * as a fallback when GET /auth/providers isn't there (an older api).
 */
export function useOidcAvailable(opts: { enabled?: boolean } = {}): OidcStatus {
  const q: UseQueryResult<boolean, Error> = useQuery({
    queryKey: ['oidc-available'],
    queryFn: probe,
    staleTime: 5 * 60 * 1000,
    retry: false,
    enabled: opts.enabled ?? true,
  });
  return { enabled: q.data === true, loading: q.isLoading };
}
