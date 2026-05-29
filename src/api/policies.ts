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
import type { Policy, PolicyInput } from './types';

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
    onSuccess: () => qc.invalidateQueries({ queryKey: policiesKey.all }),
  });
}

export function useUpdatePolicy(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PolicyInput) => api.put<void>(`/api/v1/policies/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: policiesKey.all }),
  });
}

export function useDeletePolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/policies/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: policiesKey.all }),
  });
}
