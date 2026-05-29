/**
 * API client for the secrets-bridge Control Plane.
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

export type AuthTokenProvider = () => string | null;
export type IdentityProvider = () => string | null;

let currentToken: AuthTokenProvider = () => null;
let currentIdentity: IdentityProvider = () => null;

/**
 * Wire the auth token source. Called by AuthContext on login / logout.
 * Token MUST live in memory only — NEVER persisted to localStorage.
 */
export function setAuthTokenProvider(p: AuthTokenProvider) {
  currentToken = p;
}

/**
 * Wire the identity source. Today the api gates admin write endpoints
 * by reading `X-User-Id` (stub identity, NOT a security boundary —
 * swaps to OIDC `sub` claim when api#26 lands). The client injects it
 * automatically when an identity is signed in.
 */
export function setIdentityProvider(p: IdentityProvider) {
  currentIdentity = p;
}

export class ApiError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  if (!path.startsWith('/api/')) {
    throw new Error(`API path must start with /api/: ${path}`);
  }
  const url = buildTimeBase ? buildTimeBase.replace(/\/$/, '') + path : path;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...opts.headers,
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const token = currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const userId = currentIdentity();
  if (userId && !headers['X-User-Id']) headers['X-User-Id'] = userId;

  const resp = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
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
    throw new ApiError(resp.status, message, parsed);
  }
  return parsed as T;
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
