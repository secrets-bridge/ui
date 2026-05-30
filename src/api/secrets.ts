/**
 * Discovered-secrets API surface.
 *
 *   GET /api/v1/secrets       — list with filter
 *   GET /api/v1/secrets/:id   — single secret (rare; the list usually
 *                                carries enough)
 *
 * Agents POPULATE this table via their discovery executors (BRD §16
 * Piece 6). The CP upserts on (cluster_name, provider_type, secret_ref)
 * so a re-discovery refreshes labels + version + last_seen_at without
 * losing the first_seen_at history. The worker's `secrets-stale`
 * sweeper flips rows whose last_seen_at is older than the cutoff to
 * `missing` so the UI can show them as "was here once, gone now"
 * rather than dropping them silently.
 *
 * Hard-rule reminder: this metadata API never carries plaintext.
 * `labels` is the operator's own custom_metadata / Tags from the
 * provider (Environment, Team, PII, etc.) — surfaced verbatim so the
 * UI's filter chips match what the team set in Vault / AWS / etc.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from './client';

export interface Secret {
  id: string;
  cluster_name: string;
  provider_type: string;
  secret_ref: string;
  provider_config?: Record<string, unknown>;
  labels: Record<string, unknown>;
  version?: string;
  checksum?: string;
  created_at_source?: string;
  updated_at_source?: string;
  status: 'present' | 'missing';
  first_seen_at: string;
  last_seen_at: string;
}

export interface SecretsListResponse {
  items: Secret[];
  total: number;
}

/**
 * Filter knobs for the list endpoint. The api also accepts
 * `?label=key:value` repeated for each label predicate; we model them
 * as an array of `key:value` strings here so the UI can collapse the
 * URL search.
 */
export interface SecretsFilter {
  cluster_name?: string;
  provider?: string;
  ref_prefix?: string;
  status?: '' | 'present' | 'missing';
  labels?: string[];
  /**
   * Multi-tenancy narrow (api#43 Slice B). Optional for admins; for
   * scoped callers it must be in their `useMyProjects()` set or the
   * server returns 403. Empty string is dropped.
   */
  project_id?: string;
  limit?: number;
  offset?: number;
}

export const secretsKey = {
  all: ['secrets'] as const,
  list: (filter: SecretsFilter) => ['secrets', 'list', filter] as const,
  one: (id: string) => ['secrets', 'one', id] as const,
};

export function useSecrets(filter: SecretsFilter = {}) {
  const qs = new URLSearchParams();
  if (filter.cluster_name) qs.set('cluster_name', filter.cluster_name);
  if (filter.provider) qs.set('provider', filter.provider);
  if (filter.ref_prefix) qs.set('ref_prefix', filter.ref_prefix);
  if (filter.status) qs.set('status', filter.status);
  for (const l of filter.labels ?? []) {
    if (l) qs.append('label', l);
  }
  if (filter.project_id) qs.set('project_id', filter.project_id);
  if (filter.limit !== undefined) qs.set('limit', String(filter.limit));
  if (filter.offset !== undefined) qs.set('offset', String(filter.offset));
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: secretsKey.list(filter),
    queryFn: () => api.get<SecretsListResponse>(`/api/v1/secrets${suffix}`),
  });
}
