/**
 * Step-up coordination singleton (Slice I2).
 *
 * The api's `RequireFreshMFA` middleware returns 401 + a
 * `WWW-Authenticate: step-up` header on Tier-2 ops when the user's
 * session is MFA-stale (api Slice D + H4). The `ApiError.stepUp`
 * flag in `src/api/client.ts` detects that. The QueryClient's
 * global error hooks (queries + mutations) then need a place to
 * notify the SPA so the step-up modal can open.
 *
 * We can't import the modal directly into queryClient.ts — that
 * would couple module loading order to React tree construction.
 * Instead the modal registers an imperative handler via
 * `setStepUpHandler` on mount, and `requestStepUp` is the bridge.
 *
 * Slice I2 routes the OTHER two MFA-shaped errors here too:
 *
 *   412 mfa_enrollment_required  — user has zero factors. SPA
 *                                  navigates to /me/mfa instead of
 *                                  opening a modal the user can't
 *                                  satisfy.
 *   401 factor_compromised       — clone-detection trip from
 *                                  /auth/mfa/verify (api Slice H4
 *                                  via storage.ErrSignCountRegression).
 *                                  All sessions are revoked
 *                                  server-side; the SPA hard-
 *                                  navigates to /login.
 *
 * These two have stable error-body strings the api returns
 * verbatim; we match on them at the interceptor layer.
 */

type StepUpHandler = (returnTo: string) => void;
type EnrollmentRequiredHandler = () => void;
type CompromisedHandler = () => void;

let stepUpHandler: StepUpHandler | null = null;
let enrollmentHandler: EnrollmentRequiredHandler | null = null;
let compromisedHandler: CompromisedHandler | null = null;

export function setStepUpHandler(fn: StepUpHandler | null): void {
  stepUpHandler = fn;
}

export function setEnrollmentRequiredHandler(fn: EnrollmentRequiredHandler | null): void {
  enrollmentHandler = fn;
}

export function setCompromisedHandler(fn: CompromisedHandler | null): void {
  compromisedHandler = fn;
}

/**
 * Open the step-up modal. The optional `returnTo` is captured so the
 * modal can decide whether to refresh in-place after a successful
 * verify (current behaviour: close + invalidate caches, let the user
 * retry their original click). When no provider is mounted the call
 * silently no-ops — there's no sensible fallback at module scope.
 */
export function requestStepUp(returnTo?: string): void {
  const where = returnTo ?? globalThis.location?.pathname ?? '/';
  if (stepUpHandler) {
    stepUpHandler(where);
  }
}

export function requestEnrollment(): void {
  if (enrollmentHandler) {
    enrollmentHandler();
  }
}

export function requestCompromisedFlow(): void {
  if (compromisedHandler) {
    compromisedHandler();
  }
}
