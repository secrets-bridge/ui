/**
 * Integrations API surface (BRD §26 — read-only GitOps visibility).
 *
 * Two related entities:
 *   - ArgoCD endpoints  → connection metadata + write-once token
 *   - GitOps app mappings → bind an ArgoCD app to a secret-mapping
 *
 * Both are gated server-side on `SB_GITOPS_ENABLED`. When the flag is
 * OFF, the routes literally aren't mounted; calls return Fiber's
 * default 404. The Integrations admin page detects that via the list
 * query's error path and renders a "feature disabled" banner instead
 * of an empty table.
 *
 * Mutation strategy: every mutation invalidates the matching list
 * query key, so views refresh without a manual refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type {
  ArgoCDEndpoint,
  ArgoCDEndpointInput,
  DiscoveredApp,
  GitOpsAppMapping,
  GitOpsAppMappingInput,
} from './types';

// --- ArgoCD endpoints ------------------------------------------------

export const argocdEndpointsKey = {
  all: ['argocd-endpoints'] as const,
  one: (id: string) => ['argocd-endpoints', id] as const,
};

export function useArgoCDEndpoints() {
  return useQuery({
    queryKey: argocdEndpointsKey.all,
    queryFn: () => api.get<ArgoCDEndpoint[]>('/api/v1/argocd-endpoints'),
    retry: false, // 404 = feature disabled; don't pound the endpoint
  });
}

export function useCreateArgoCDEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ArgoCDEndpointInput) =>
      api.post<ArgoCDEndpoint>('/api/v1/argocd-endpoints', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: argocdEndpointsKey.all }),
  });
}

export function useSetArgoCDEndpointEnabled(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<void>(`/api/v1/argocd-endpoints/${id}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: argocdEndpointsKey.all }),
  });
}

export function useDeleteArgoCDEndpoint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/argocd-endpoints/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: argocdEndpointsKey.all }),
  });
}

// --- GitOps app mappings --------------------------------------------

export const gitopsAppMappingsKey = {
  all: ['gitops-app-mappings'] as const,
  one: (id: string) => ['gitops-app-mappings', id] as const,
};

// --- discovered apps (read-through to ArgoCD) -----------------------

export const discoveredAppsKey = {
  for: (endpointId: string, project: string) =>
    ['argocd-endpoints', endpointId, 'discovered-apps', project] as const,
};

/**
 * Discover apps under an ArgoCD endpoint. **On-demand**: the query
 * starts disabled and only fires once the operator explicitly opens
 * the discover panel (the page passes `enabled=true` at that point).
 *
 * The api returns 503 when the endpoint is disabled or the upstream
 * call fails. We surface that as a friendly banner rather than retry.
 */
export function useDiscoveredApps(
  endpointId: string,
  project: string,
  options: { enabled: boolean } = { enabled: false },
) {
  return useQuery({
    queryKey: discoveredAppsKey.for(endpointId, project),
    queryFn: () =>
      api.get<DiscoveredApp[]>(
        `/api/v1/argocd-endpoints/${endpointId}/discovered-apps${
          project ? `?project=${encodeURIComponent(project)}` : ''
        }`,
      ),
    enabled: options.enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function useGitOpsAppMappings() {
  return useQuery({
    queryKey: gitopsAppMappingsKey.all,
    queryFn: () => api.get<GitOpsAppMapping[]>('/api/v1/gitops-app-mappings'),
    retry: false,
  });
}

export function useCreateGitOpsAppMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: GitOpsAppMappingInput) =>
      api.post<GitOpsAppMapping>('/api/v1/gitops-app-mappings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: gitopsAppMappingsKey.all }),
  });
}

export function useDeleteGitOpsAppMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/gitops-app-mappings/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gitopsAppMappingsKey.all }),
  });
}
