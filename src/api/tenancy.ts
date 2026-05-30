/**
 * Tenancy API surface — projects + environments (BRD §17).
 *
 * Used by:
 *   - the Projects admin page (this slice)
 *   - the Integrations form's environment dropdown (pattern-2 scoping
 *     for ArgoCD endpoints — landed when the form updates to bind
 *     endpoints to env_ids)
 *   - the future Assignments form's scope picker
 *
 * Cache strategy: projects + environments change rarely; staleTime 30s
 * matches the global QueryClient default. Every mutation invalidates
 * the matching list query.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type {
  Environment,
  EnvironmentInput,
  MyProject,
  Project,
  ProjectInput,
  ProjectSecretBinding,
  ProjectSecretBindingInput,
  ProjectSecretBindingUpdate,
} from './types';

// --- projects --------------------------------------------------------

export const projectsKey = {
  all: ['projects'] as const,
  one: (id: string) => ['projects', id] as const,
  environmentsFor: (id: string) => ['projects', id, 'environments'] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: projectsKey.all,
    queryFn: () => api.get<Project[]>('/api/v1/projects'),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: id ? projectsKey.one(id) : projectsKey.all,
    queryFn: () => api.get<Project>(`/api/v1/projects/${id}`),
    enabled: !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectInput) => api.post<Project>('/api/v1/projects', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey.all }),
  });
}

/**
 * Toggle a project between `active` and `archived`. There is no
 * hard-delete endpoint by design — archival keeps historical
 * references valid.
 */
export function useUpdateProjectStatus(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: 'active' | 'archived') =>
      api.put<void>(`/api/v1/projects/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: projectsKey.all }),
  });
}

export function useEnvironmentsForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectsKey.environmentsFor(projectId) : projectsKey.all,
    queryFn: () => api.get<Environment[]>(`/api/v1/projects/${projectId}/environments`),
    enabled: !!projectId,
  });
}

// --- environments ----------------------------------------------------

export const environmentsKey = {
  all: ['environments'] as const,
  one: (id: string) => ['environments', id] as const,
};

export function useEnvironments() {
  return useQuery({
    queryKey: environmentsKey.all,
    queryFn: () => api.get<Environment[]>('/api/v1/environments'),
  });
}

export function useCreateEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: EnvironmentInput) =>
      api.post<Environment>('/api/v1/environments', body),
    onSuccess: (_, body) => {
      qc.invalidateQueries({ queryKey: environmentsKey.all });
      qc.invalidateQueries({ queryKey: projectsKey.environmentsFor(body.project_id) });
    },
  });
}

export function useDeleteEnvironment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string; projectId?: string }) =>
      api.delete<void>(`/api/v1/environments/${id}`),
    onSuccess: (_, { projectId }) => {
      qc.invalidateQueries({ queryKey: environmentsKey.all });
      if (projectId) {
        qc.invalidateQueries({ queryKey: projectsKey.environmentsFor(projectId) });
      }
    },
  });
}

// --- project ↔ secret bindings (api#43 Slice A) ----------------------

export const projectSecretsKey = {
  forProject: (projectId: string) => ['projects', projectId, 'secrets'] as const,
};

export function useProjectSecrets(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectSecretsKey.forProject(projectId) : ['projects'],
    queryFn: () =>
      api.get<ProjectSecretBinding[]>(`/api/v1/projects/${projectId}/secrets`),
    enabled: !!projectId,
  });
}

export function useBindProjectSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProjectSecretBindingInput) =>
      api.post<ProjectSecretBinding>(
        `/api/v1/projects/${projectId}/secrets`,
        body,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: projectSecretsKey.forProject(projectId) }),
  });
}

export function useUpdateProjectSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ secretId, body }: { secretId: string; body: ProjectSecretBindingUpdate }) =>
      api.put<ProjectSecretBinding>(
        `/api/v1/projects/${projectId}/secrets/${secretId}`,
        body,
      ),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: projectSecretsKey.forProject(projectId) }),
  });
}

export function useUnbindProjectSecret(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ secretId }: { secretId: string }) =>
      api.delete<void>(`/api/v1/projects/${projectId}/secrets/${secretId}`),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: projectSecretsKey.forProject(projectId) }),
  });
}

// --- /users/me/projects (api#43 Slice D) ----------------------------

export const myProjectsKey = ['users', 'me', 'projects'] as const;

/**
 * The caller's accessible projects. Drives the project switcher in
 * /secrets + the submit-request drawer. Admin callers see every
 * project; scoped callers see only their granted set.
 */
export function useMyProjects() {
  return useQuery({
    queryKey: myProjectsKey,
    queryFn: () => api.get<MyProject[]>('/api/v1/users/me/projects'),
  });
}
