import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import {
  requestCompromisedFlow,
  requestEnrollment,
  requestStepUp,
} from '../auth/stepUp';
import { ApiError } from './client';

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
 * Slice D + I2 — step-up auth interceptor. Both the query cache and
 * the mutation cache get an `onError` hook that recognises the api's
 * MFA-shaped responses and routes them through the SPA:
 *
 *   401 step_up_required (ApiError.stepUp = true)
 *     → opens the step-up modal via `requestStepUp`. The modal
 *       drives /auth/mfa/{challenge,verify} directly; the user is
 *       MFA-fresh after the 204 and can retry the original click.
 *
 *   412 mfa_enrollment_required (api Slice H5)
 *     → navigates to /me/mfa. Step-up modal wouldn't have anything
 *       to verify with.
 *
 *   401 factor_compromised (api Slice H4)
 *     → hard-navigate to /login. The api has already revoked every
 *       session for the user (clone-detection trip); React state
 *       MUST NOT outlive the auth boundary.
 *
 * The provider in `src/auth/StepUpModal.tsx` registers handlers for
 * these three flavours via the `stepUp` singleton; when no provider
 * is mounted the calls no-op.
 *
 * Hard rule kept in mind: NEVER persist Query cache to localStorage.
 * The default in-memory cache is correct — secret-adjacent metadata
 * (mappings, requests) MUST NOT survive a tab close.
 */
function handleStepUp(err: unknown): void {
  if (!(err instanceof ApiError)) return;
  // 401 + WWW-Authenticate: step-up — the Tier-2 gate signalled the
  // session is MFA-stale.
  if (err.stepUp) {
    requestStepUp();
    return;
  }
  // 412 mfa_enrollment_required — the user has zero factors. The
  // step-up modal would be a dead end; route to enrollment instead.
  // Both api Slice H5 (RequireFreshMFA) and Slice H4 (verify
  // service) can return this; matching on the body string keeps the
  // logic uniform.
  const message = (err.message ?? '').toLowerCase();
  if (err.status === 412 && message.includes('mfa_enrollment_required')) {
    requestEnrollment();
    return;
  }
  // 401 factor_compromised — sign-count regression on WebAuthn
  // assertion. Sessions are revoked server-side; bounce to login.
  if (err.status === 401 && message.includes('factor_compromised')) {
    requestCompromisedFlow();
  }
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleStepUp }),
  mutationCache: new MutationCache({ onError: handleStepUp }),
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
