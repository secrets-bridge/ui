/**
 * MFA enrollment + management API surface (Slice I1).
 *
 * Wraps the api endpoints landed in Slices H1–H5:
 *
 *   GET    /api/v1/users/me/mfa/factors                  list enrolled
 *   DELETE /api/v1/users/me/mfa/factors/:id              remove one
 *   POST   /api/v1/users/me/mfa/totp/enroll              start TOTP
 *   POST   /api/v1/users/me/mfa/totp/confirm             finish TOTP
 *   POST   /api/v1/users/me/mfa/webauthn/register/start  start WebAuthn
 *   POST   /api/v1/users/me/mfa/webauthn/register/finish finish WebAuthn
 *
 * Hard rules from the api side that map to UI behaviour:
 *
 * - No `auth.Require` gate on /users/me/mfa/*. Every signed-in user
 *   manages their OWN factors; the handler reads the user id from the
 *   session, never from a body field.
 * - Factor list returns metadata only — envelope-encrypted secret
 *   columns NEVER come back on the wire.
 * - Delete returns 404 (not 403) on cross-user mismatch so a hostile
 *   caller can't enumerate factor IDs by status code. The UI just
 *   treats both as "gone".
 * - TOTP confirm + WebAuthn finish are single-shot — a wrong code or
 *   bad attestation BURNS the challenge on the server. The UI must
 *   restart enrollment if either fails.
 * - WebAuthn options arrive in W3C `PublicKeyCredentialCreationOptions`
 *   shape with `challenge` + `user.id` + `excludeCredentials[].id`
 *   base64url-encoded as strings. The browser `credentials.create()`
 *   API needs them as ArrayBuffers — see `webauthn.ts` for the
 *   conversion helpers.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { meKey } from './me';

// --- shared shapes --------------------------------------------------

export type MFAFactorKind = 'totp' | 'webauthn';

export interface MFAFactor {
  id: string;
  kind: MFAFactorKind;
  label: string;
  created_at: string;
  // ISO timestamp of the most recent successful verification. null
  // when the factor was enrolled but never used.
  last_used_at: string | null;
}

export const mfaKey = {
  all: ['mfa'] as const,
  factors: ['mfa', 'factors'] as const,
};

// --- list + delete --------------------------------------------------

/**
 * Returns the caller's enrolled MFA factors. Empty array when nothing
 * is enrolled. Same `MFAFactor` shape regardless of kind.
 */
export function useMFAFactors() {
  return useQuery({
    queryKey: mfaKey.factors,
    queryFn: () => api.get<MFAFactor[]>('/api/v1/users/me/mfa/factors'),
    staleTime: 30_000,
  });
}

/**
 * Removes a factor. The api enforces user-scoped delete at the
 * repository layer — a hostile request can't delete another user's
 * factor by id alone. We treat 404 as "already gone" rather than
 * an error.
 *
 * Also invalidates the /users/me cache so `mfa_enrolled` updates
 * if the deleted factor was the user's last one.
 */
export function useDeleteFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<void>(`/api/v1/users/me/mfa/factors/${encodeURIComponent(id)}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mfaKey.factors });
      qc.invalidateQueries({ queryKey: meKey.all });
    },
  });
}

// --- TOTP -----------------------------------------------------------

export interface TOTPEnrollResponse {
  challenge_id: string;
  // Base32-encoded shared secret. The user can type this into an
  // authenticator app that doesn't support QR scanning.
  secret_base32: string;
  // otpauth:// URI ready to render as a QR code.
  provisioning_uri: string;
  // ISO timestamp of when the challenge ages out of Redis (10
  // minutes from enroll).
  expires_at: string;
}

/**
 * Start TOTP enrollment. The api mints a secret, envelope-encrypts
 * it, parks it in Redis under the returned `challenge_id` for 10
 * minutes. Nothing lands in Postgres until ConfirmTOTP succeeds.
 *
 * On every call the server returns a FRESH secret + challenge_id —
 * re-rendering this page does NOT reuse the prior secret. Restart
 * the SPA-side ceremony from scratch each time.
 */
export function useEnrollTOTP() {
  return useMutation({
    mutationFn: (input: { label: string }) =>
      api.post<TOTPEnrollResponse>('/api/v1/users/me/mfa/totp/enroll', input),
  });
}

/**
 * Confirm TOTP enrollment. On success the factor is persisted; the
 * caller is responsible for invalidating the factor list cache (this
 * hook does it via onSuccess). On failure the api has already BURNED
 * the Redis challenge — restart by calling useEnrollTOTP again.
 */
export function useConfirmTOTP() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { challenge_id: string; code: string }) =>
      api.post<MFAFactor>('/api/v1/users/me/mfa/totp/confirm', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mfaKey.factors });
      qc.invalidateQueries({ queryKey: meKey.all });
    },
  });
}

// --- WebAuthn -------------------------------------------------------

/**
 * The api passes through the go-webauthn library's
 * `*protocol.CredentialCreation` shape verbatim. The actual W3C
 * options live under `.publicKey` (`Response` in the JSON). We carry
 * the structure opaquely up to the page; the page converts to
 * `PublicKeyCredentialCreationOptions` and hands it to
 * `navigator.credentials.create()`.
 */
export interface WebAuthnRegisterStartResponse {
  challenge_id: string;
  options: WebAuthnCredentialCreationOptionsJSON;
}

/**
 * Mirrors the relevant subset of `protocol.CredentialCreation`. We
 * type it loosely because the W3C shape carries optional fields the
 * SPA never reads; what we DO consume is fully typed.
 */
export interface WebAuthnCredentialCreationOptionsJSON {
  publicKey: {
    rp: { id: string; name: string };
    user: { id: string | { type?: string; data?: number[] }; name: string; displayName: string };
    challenge: string;
    pubKeyCredParams: Array<{ type: string; alg: number }>;
    timeout?: number;
    excludeCredentials?: Array<{ type: string; id: string; transports?: string[] }>;
    authenticatorSelection?: {
      authenticatorAttachment?: string;
      requireResidentKey?: boolean;
      residentKey?: string;
      userVerification?: string;
    };
    attestation?: string;
  };
}

export function useWebAuthnRegisterStart() {
  return useMutation({
    mutationFn: (input: { label: string }) =>
      api.post<WebAuthnRegisterStartResponse>(
        '/api/v1/users/me/mfa/webauthn/register/start',
        input
      ),
  });
}

/**
 * Finish WebAuthn enrollment. `response` is the
 * `AuthenticatorAttestationResponse` JSON the browser returns — go-
 * webauthn parses it via `ParseCredentialCreationResponseBytes`.
 */
export interface WebAuthnRegisterFinishRequest {
  challenge_id: string;
  response: unknown;
}

export function useWebAuthnRegisterFinish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: WebAuthnRegisterFinishRequest) =>
      api.post<MFAFactor>('/api/v1/users/me/mfa/webauthn/register/finish', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: mfaKey.factors });
      qc.invalidateQueries({ queryKey: meKey.all });
    },
  });
}

// --- step-up challenge + verify (Slice H4 → I2) ---------------------

/**
 * The challenge endpoint's response shape. `options` is only present
 * for kind=webauthn and carries the W3C
 * `PublicKeyCredentialRequestOptions` shape (same envelope as
 * registration's `CredentialCreation`).
 */
export interface MFAChallengeResponse {
  challenge_id: string;
  kind: MFAFactorKind;
  options?: WebAuthnCredentialRequestOptionsJSON;
}

/**
 * Mirrors the relevant subset of `protocol.CredentialAssertion`.
 * We type loosely — same posture as the registration shape.
 */
export interface WebAuthnCredentialRequestOptionsJSON {
  publicKey: {
    challenge: string;
    timeout?: number;
    rpId?: string;
    allowCredentials?: Array<{ type: string; id: string; transports?: string[] }>;
    userVerification?: string;
  };
}

/**
 * Mint a step-up challenge of the requested kind. Returns 412
 * `mfa_enrollment_required` when the user has no factor of any kind
 * (SPA routes to /me/mfa); 412 `mfa_kind_not_enrolled` when they have
 * factors but none of the requested kind (SPA can hint "try the
 * other kind").
 */
export function useMFAChallenge() {
  return useMutation({
    mutationFn: (input: { kind: MFAFactorKind }) =>
      api.post<MFAChallengeResponse>('/api/v1/auth/mfa/challenge', input),
  });
}

/**
 * Verify the step-up challenge. On success the api stamps
 * `last_mfa_at` on the user's CURRENT session — the next Tier-2 op
 * passes the `RequireFreshMFA` gate. The 204 response means "you're
 * fresh; retry your original action."
 *
 * `factor_id` is REQUIRED for kind=totp; the WebAuthn path matches
 * via the credential id inside `response`.
 */
export interface MFAVerifyRequest {
  challenge_id: string;
  factor_id?: string;
  code?: string;
  response?: unknown;
}

export function useMFAVerify() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: MFAVerifyRequest) =>
      api.post<void>('/api/v1/auth/mfa/verify', input),
    onSuccess: () => {
      // Last-used timestamps change; the factor list cache becomes
      // stale. /users/me doesn't carry last_mfa_at directly so we
      // skip invalidating it.
      qc.invalidateQueries({ queryKey: mfaKey.factors });
    },
  });
}
