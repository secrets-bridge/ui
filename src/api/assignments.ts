/**
 * User-role assignments API surface (BRD §17 — `user_roles` table).
 *
 * Consumed by:
 *   - the Assignments admin page (this slice)
 *   - the future Request submission page (filtering targets by
 *     "what does this user have scope to ask for?")
 *
 * The flat-list endpoint (api#35) drives the admin table. Per-user
 * filtering happens client-side for now (table is small).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type { UserRole, UserRoleInput } from './types';

export const userRolesKey = {
  all: ['user-roles'] as const,
};

export function useUserRoles() {
  return useQuery({
    queryKey: userRolesKey.all,
    queryFn: () => api.get<UserRole[]>('/api/v1/user-roles'),
  });
}

export function useGrantUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UserRoleInput) => api.post<UserRole>('/api/v1/user-roles', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: userRolesKey.all }),
  });
}

export function useRevokeUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/user-roles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: userRolesKey.all }),
  });
}
