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
 * `412 mfa_enrollment_required` (the user has zero factors) goes
 * through `requestStepUp()` as well: the modal has the user add a
 * factor over the current page, then verify with it, and the request
 * retries. It used to navigate to /me/mfa, which dropped whatever the
 * page held, such as a half-filled form.
 *
 * The other MFA-shaped error routes through here too:
 *
 *   401 factor_compromised       — clone-detection trip from
 *                                  /auth/mfa/verify (api Slice H4
 *                                  via storage.ErrSignCountRegression).
 *                                  All sessions are revoked
 *                                  server-side; the SPA hard-
 *                                  navigates to /login.
 *                                  Fire-and-forget; the original
 *                                  request throws.
 *
 * Both have stable error-body strings the api returns verbatim;
 * client.ts matches on them.
 */

/** What the step-up is for; changes the dialog's wording only. */
export type StepUpPurpose = 'action' | 'reveal';

type StepUpHandler = (purpose: StepUpPurpose) => void;
type CompromisedHandler = () => void;

let stepUpHandler: StepUpHandler | null = null;
let compromisedHandler: CompromisedHandler | null = null;

interface PendingStepUp {
  promise: Promise<'verified' | 'cancelled'>;
  resolve: (outcome: 'verified' | 'cancelled') => void;
}

let pendingStepUp: PendingStepUp | null = null;

export function setStepUpHandler(fn: StepUpHandler | null): void {
  stepUpHandler = fn;
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
export function requestStepUp(purpose: StepUpPurpose = 'action'): Promise<'verified' | 'cancelled'> {
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
  stepUpHandler(purpose);
  return promise;
}

/** Whether the step-up modal is open, i.e. a step-up promise is pending. */
export function isStepUpPending(): boolean {
  return pendingStepUp !== null;
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

export function requestCompromisedFlow(): void {
  if (compromisedHandler) {
    compromisedHandler();
  }
}

/**
 * Session expired or revoked (UI-N-05). `client.ts` calls this on a
 * 401 that is neither a step-up challenge nor a login attempt. The
 * handler (`handleSessionExpired`, wired in `queryClient.ts`) decides
 * whether the tab actually had a session to lose. Kept here, import
 * free like the others, so `client.ts` doesn't import the query client.
 */
type SessionExpiredHandler = () => void;
let sessionExpiredHandler: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(fn: SessionExpiredHandler | null): void {
  sessionExpiredHandler = fn;
}

export function notifySessionExpired(): void {
  if (sessionExpiredHandler) {
    sessionExpiredHandler();
  }
}
