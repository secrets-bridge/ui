/**
 * Signing a tab out when its session dies (UI-N-05).
 *
 * The session cookie can stop working while the tab is open: TTL,
 * revocation, sign-out from another tab, factor compromise. TanStack
 * keeps the last good `/users/me` data after a failed refetch, so
 * without this the tab kept rendering a signed-in shell on stale
 * identity and cached data.
 *
 * `client.ts` reports every 401 that isn't a step-up challenge or a
 * login attempt; `queryClient.ts` routes it here. If the tab had an
 * identity, we drop the whole query + mutation cache and hard-navigate
 * to /login, which also throws away any plaintext still held in page
 * state. The return path rides along as `return_to` and goes through
 * `sanitizeRedirectTarget` on both ends.
 *
 * Never loops: a tab with no cached identity (first visit, the login
 * page's own /users/me probe) is left to RequireAuth, and a tab already
 * on /login only drops the stale cache.
 */

import type { QueryClient } from '@tanstack/react-query';

import { sanitizeRedirectTarget } from '../api/client';
import { meKey } from '../api/me';
import { clearCopiedSecret } from '../lib/secretClipboard';

const LOGIN_ROUTE = '/login';
// Upper bound on waiting for the clipboard clear before leaving; the
// read can stall on a permission prompt.
const CLIPBOARD_CLEAR_WAIT_MS = 250;

let leaving = false;

export function handleSessionExpired(queryClient: QueryClient): void {
  if (leaving) return;
  if (queryClient.getQueryData(meKey.all) === undefined) return;

  queryClient.clear();

  const { pathname, search } = window.location;
  if (pathname === LOGIN_ROUTE) return;

  leaving = true;
  const target = loginPathFor(pathname + search);
  // The hard navigation skips unmount effects, so clear a copied secret
  // first instead of relying on the reveal page's unmount cleanup.
  void Promise.race([
    clearCopiedSecret(),
    new Promise<void>((resolve) => window.setTimeout(resolve, CLIPBOARD_CLEAR_WAIT_MS)),
  ]).finally(() => window.location.replace(target));
}

/** `/login`, plus `?return_to=` when there's somewhere to go back to. */
export function loginPathFor(returnTo: string): string {
  const safe = sanitizeRedirectTarget(returnTo);
  if (safe === '/') return LOGIN_ROUTE;
  return `${LOGIN_ROUTE}?${new URLSearchParams({ return_to: safe }).toString()}`;
}

/**
 * Where Login sends the user after sign-in: the router state RequireAuth
 * sets, or the `return_to` that `handleSessionExpired` put in the URL.
 */
export function loginReturnTarget(fromPathname: string | undefined, search: string): string {
  return sanitizeRedirectTarget(fromPathname ?? new URLSearchParams(search).get('return_to'));
}
