/**
 * Policies API surface — wraps GET / POST / PUT / DELETE against
 * /api/v1/policies. Each function returns a TanStack Query key
 * alongside the network call so callers stay consistent.
 *
 * Full-mutation entity (unlike Roles): the api accepts the same body
 * shape for POST and PUT, including selector + workflow_id + priority
 * + enabled changes.
 *
 * Mutation strategy: every mutation invalidates `policiesKey.all` so
 * the list view picks up changes without a manual refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { policyRuleHistoryKey } from './policyRuleHistory';
import type { Policy, PolicyInput } from './types';

/** R-follow-up #5 §5 D3 — broad history-tree invalidate on every
 *  admin mutation. Same rationale as the scoped paths' 6-key
 *  invariant: any mutation may add a new event to a rule whose
 *  history view isn't currently mounted. */
const invalidateAfterAdminPolicyMutation = (
  qc: ReturnType<typeof useQueryClient>,
) => {
  qc.invalidateQueries({ queryKey: policiesKey.all });
  qc.invalidateQueries({ queryKey: policyRuleHistoryKey.base });
};

export const policiesKey = {
  all: ['policies'] as const,
  one: (id: string) => ['policies', id] as const,
};

export function usePolicies() {
  return useQuery({
    queryKey: policiesKey.all,
    queryFn: () => api.get<Policy[]>('/api/v1/policies'),
  });
}

export function usePolicy(id: string | undefined) {
  return useQuery({
    queryKey: id ? policiesKey.one(id) : policiesKey.all,
    queryFn: () => api.get<Policy>(`/api/v1/policies/${id}`),
    enabled: !!id,
  });
}

export function useCreatePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PolicyInput) => api.post<Policy>('/api/v1/policies', body),
    onSuccess: () => invalidateAfterAdminPolicyMutation(qc),
  });
}

export function useUpdatePolicy(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PolicyInput) => api.put<void>(`/api/v1/policies/${id}`, body),
    onSuccess: () => invalidateAfterAdminPolicyMutation(qc),
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/policies/${id}`),
    onSuccess: () => invalidateAfterAdminPolicyMutation(qc),
  });
}
