/**
 * EPIC Q (api#99) Slice Q3 — project-anchored scoped binding hooks.
 *
 *   GET    /api/v1/projects/:id/provider-connection-bindings[?environment_id=...]
 *   POST   /api/v1/projects/:id/provider-connection-bindings
 *   DELETE /api/v1/projects/:id/provider-connection-bindings/:bid
 *
 * These routes are gated server-side by integration.bind scoped to
 * (project, env). Admin (integration.edit) callers use the EPIC P
 * admin URLs in `./providerConnections.ts` directly.
 *
 * Cache invariant per §5: every mutation invalidates BOTH the
 * project-bindings key AND the cross-team developer dropdown key so
 * the binder card + dropdown + admin list all refresh on the same tick.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { providerConnectionsKey } from './providerConnections';
import type {
  ProjectProviderConnectionBinding,
  ProjectProviderConnectionBindingInput,
  ProviderConnectionSummary,
} from './types';

export const projectBindingsKey = {
  all: ['project-provider-connection-bindings'] as const,
  list: (projectID: string, envID?: string) =>
    ['project-provider-connection-bindings', projectID, envID ?? 'all'] as const,
  picker: (projectID: string, envID: string) =>
    ['provider-connections-binding-picker', projectID, envID] as const,
};

const invalidateAfterBindMutation = (
  qc: ReturnType<typeof useQueryClient>,
  projectID: string,
  envID: string,
) => {
  qc.invalidateQueries({ queryKey: projectBindingsKey.all });
  qc.invalidateQueries({ queryKey: providerConnectionsKey.all });
  // Cross-team developer dropdown — newly bound conn should appear.
  qc.invalidateQueries({ queryKey: ['provider-connections'] });
  // Picker — newly bound conn should disappear.
  qc.invalidateQueries({ queryKey: projectBindingsKey.picker(projectID, envID) });
};

/**
 * List bindings for a project, optionally narrowed to one environment
 * (env-specific + project-wide for that env).
 */
export function useProjectBindings(projectID: string | undefined, envID?: string) {
  return useQuery({
    queryKey: projectBindingsKey.list(projectID ?? '', envID),
    queryFn: () => {
      const qs = envID ? `?environment_id=${encodeURIComponent(envID)}` : '';
      return api.get<ProjectProviderConnectionBinding[]>(
        `/api/v1/projects/${encodeURIComponent(projectID!)}/provider-connection-bindings${qs}`,
      );
    },
    enabled: !!projectID,
    staleTime: 30_000,
  });
}

/**
 * Binder picker — calls the EPIC P shared GET with `for_binding=true`.
 * Returns sanitized {id, name, type} of active + self_service_bindable
 * + NOT-already-bound (env-specific or project-wide) connections.
 *
 * Server returns 403 prod_binding_not_allowed_for_scope for prod envs;
 * caller should hide the CTA in that case via the capability helper.
 */
export function useBindableConnections(
  projectID: string | undefined,
  envID: string | undefined,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: projectBindingsKey.picker(projectID ?? '', envID ?? ''),
    queryFn: () => {
      const qs = new URLSearchParams();
      qs.set('for_binding', 'true');
      qs.set('project_id', projectID!);
      qs.set('environment_id', envID!);
      return api.get<ProviderConnectionSummary[]>(
        `/api/v1/provider-connections?${qs.toString()}`,
      );
    },
    enabled: (opts?.enabled ?? true) && !!projectID && !!envID,
    staleTime: 30_000,
  });
}

export function useBindToProject(projectID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectProviderConnectionBindingInput) =>
      api.post<ProjectProviderConnectionBinding>(
        `/api/v1/projects/${encodeURIComponent(projectID)}/provider-connection-bindings`,
        body,
      ),
    onSuccess: (_data, vars) =>
      invalidateAfterBindMutation(qc, projectID, vars.environment_id),
  });
}

export function useUnbindFromProject(projectID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { bindingID: string; envID: string }) =>
      api.delete<void>(
        `/api/v1/projects/${encodeURIComponent(projectID)}/provider-connection-bindings/${encodeURIComponent(vars.bindingID)}`,
      ),
    onSuccess: (_data, vars) =>
      invalidateAfterBindMutation(qc, projectID, vars.envID),
  });
}
