import { QueryClient } from '@tanstack/react-query';

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
 * MFA-shaped error routing (401 step_up_required, 412
 * mfa_enrollment_required, 401 factor_compromised) used to live here
 * as queryCache/mutationCache `onError` hooks. It moved into
 * `client.ts`'s `request()` after we shipped a Tier-2 reveal flow
 * that called the raw `revealWrap()` helper directly (no TanStack
 * hook), so the global onError never fired and the step-up modal
 * never mounted. Routing at the source means BOTH paths — hooked
 * and direct — get the same modal/redirect behaviour.
 *
 * Hard rule kept in mind: NEVER persist Query cache to localStorage.
 * The default in-memory cache is correct — secret-adjacent metadata
 * (mappings, requests) MUST NOT survive a tab close.
 */
export const queryClient = new QueryClient({
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
