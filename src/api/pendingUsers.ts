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
import { ApiError, api } from './client';

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

/**
 * True when the api refused the list: the caller's user_role.edit is
 * only scoped to a team or project, and the list needs it globally.
 * The permissions on /users/me don't carry scopes, so the console only
 * learns this from the 403.
 */
export function pendingForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.status === 403;
}

/**
 * Whether to retry /users/pending after `failures` failed tries: only a
 * server error (5xx) or a request that didn't get an answer (network),
 * up to three times. A 4xx won't change by asking again, and retrying a
 * 429 makes the rate limit worse.
 */
export function retryPendingList(failures: number, err: unknown): boolean {
  if (failures >= 3) return false;
  return !(err instanceof ApiError) || err.status >= 500;
}

export function usePendingUsers(opts: { enabled?: boolean } = {}) {
  // After a 403 the cached error stays, and nothing refetches it: no
  // retry, no retry when another component mounts the query (the nav
  // and Overview both do), and no refetch on focus, mount or reconnect.
  // Otherwise a team-scoped admin would get a 403 on every focus. A 5xx
  // or a network error is retried up to three times (retryPendingList),
  // other errors not at all; they're tried again on the next focus.
  const again = (q: { state: { error: unknown } }) => !pendingForbidden(q.state.error);
  return useQuery({
    queryKey: pendingUsersKey.all,
    queryFn: () => api.get<PendingUsers>('/api/v1/users/pending'),
    enabled: opts.enabled ?? true,
    staleTime: 10_000,
    retry: retryPendingList,
    retryOnMount: false,
    refetchOnWindowFocus: again,
    refetchOnMount: again,
    refetchOnReconnect: again,
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
