import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { ApiError, redirectToStepUp } from './client';

/**
 * Global QueryClient instance.
 *
 * Defaults chosen for the dashboard's read-mostly access pattern:
 * - 30s staleTime: list queries don't refetch on every refocus
 * - retry once on network blips; admin pages would rather show a clear
 *   error than spin forever
 * - never cache mutation responses; every mutation invalidates the
 *   relevant list query explicitly
 *
 * Slice D — step-up auth interceptor. Both the query cache and the
 * mutation cache get an `onError` hook that recognises the api's
 * `step_up_required` shape (ApiError.stepUp = true) and redirects
 * the browser through /auth/oidc/start?step_up=mfa. The IdP
 * re-prompts MFA, the api callback stamps `last_mfa_at` on the
 * SAME session row, and the SPA lands back on the original page —
 * the user's place is preserved.
 *
 * Hard rule kept in mind: NEVER persist Query cache to localStorage.
 * The default in-memory cache is correct — secret-adjacent metadata
 * (mappings, requests) MUST NOT survive a tab close.
 */
function handleStepUp(err: unknown): void {
  if (err instanceof ApiError && err.stepUp) {
    redirectToStepUp();
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleStepUp }),
  mutationCache: new MutationCache({ onError: handleStepUp }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});
