/**
 * Roles API surface — wraps GET / POST / PUT / DELETE against
 * /api/v1/roles. Each function returns a TanStack Query key alongside
 * the network call so callers stay consistent.
 *
 * IMPORTANT api constraint (mirrors `internal/handlers/admin.go`):
 * after create, ONLY the permission list can be mutated. There is no
 * generic `PUT /roles/:id` for renaming or re-describing — the only
 * mutation endpoint is `PUT /roles/:id/permissions`. The form respects
 * this by making name + description read-only in edit mode.
 *
 * Mutation strategy: every mutation invalidates `rolesKey.all` so the
 * list view picks up changes without a manual refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type { Role, RoleCreateInput, RolePermissionsInput } from './types';

export const rolesKey = {
  all: ['roles'] as const,
  one: (id: string) => ['roles', id] as const,
};

export function useRoles() {
  return useQuery({
    queryKey: rolesKey.all,
    queryFn: () => api.get<Role[]>('/api/v1/roles'),
  });
}

export function useRole(id: string | undefined) {
  return useQuery({
    queryKey: id ? rolesKey.one(id) : rolesKey.all,
    queryFn: () => api.get<Role>(`/api/v1/roles/${id}`),
    enabled: !!id,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RoleCreateInput) => api.post<Role>('/api/v1/roles', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKey.all }),
  });
}

/**
 * Edit-mode mutation. The api ONLY exposes permission updates — name
 * and description are immutable after create. Callers must hide / lock
 * those inputs in the form when an `initial` role is provided.
 */
export function useUpdateRole(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RolePermissionsInput) =>
      api.put<void>(`/api/v1/roles/${id}/permissions`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKey.all }),
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: rolesKey.all }),
  });
}
