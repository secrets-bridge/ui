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
import type { AccessRequest } from './types';

/**
 * True when the request's wraps belong to the reveal-session flow, so the
 * UI must open a reveal session instead of fetching a single wrap.
 *
 * Mirrors the api check (api#201, API-S-20, RetrieveWrapForUser): a read
 * request that is approved or executed with ZERO approve votes is a
 * direct reveal. Approve always appends the vote before it flips the
 * status, so an approver-approved read always has at least one; the
 * GET /requests/:id response carries no explicit direct-reveal field.
 * Once #201 is live the api refuses a single-wrap fetch of such a wrap
 * with 403 unless the caller has an open session that bundles it. On
 * api main the session flow works the same, so this is safe either way.
 */
export function isRevealSessionFlow(r: AccessRequest): boolean {
  if (r.type !== 'read') return false;
  if (r.status !== 'approved' && r.status !== 'executed') return false;
  return !(r.approvals ?? []).some((a) => a.decision === 'approve');
}

/** Route of the reveal-session page (`RevealSession.tsx`). */
export function revealSessionPath(
  projectId: string,
  envId: string,
  requestId: string,
): string {
  return `/projects/${projectId}/env/${envId}/reveal/${requestId}`;
}

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
