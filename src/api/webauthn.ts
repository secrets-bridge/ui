/**
 * WebAuthn helpers — converts between go-webauthn's wire shape (JSON
 * with base64url strings) and the browser's `navigator.credentials.*`
 * APIs (ArrayBuffers).
 *
 * Why this layer exists:
 *
 *   The server uses base64url for binary fields so the JSON is
 *   readable. The browser API insists on ArrayBuffer for the same
 *   fields. We do the conversion here so each component only ever
 *   sees the shape that's natural for its job.
 *
 * Slice I1 only needs the enrollment ceremony (create). The
 * assertion ceremony (`navigator.credentials.get`) lands in Slice I2
 * alongside the step-up modal and shares these helpers — separate
 * file purely so the I2 PR adds the additional helpers without
 * conflicting on this one.
 */

import type { WebAuthnCredentialCreationOptionsJSON } from './mfa';

// --- base64url <-> ArrayBuffer --------------------------------------

/**
 * Decode a base64url-encoded string into an `ArrayBuffer`. The W3C
 * Credential Management API insists on `BufferSource` for binary
 * fields, and `BufferSource` rejects `Uint8Array` whose underlying
 * buffer the type system can't prove is a plain `ArrayBuffer` (vs.
 * `SharedArrayBuffer`). Returning a fresh `ArrayBuffer` sidesteps
 * the whole resolution dance.
 *
 * Accepts both URL-safe (`-` / `_`) and standard (`+` / `/`)
 * alphabets so a JSON shape mixing the two doesn't break.
 */
export function base64UrlToBuffer(s: string): ArrayBuffer {
  // Browser libraries vary on padding. atob requires no padding for
  // standard base64; replace URL-safe alphabet first, then re-add
  // the implicit `=` padding the spec drops.
  const std = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
  const binary = atob(padded);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buf;
}

/** Encode an ArrayBuffer or Uint8Array to base64url (no padding). */
export function bytesToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// --- options conversion ---------------------------------------------

/**
 * Convert the go-webauthn JSON shape into the W3C
 * `PublicKeyCredentialCreationOptions` the browser API expects.
 *
 * `user.id` is special: go-webauthn can serialise it either as a
 * base64url string OR as a typed-array shape (`{type, data}`) when
 * `EncodeUserIDAsString=false` is set on the server. We handle both.
 */
export function toCreationOptions(
  json: WebAuthnCredentialCreationOptionsJSON
): PublicKeyCredentialCreationOptions {
  const pk = json.publicKey;
  return {
    rp: pk.rp,
    user: {
      id: decodeUserHandle(pk.user.id),
      name: pk.user.name,
      displayName: pk.user.displayName,
    },
    challenge: base64UrlToBuffer(pk.challenge),
    // The browser accepts `pubKeyCredParams` verbatim (numeric algs).
    pubKeyCredParams: pk.pubKeyCredParams.map((p) => ({
      type: p.type as PublicKeyCredentialType,
      alg: p.alg,
    })),
    timeout: pk.timeout,
    excludeCredentials: pk.excludeCredentials?.map((c) => ({
      type: c.type as PublicKeyCredentialType,
      id: base64UrlToBuffer(c.id),
      transports: c.transports as AuthenticatorTransport[] | undefined,
    })),
    authenticatorSelection: pk.authenticatorSelection
      ? {
          authenticatorAttachment: pk.authenticatorSelection.authenticatorAttachment as
            | AuthenticatorAttachment
            | undefined,
          requireResidentKey: pk.authenticatorSelection.requireResidentKey,
          residentKey: pk.authenticatorSelection.residentKey as ResidentKeyRequirement | undefined,
          userVerification: pk.authenticatorSelection.userVerification as
            | UserVerificationRequirement
            | undefined,
        }
      : undefined,
    attestation: pk.attestation as AttestationConveyancePreference | undefined,
  };
}

function decodeUserHandle(
  raw: string | { type?: string; data?: number[] }
): ArrayBuffer {
  if (typeof raw === 'string') {
    return base64UrlToBuffer(raw);
  }
  if (raw && Array.isArray(raw.data)) {
    const buf = new ArrayBuffer(raw.data.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < raw.data.length; i++) view[i] = raw.data[i];
    return buf;
  }
  throw new Error('webauthn: user.id shape not recognised');
}

// --- attestation response → JSON wire shape -------------------------

/**
 * Serialise the browser's `PublicKeyCredential` (with embedded
 * `AuthenticatorAttestationResponse`) into the JSON shape go-
 * webauthn parses via `ParseCredentialCreationResponseBytes`.
 *
 * The W3C field names + base64url encoding are what the library
 * expects; this function is the wire contract.
 */
export function attestationResponseToJSON(
  cred: PublicKeyCredential
): Record<string, unknown> {
  const r = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id, // already base64url per spec
    rawId: bytesToBase64Url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    response: {
      attestationObject: bytesToBase64Url(r.attestationObject),
      clientDataJSON: bytesToBase64Url(r.clientDataJSON),
      // Transports help the relying party hint future auth flows.
      // Not all browsers expose getTransports(); guard the call.
      transports:
        typeof (r as unknown as { getTransports?: () => string[] }).getTransports === 'function'
          ? (r as unknown as { getTransports: () => string[] }).getTransports()
          : undefined,
    },
  };
}
