/**
 * API client for the secrets-bridge Control Plane.
 *
 * Auth model (Slice C, ui#TBD): the api sets an HttpOnly Secure
 * SameSite=Strict cookie on successful login (POST /auth/login) or
 * OIDC callback (GET /auth/oidc/callback). Every subsequent request
 * carries that cookie automatically; the SPA never sees the token
 * value. `credentials: 'include'` is required so the cookie crosses
 * the boundary when api + ui are on different origins (e.g. local
 * dev with Vite on :5173 and api on :8080). On same-origin
 * deployments this is a no-op.
 *
 * Legacy `Authorization: Bearer` + `X-User-Id` paths were removed in
 * Slice C; the api still accepts them for the rest of the
 * transition (back-compat shim in middleware.AuthWith) but the SPA
 * no longer sends either.
 *
 * Base URL strategy: relative URLs by default (`/api/v1/...`) so the
 * SPA works on same-origin deployments without any config. Operators
 * who run the UI on a different origin from the API set
 * `VITE_API_BASE_URL` at build time (e.g. `https://api.example.com`).
 *
 * Hard rules (BRD §15 Frontend boundary):
 * - NEVER include provider credentials in any request body
 * - NEVER store secret values in localStorage / sessionStorage
 * - REFUSE requests over plain http:// unless the host is localhost
 *   (NFR-01 — TLS minimum). The check fires at module load time so a
 *   misconfigured build fails fast.
 */

import {
  requestCompromisedFlow,
  requestEnrollment,
  requestStepUp,
} from '../auth/stepUp';

const buildTimeBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';

if (buildTimeBase) {
  const url = new URL(buildTimeBase, window.location.href);
  const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol === 'http:' && !isLoopback) {
    throw new Error(
      `secrets-bridge/ui: VITE_API_BASE_URL=${buildTimeBase} is http:// for a non-localhost host. ` +
        `TLS is required per NFR-01. Use https:// or build with the dev override.`
    );
  }
}

/**
 * Slice C: the auth-token / identity providers are no-ops kept ONLY
 * for back-compat with consumers that still call them during the
 * transition. They MUST be removed once every caller has been
 * audited. The cookie set by the api is the real auth surface; no
 * provider runs in this file.
 */
export type AuthTokenProvider = () => string | null;
export type IdentityProvider = () => string | null;

export function setAuthTokenProvider(_p: AuthTokenProvider): void {
  // no-op — Bearer token path removed in Slice C
}

export function setIdentityProvider(_p: IdentityProvider): void {
  // no-op — X-User-Id header removed in Slice C
}

export class ApiError extends Error {
  status: number;
  body?: unknown;
  // Slice D — set when the api returned 401 with
  // `WWW-Authenticate: step-up ...`. Callers detect this to redirect
  // through /auth/oidc/start?step_up=mfa instead of dropping the
  // user to the login page.
  stepUp: boolean;
  constructor(status: number, message: string, body?: unknown, stepUp = false) {
    super(message);
    this.status = status;
    this.body = body;
    this.stepUp = stepUp;
  }
}

/**
 * Redirect the browser to the api's OIDC step-up flow. Used by
 * handlers that catch a step-up ApiError; the IdP re-prompts for
 * MFA and the callback stamps `last_mfa_at` on the same session
 * row (no new cookie). After the IdP round trip the SPA lands back
 * on `returnTo` and the caller can retry.
 *
 * Same-origin builds: a relative URL is fine. Cross-origin builds
 * (api on a different host than the SPA) use the VITE_API_BASE_URL.
 */
export function redirectToStepUp(returnTo?: string): void {
  const target =
    returnTo ?? window.location.pathname + window.location.search + window.location.hash;
  const params = new URLSearchParams({ step_up: 'mfa', return_to: target });
  const base = buildTimeBase ? buildTimeBase.replace(/\/$/, '') : '';
  window.location.href = `${base}/api/v1/auth/oidc/start?${params.toString()}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}, attempt = 0): Promise<T> {
  if (!path.startsWith('/api/')) {
    throw new Error(`API path must start with /api/: ${path}`);
  }
  const url = buildTimeBase ? buildTimeBase.replace(/\/$/, '') + path : path;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...opts.headers,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const resp = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    // Slice C: cookie carries auth. 'include' so the cookie crosses
    // origins on cross-origin dev (Vite on :5173 + api on :8080) and
    // is a safe no-op on same-origin prod where the cookie is sent
    // anyway. Required to be paired with the api's CORS config in
    // cross-origin deployments.
    credentials: 'include',
    signal: opts.signal,
  });

  if (resp.status === 204) return undefined as T;

  const text = await resp.text();
  let parsed: unknown = undefined;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!resp.ok) {
    let message = `HTTP ${resp.status}`;
    if (parsed && typeof parsed === 'object') {
      const obj = parsed as { message?: unknown; error?: unknown };
      if (typeof obj.message === 'string') message = obj.message;
      else if (typeof obj.error === 'string') message = obj.error;
    }
    // Slice D — detect the api's step-up challenge so the calling
    // mutation can redirect through /auth/oidc/start?step_up=mfa
    // rather than showing the user a generic "unauthorized" toast.
    const stepUp =
      resp.status === 401 &&
      (resp.headers.get('WWW-Authenticate') ?? '').toLowerCase().includes('step-up');
    const apiErr = new ApiError(resp.status, message, parsed, stepUp);

    // Step-up: await the modal flow. On 'verified', RE-ISSUE the
    // original request so the caller's await resolves with the
    // success value as if MFA never happened. On 'cancelled', fall
    // through to throw so the dialog can show the inline error.
    // `attempt === 0` guards against an infinite retry loop in the
    // pathological case where the api still 401-step-ups after a
    // successful verify.
    if (apiErr.stepUp && attempt === 0) {
      const outcome = await requestStepUp();
      if (outcome === 'verified') {
        return request<T>(path, opts, attempt + 1);
      }
      throw apiErr;
    }

    // Non-step-up MFA-shaped errors navigate away (enrollment to
    // /me/mfa; compromised to /login). Fire-and-forget routing,
    // then throw so the caller still sees the error.
    routeNonStepUpSignals(apiErr);
    throw apiErr;
  }
  return parsed as T;
}

/**
 * Route the two MFA-shaped errors that DON'T retry through the SPA
 * singletons before the caller's try/catch sees them.
 *
 * Step-up (`401 + WWW-Authenticate: step-up`) is handled inline in
 * `request()` because it's the only one that can RECOVER without
 * leaving the page — modal opens, user verifies, request retries.
 * The other two navigate away (enrollment → /me/mfa, compromised →
 * /login) so there's nothing to await — fire-and-forget routing,
 * then the original error still throws so the caller sees it.
 *
 * Lives in this layer (not in TanStack onError) so direct fetch
 * helpers (e.g. `revealWrap`) trigger the same SPA-wide flow as
 * hooked calls — single source of truth for MFA error routing.
 */
function routeNonStepUpSignals(err: ApiError): void {
  const message = (err.message ?? '').toLowerCase();
  if (err.status === 412 && message.includes('mfa_enrollment_required')) {
    requestEnrollment();
    return;
  }
  if (err.status === 401 && message.includes('factor_compromised')) {
    requestCompromisedFlow();
  }
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body }),
  delete: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'DELETE' }),
};
