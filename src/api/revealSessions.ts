/**
 * Reveal sessions (api#85):
 *
 *   POST   /api/v1/reveal-sessions             open
 *   POST   /api/v1/reveal-sessions/:id/expire  end ahead of the deadline
 *
 * Every reveal in the console goes through a session, so the server
 * owns the viewing window (`ttl_seconds`, `expires_at`). Open returns
 * wrap handles (wrap id and key name), never values; each value is then
 * fetched once through GET /requests/:id/wraps/:wrap_id (`revealWrap`).
 *
 * These are plain calls, not TanStack hooks, on purpose: nothing about a
 * reveal should sit in a query or mutation cache.
 */

import { api } from './client';

/** Per-wrap handle returned by Open. NEVER carries plaintext. */
export interface RevealSessionWrapHandle {
  wrap_id: string;
  key_name?: string;
}

/** Successful Open response. `opened_at` and `expires_at` anchor the countdown. */
export interface RevealSessionResponse {
  session_id: string;
  access_request_id: string;
  environment_id: string;
  project_id: string;
  ttl_seconds: number;
  opened_at: string; // RFC3339 UTC
  expires_at: string; // RFC3339 UTC
  wraps: RevealSessionWrapHandle[];
}

/**
 * Open a reveal session for an approved or executed read request. Needs
 * a fresh MFA step-up (the client handles a 401 step-up challenge).
 *
 *   - 503 `wrap_not_ready`: the agent hasn't stored the values yet
 *   - 410: every value was already revealed or expired
 *   - 403: not the requester, or the binding refuses a key
 *   - 409: not approved yet
 *   - 429: too many reveal attempts
 */
export function openRevealSession(accessRequestId: string): Promise<RevealSessionResponse> {
  return api.post<RevealSessionResponse>('/api/v1/reveal-sessions', { access_request_id: accessRequestId });
}

/**
 * End a session before its deadline. The server marks it expired and
 * moves each wrap's expiry to now, so nothing in it can be fetched
 * again. Idempotent server-side. Errors are swallowed: the worker's
 * sweeper closes the session at its deadline anyway.
 */
export function expireRevealSession(sessionId: string, reason: 'user_hide' | 'unmount'): void {
  void api
    .post<void>(`/api/v1/reveal-sessions/${sessionId}/expire`, { reason })
    .catch(() => {
      /* best effort */
    });
}
