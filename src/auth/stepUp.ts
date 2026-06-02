/**
 * Step-up coordination singleton (Slice I2 + ui#56).
 *
 * The api's `RequireFreshMFA` middleware returns 401 + a
 * `WWW-Authenticate: step-up` header on Tier-2 ops when the user's
 * session is MFA-stale (api Slice D + H4). The `ApiError.stepUp`
 * flag in `src/api/client.ts` detects that. `client.ts` then needs
 * to (a) prompt the user for a factor and (b) AUTO-RETRY the
 * original request once verification succeeds, so the caller's
 * `await` resolves with the success value as if MFA never happened.
 *
 * We can't import the modal directly into client.ts — that would
 * couple module loading order to React tree construction. Instead
 * the modal registers a fire-and-forget imperative handler via
 * `setStepUpHandler` on mount, and the promise lifecycle lives in
 * this module:
 *
 *   1. client.ts calls `requestStepUp()` → returns a Promise
 *   2. handler is invoked → modal opens
 *   3. user verifies (or cancels) → modal calls `resolveStepUp(...)`
 *   4. client.ts's awaited promise resolves with the outcome
 *   5. client.ts retries the original fetch on 'verified', throws on 'cancelled'
 *
 * **Concurrent-call dedup:** if N parallel queries 401 at the same
 * time, all of them attach to the SAME pending promise. ONE modal
 * opens, ONE verify ceremony fires, and ALL N retries fan out
 * together. The promise is stored at module scope until resolved.
 *
 * Slice I2 routes the OTHER two MFA-shaped errors through here too:
 *
 *   412 mfa_enrollment_required  — user has zero factors. SPA
 *                                  navigates to /me/mfa instead of
 *                                  opening a modal the user can't
 *                                  satisfy. Fire-and-forget; the
 *                                  original request throws.
 *   401 factor_compromised       — clone-detection trip from
 *                                  /auth/mfa/verify (api Slice H4
 *                                  via storage.ErrSignCountRegression).
 *                                  All sessions are revoked
 *                                  server-side; the SPA hard-
 *                                  navigates to /login. Same
 *                                  fire-and-forget pattern.
 *
 * These two have stable error-body strings the api returns
 * verbatim; client.ts matches on them and routes here.
 */

type StepUpHandler = () => void;
type EnrollmentRequiredHandler = () => void;
type CompromisedHandler = () => void;

let stepUpHandler: StepUpHandler | null = null;
let enrollmentHandler: EnrollmentRequiredHandler | null = null;
let compromisedHandler: CompromisedHandler | null = null;

interface PendingStepUp {
  promise: Promise<'verified' | 'cancelled'>;
  resolve: (outcome: 'verified' | 'cancelled') => void;
}

let pendingStepUp: PendingStepUp | null = null;

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
 * Open the step-up modal and return a promise resolving with the
 * user's choice. Concurrent callers share the same promise — N
 * parallel 401s open ONE modal and all retry together when the
 * user verifies.
 *
 * Resolves immediately with 'cancelled' when no modal provider is
 * mounted (there's no sensible fallback at module scope).
 */
export function requestStepUp(): Promise<'verified' | 'cancelled'> {
  if (pendingStepUp) return pendingStepUp.promise;
  if (!stepUpHandler) return Promise.resolve('cancelled');

  let resolveFn!: (outcome: 'verified' | 'cancelled') => void;
  const promise = new Promise<'verified' | 'cancelled'>((resolve) => {
    resolveFn = resolve;
  });
  pendingStepUp = { promise, resolve: resolveFn };
  promise.finally(() => {
    pendingStepUp = null;
  });
  stepUpHandler();
  return promise;
}

/**
 * Resolve the currently-pending step-up. Called by the modal at
 * each exit point (verify success → 'verified', any cancel path →
 * 'cancelled'). No-op when no step-up is pending — defensive
 * against stale event handlers firing after the promise resolved.
 */
export function resolveStepUp(outcome: 'verified' | 'cancelled'): void {
  if (pendingStepUp) {
    pendingStepUp.resolve(outcome);
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
