/**
 * Slice L4 — typed surface for the new dev-facing per-env endpoints
 * (api#80):
 *
 *   GET  /projects/:id/environments/:env_id/secrets
 *   POST /projects/:id/environments/:env_id/request
 *   POST /projects/:id/environments/:env_id/direct-reveal
 *
 * Hard rule: NONE of these responses carry secret values. The list
 * endpoint returns key NAMES only; the two submit endpoints return
 * a `request_id` that the SPA polls for wraps separately.
 */

import { useMutation, useQuery } from '@tanstack/react-query';

import { api } from './client';

/**
 * One row returned by the env-secrets list. When `key_name` is empty,
 * the binding allows EVERY key on the secret; the SPA renders it as
 * a "(all keys)" marker.
 */
export interface EnvSecretKey {
  secret_id: string;
  secret_ref: string;
  provider_type: string;
  key_name: string;
  allowed_ops: string[];
}

export interface DevRequestBody {
  target_provider_type: string;
  target_provider_config?: Record<string, unknown>;
  target_secret_ref: string;
  target_keys?: string[];
  justification: string;
}

export interface DevRequestResponse {
  request_id: string;
  status: string;
  /** True when the response describes an auto-executed direct-reveal request. */
  direct_reveal?: boolean;
}

export const devSecretsKey = {
  all: ['dev-secrets'] as const,
  byEnv: (projectId: string, envId: string) =>
    ['dev-secrets', 'env', projectId, envId] as const,
};

/** Lists key names bound to (project, env). VALUE-FREE. */
export function useEnvSecrets(projectId: string | undefined, envId: string | undefined) {
  return useQuery({
    queryKey: devSecretsKey.byEnv(projectId ?? '', envId ?? ''),
    queryFn: () =>
      api.get<EnvSecretKey[]>(
        `/api/v1/projects/${projectId}/environments/${envId}/secrets`
      ),
    enabled: Boolean(projectId && envId),
    staleTime: 30_000,
  });
}

/** Submits a normal read request — standard approval lifecycle applies. */
export function useSubmitEnvRequest(projectId: string, envId: string) {
  return useMutation({
    mutationFn: (body: DevRequestBody) =>
      api.post<DevRequestResponse>(
        `/api/v1/projects/${projectId}/environments/${envId}/request`,
        body
      ),
  });
}

/**
 * Submits an auto-executed direct-reveal request. The api enforces:
 *   - permission `secret.reveal.direct` (route-level)
 *   - env.kind != 'prod' (server-side hard check)
 *   - matched policy.direct_reveal_allowed === true
 *
 * PROD env → 403 with `direct reveal is not permitted on prod`.
 * Policy denied → 403 with `matched policy does not permit direct reveal`.
 */
export function useDirectReveal(projectId: string, envId: string) {
  return useMutation({
    mutationFn: (body: DevRequestBody) =>
      api.post<DevRequestResponse>(
        `/api/v1/projects/${projectId}/environments/${envId}/direct-reveal`,
        body
      ),
  });
}
