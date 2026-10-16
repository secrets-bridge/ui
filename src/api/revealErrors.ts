/**
 * Friendly copy for the 403 refusals of the binding gate and the
 * reveal-session gate (api#201: H2, API-S-03, API-S-20).
 *
 * The api answers these with `{"error": "<message>"}`, so the key is the
 * exact message string (ApiError.message), not an `error_code`. The api
 * keeps the bodies generic on purpose ("not bound" and "bound to another
 * environment" read the same); the audit row carries the real reason.
 * The copy here stays just as generic and only adds what the user can
 * do next.
 *
 * Sources (api, internal/handlers):
 *   - dev_secrets.go       POST /projects/:id/environments/:env_id/direct-reveal
 *                          POST /projects/:id/environments/:env_id/request
 *   - requests.go          checkTenancy (POST /requests, /requests/read)
 *                          retrieveUserWrapErr (GET /requests/:id/wraps/:wrap_id)
 *   - reveal_sessions.go   revealSessionErr (POST /reveal-sessions)
 *
 * Unknown messages return undefined; callers fall back to the api text.
 */

import { ApiError } from './client';

export const REVEAL_ERROR_MESSAGES: Record<string, string> = {
  // Single-wrap fetch of a direct-reveal wrap (or one bundled in a reveal
  // session) without an open, unexpired session of the caller.
  'this wrap can only be revealed inside an open reveal session':
    'This value can only be revealed inside an open reveal session. Open the reveal session for this request and reveal it there; if the session already ended, submit a new request.',
  'wrap already consumed':
    'This value was already revealed. Submit a new request to view it again.',
  'wrap expired':
    'This value expired before it was revealed (the reveal session or the wrap TTL ended). Submit a new request to view it again.',
  'this wrap is not permitted by the binding for its environment':
    "This key is not allowed by the secret's binding for this request's environment, so it can't be revealed. Ask a project admin to check the binding.",

  // POST /reveal-sessions
  'all wraps already consumed':
    'The values in this request have already been revealed or have expired. Submit a new request to view them again.',
  "the request's secret is not bound to its environment":
    "This secret is no longer bound to the request's environment, so the reveal session can't open. Ask a project admin to bind it to that environment.",
  'a wrap in this request is not permitted by the binding allowlist':
    "One of the keys in this request is outside the binding's allowed keys for its environment, so the reveal session can't open.",

  // POST .../direct-reveal
  'secret is not available for reveal in this environment':
    "This secret isn't bound for read in this environment, so it can't be revealed here. It may be bound to a different environment; ask a project admin.",
  'requested key is not permitted by the binding allowlist':
    "That key is outside the binding's allowed keys for this environment.",

  // POST /requests, /requests/read and .../environments/:env_id/request
  out_of_scope_project:
    "You can't request this secret here: either your role doesn't cover this project, or the secret isn't bound to the project in the environment you picked.",
  out_of_scope_op:
    "The secret's binding doesn't allow this operation (read or patch) in this environment.",
  out_of_scope_key:
    "One or more keys are outside the binding's allowed keys. Name only allowed keys; leaving the key list empty is refused when the binding limits keys.",
};

/** Friendly message for a known refusal, else undefined. */
export function revealErrorMessage(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  return REVEAL_ERROR_MESSAGES[err.message];
}

/**
 * `<status>: <message>` for the inline error banners, with the friendly
 * copy when the refusal is a known one. Non-ApiError values fall back to
 * their message.
 */
export function describeRevealError(err: unknown, sep = ': '): string {
  if (err instanceof ApiError) {
    return `${err.status}${sep}${revealErrorMessage(err) ?? err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
