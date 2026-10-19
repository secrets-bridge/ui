/**
 * Signing in with Google set up from the console (api#265, api#267).
 *
 *   GET    /api/v1/sso/providers, /:id      admin (auth.sso.edit)
 *   POST   /api/v1/sso/providers            create, disabled (carries the client secret)
 *   PUT    /api/v1/sso/providers/:id        edit (not the secret, not enabled)
 *   PUT    /api/v1/sso/providers/:id/secret replace the secret
 *   POST   /api/v1/sso/providers/:id/enable | /disable
 *   DELETE /api/v1/sso/providers/:id
 *   POST   /api/v1/sso/providers/:id/test   begin a test round trip
 *   GET    /api/v1/sso/settings, PUT        public address and waiting cap
 *   GET    /api/v1/auth/providers           public: the login page's options
 *   POST   /api/v1/auth/sso/:type/connect   begin Connect Google
 *   POST   /api/v1/auth/sso/:type/finish    redeem a Connect or Test ticket
 *   GET    /api/v1/users/me/identities, DELETE /:type
 *
 * Every write needs a fresh second factor; client.ts runs the step-up
 * and retries. The client secret only ever travels in a sensitive
 * mutation and is never returned (client_secret_set).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, sanitizeRedirectTarget } from './client';
import { meKey } from './me';
import { useSensitiveMutation } from './sensitiveMutation';

export interface SSOProvider {
  id: string;
  type: 'google';
  display_name: string;
  client_id: string;
  client_secret_set: boolean;
  allowed_domains: string[];
  require_approval: boolean;
  default_role_id: string | null;
  enabled: boolean;
  // Empty until the install's public address is set.
  redirect_url: string;
  created_at: string;
  updated_at: string;
}

export interface SSOProviderInput {
  type?: 'google';
  display_name?: string;
  client_id: string;
  client_secret?: string;
  allowed_domains: string[];
  require_approval: boolean;
  default_role_id?: string | null;
}

export interface SSOSettings {
  public_url: string;
  // 'env' when SB_PUBLIC_URL sets it (read-only here), 'console' when
  // saved here, '' when unset.
  public_url_source: '' | 'env' | 'console';
  pending_cap: number;
}

export interface SignInOption {
  type: string;
  display_name: string;
  start_url: string;
}

export interface ConnectedIdentity {
  provider_type: string;
  email: string;
  linked_at: string;
}

export interface FinishResult {
  purpose: 'link' | 'test';
  result: 'linked' | 'ok' | 'failed';
  reason?: string;
}

// The only permissions a provider's default role may hold (the api
// enforces the same list).
export const NON_PRIVILEGED_PERMISSIONS = ['secret.list', 'secret.request', 'audit.read'];

export const ssoKey = {
  providers: ['sso', 'providers'] as const,
  settings: ['sso', 'settings'] as const,
  signInOptions: ['sso', 'sign-in-options'] as const,
  identities: ['sso', 'identities'] as const,
};

export function useSSOProviders(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ssoKey.providers,
    queryFn: () => api.get<SSOProvider[]>('/api/v1/sso/providers'),
    enabled: opts.enabled ?? true,
  });
}

export function useSSOSettings(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ssoKey.settings,
    queryFn: () => api.get<SSOSettings>('/api/v1/sso/settings'),
    enabled: opts.enabled ?? true,
  });
}

function useInvalidateSSO() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['sso'] });
  };
}

export function useCreateSSOProvider() {
  const invalidate = useInvalidateSSO();
  return useSensitiveMutation({
    mutationFn: (body: SSOProviderInput) => api.post<SSOProvider>('/api/v1/sso/providers', { type: 'google', ...body }),
    onSuccess: invalidate,
  });
}

export function useUpdateSSOProvider(id: string) {
  const invalidate = useInvalidateSSO();
  return useMutation({
    mutationFn: (body: SSOProviderInput) => api.put<SSOProvider>(`/api/v1/sso/providers/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useReplaceSSOSecret(id: string) {
  const invalidate = useInvalidateSSO();
  return useSensitiveMutation({
    mutationFn: (clientSecret: string) =>
      api.put<void>(`/api/v1/sso/providers/${id}/secret`, { client_secret: clientSecret }),
    onSuccess: invalidate,
  });
}

export function useSetSSOProviderEnabled(id: string) {
  const invalidate = useInvalidateSSO();
  return useMutation({
    mutationFn: (enabled: boolean) => api.post<void>(`/api/v1/sso/providers/${id}/${enabled ? 'enable' : 'disable'}`),
    onSuccess: invalidate,
  });
}

export function useDeleteSSOProvider(id: string) {
  const invalidate = useInvalidateSSO();
  return useMutation({
    mutationFn: () => api.delete<void>(`/api/v1/sso/providers/${id}`),
    onSuccess: invalidate,
  });
}

export function useUpdateSSOSettings() {
  const invalidate = useInvalidateSSO();
  return useMutation({
    mutationFn: (body: { public_url?: string; pending_cap?: number }) =>
      api.put<SSOSettings>('/api/v1/sso/settings', body),
    onSuccess: invalidate,
  });
}

/** Begins a Test round trip; the caller sends the browser to redirect_url. */
export function useStartSSOTest(id: string) {
  return useMutation({
    mutationFn: () => api.post<{ redirect_url: string }>(`/api/v1/sso/providers/${id}/test`),
  });
}

/** The login page's sign-in options. Public; null when the api is older. */
export function useSignInOptions() {
  return useQuery({
    queryKey: ssoKey.signInOptions,
    queryFn: () => api.get<{ providers: SignInOption[] }>('/api/v1/auth/providers').then((r) => r.providers),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useMyIdentities() {
  return useQuery({
    queryKey: ssoKey.identities,
    queryFn: () => api.get<ConnectedIdentity[]>('/api/v1/users/me/identities'),
  });
}

/** Begins Connect Google; the caller sends the browser to redirect_url. */
export function useConnectProvider(type: string) {
  return useMutation({
    mutationFn: () => api.post<{ redirect_url: string }>(`/api/v1/auth/sso/${type}/connect`),
  });
}

export function useDisconnectProvider(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete<void>(`/api/v1/users/me/identities/${type}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKey.identities });
      void qc.invalidateQueries({ queryKey: meKey.all });
    },
  });
}

/** Redeems a Connect or Test ticket on this session. */
export function useFinishSSO(type: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ticket: string) => api.post<FinishResult>(`/api/v1/auth/sso/${type}/finish`, { ticket }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ssoKey.identities });
    },
  });
}

/** Reads `#sso_ticket=…` from the URL and removes it from history. */
const SSO_RETURN_KEY = 'sb.sso.return';

/**
 * Remember the page a Connect or Test round trip starts from. If the
 * round trip fails before the api knows which one it was (it took too
 * long, or finished in another browser), the browser lands on
 * /login?error=sso, and "Back to the console" goes back here. Only a
 * path, never anything secret; per tab, and safe to lose.
 */
export function rememberSSOReturn(path: string): void {
  try {
    window.sessionStorage.setItem(SSO_RETURN_KEY, path);
  } catch {
    // Storage refused: the way back falls back to the overview.
  }
}

/** The page a failed round trip started from (once), or '/'. */
export function takeSSOReturn(): string {
  let path: string | null = null;
  try {
    path = window.sessionStorage.getItem(SSO_RETURN_KEY);
    window.sessionStorage.removeItem(SSO_RETURN_KEY);
  } catch {
    // Storage refused.
  }
  return sanitizeRedirectTarget(path);
}

export function takeTicketFromHash(): string | null {
  const m = /(?:^#|&)sso_ticket=([A-Za-z0-9_-]+)/.exec(window.location.hash);
  if (!m) return null;
  // The round trip came back with a result, so the way back for a
  // failed one isn't needed.
  takeSSOReturn();
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return m[1];
}
