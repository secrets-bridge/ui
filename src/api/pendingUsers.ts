/**
 * Accounts waiting for an admin's approval (api#266).
 *
 *   GET  /api/v1/users/pending        oldest first, with a total for the badge
 *   POST /api/v1/users/:id/approve    { role_id, scope? }: grant the role, let the account act
 *   POST /api/v1/users/:id/decline    disable a waiting account
 *
 * All three need a global user_role.edit.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { userRolesKey } from './assignments';
import { api } from './client';

export interface PendingUser {
  id: string;
  email: string;
  display_name: string;
  waiting_since: string;
}

export interface PendingUsers {
  users: PendingUser[];
  // Every waiting account; users holds at most 100.
  total: number;
}

export const pendingUsersKey = { all: ['users', 'pending'] as const };

export function usePendingUsers(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: pendingUsersKey.all,
    queryFn: () => api.get<PendingUsers>('/api/v1/users/pending'),
    enabled: opts.enabled ?? true,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

export interface ApproveInput {
  id: string;
  role_id: string;
  scope?: Record<string, string>;
}

export function useApproveUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ApproveInput) => api.post<void>(`/api/v1/users/${id}/approve`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pendingUsersKey.all });
      void qc.invalidateQueries({ queryKey: userRolesKey.all });
    },
  });
}

export function useDeclineUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/api/v1/users/${id}/decline`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pendingUsersKey.all });
    },
  });
}
