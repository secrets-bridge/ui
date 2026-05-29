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
