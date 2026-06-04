/**
 * Slice M2/M4 — typed surface for the bulk reveal session endpoints
 * (api#85):
 *
 *   POST   /api/v1/reveal-sessions             open
 *   GET    /api/v1/reveal-sessions/me/active   value-free summaries
 *   POST   /api/v1/reveal-sessions/:id/expire  end ahead of TTL
 *
 * Open returns wrap_id + key_name handles, NOT plaintext. The page
 * loops over `wraps[]` and fetches each plaintext via the existing
 * single-shot `/api/v1/requests/:id/wraps/:wrap_id` endpoint
 * (`revealWrap` in src/api/requests.ts).
 */

import { useMutation } from '@tanstack/react-query';

import { api } from './client';

/** Per-wrap handle returned by Open. NEVER carries plaintext. */
export interface RevealSessionWrapHandle {
  wrap_id: string;
  key_name?: string;
}

/** Successful Open response. session_id + TTL anchors the SPA countdown. */
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

/** Body for POST /reveal-sessions. */
export interface OpenRevealSessionInput {
  access_request_id: string;
}

/**
 * Opens a bulk reveal session for an approved/executed read request.
 *
 * Status mapping (handled by `ApiError`):
 *   - 404 — request not found or wrong type (e.g. patch)
 *   - 403 — caller is not the requester
 *   - 409 — request not approved/executed yet
 *   - 410 — every wrap already consumed (re-open after expire)
 *   - 412 — step-up MFA required (handled SPA-wide by the auth client)
 */
export function useOpenRevealSession() {
  return useMutation({
    mutationFn: (body: OpenRevealSessionInput) =>
      api.post<RevealSessionResponse>('/api/v1/reveal-sessions', body),
  });
}

/** Body for POST /reveal-sessions/:id/expire. */
export interface ExpireRevealSessionInput {
  reason: 'user_hide' | 'unmount';
}

/**
 * Ends a session ahead of its TTL. The server flips the row to expired
 * and advances each underlying wrap's expires_at to "now" so any
 * post-expire retrieve returns 410. Idempotent server-side (a double
 * Hide-Now or sweeper race returns nil).
 */
export function useExpireRevealSession() {
  return useMutation({
    mutationFn: (vars: { sessionId: string; body: ExpireRevealSessionInput }) =>
      api.post<void>(
        `/api/v1/reveal-sessions/${vars.sessionId}/expire`,
        vars.body,
      ),
  });
}

/**
 * Fire-and-forget unmount expire. Used in `useEffect` cleanups where
 * blocking the navigation on a mutation isn't acceptable. Swallows
 * errors — the M3 sweeper is the safety net.
 */
export function expireSessionUnmount(sessionId: string): void {
  void api
    .post<void>(`/api/v1/reveal-sessions/${sessionId}/expire`, {
      reason: 'unmount',
    })
    .catch(() => {
      /* fire-and-forget */
    });
}
