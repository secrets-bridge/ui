/**
 * Stable error codes from the sign-in settings and Connect Google
 * routes (api#267), as words. Codes come in `error_code` (settings) or
 * a `reason` alongside it (sso_unavailable, link_refused, a failed
 * test).
 */

import { ApiError } from './client';

const CODE_MESSAGES: Record<string, string> = {
  invalid_input: 'Check the highlighted field.',
  default_role_privileged:
    'A default role can only hold secret.list, secret.request and audit.read. Make a role with just those, or keep approval on.',
  default_role_needs_approval_off: 'A default role is only used when new users don’t need approval.',
  env_provider_is_google: 'This install already signs in with Google through its SB_OIDC_* settings.',
  provider_exists: 'Google is already set up.',
  provider_not_ready: 'Set the missing items before turning sign-in on.',
  public_url_from_env: 'This install sets its public address with SB_PUBLIC_URL, so it can’t be changed here.',
  sso_unavailable: 'Signing in with this provider isn’t available right now.',
  link_refused: 'Google couldn’t be connected to this account.',
};

const REASON_MESSAGES: Record<string, string> = {
  identity_taken: 'That Google account is already connected to another account.',
  email_unverified: 'Google didn’t confirm that account’s email address.',
  hd_not_allowed: 'That Google account isn’t part of an allowed Google Workspace.',
  email_domain_not_allowed: 'That account’s email domain isn’t in the allowed list.',
  email_has_account: 'That email already has an account here.',
  provider_disabled: 'Google sign-in is turned off.',
  no_public_url: 'Set this install’s public address first.',
  account_disabled: 'This account is disabled.',
  exchange_failed: 'Google didn’t accept the client ID and secret. Check them in Google Cloud Console.',
  id_token_invalid: 'Google’s answer couldn’t be verified. Check the client ID.',
  no_code: 'The sign-in was cancelled at Google.',
  state_unknown: 'The round trip took too long. Try again.',
  state_cookie: 'The round trip was started in another browser. Try again here.',
};

/** The api's error_code and reason, when the error carries them. */
export function ssoErrorDetail(err: unknown): { code?: string; reason?: string; field?: string; missing?: string[] } {
  if (!(err instanceof ApiError) || typeof err.body !== 'object' || err.body === null) return {};
  const b = err.body as Record<string, unknown>;
  return {
    code: typeof b.error_code === 'string' ? b.error_code : undefined,
    reason: typeof b.reason === 'string' ? b.reason : undefined,
    field: typeof b.field === 'string' ? b.field : undefined,
    missing: Array.isArray(b.missing) ? b.missing.filter((m): m is string => typeof m === 'string') : undefined,
  };
}

/** A sentence for an error from the sign-in routes. */
export function ssoErrorText(err: unknown): string {
  const { code, reason, missing } = ssoErrorDetail(err);
  if (reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason];
  if (code === 'provider_not_ready' && missing?.length) {
    const names: Record<string, string> = {
      public_url: 'the public address',
      client_secret: 'the client secret',
      allowed_domains: 'an allowed domain',
    };
    return `Set ${missing.map((m) => names[m] ?? m).join(' and ')} before turning sign-in on.`;
  }
  if (code === 'invalid_input' && err instanceof ApiError) return err.message;
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Your second factor wasn’t confirmed, so nothing changed.';
    return `${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** A sentence for a failed Test round trip's reason. */
export function ssoReasonText(reason?: string): string {
  return (reason && REASON_MESSAGES[reason]) || 'The test didn’t pass.';
}
