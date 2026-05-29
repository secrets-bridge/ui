/**
 * Workflow definitions API surface — wraps GET / POST / PUT / DELETE
 * against /api/v1/workflows. Each function returns a TanStack Query
 * key alongside the network call so callers stay consistent.
 *
 * Mutation strategy: every mutation invalidates `workflowsKey.all` so
 * the list view picks up changes without a manual refetch.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type { Workflow, WorkflowInput } from './types';

export const workflowsKey = {
  all: ['workflows'] as const,
  one: (id: string) => ['workflows', id] as const,
};

export function useWorkflows() {
  return useQuery({
    queryKey: workflowsKey.all,
    queryFn: () => api.get<Workflow[]>('/api/v1/workflows'),
  });
}

export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: id ? workflowsKey.one(id) : workflowsKey.all,
    queryFn: () => api.get<Workflow>(`/api/v1/workflows/${id}`),
    enabled: !!id,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowInput) => api.post<Workflow>('/api/v1/workflows', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowsKey.all }),
  });
}

export function useUpdateWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowInput) => api.put<void>(`/api/v1/workflows/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowsKey.all }),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/workflows/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: workflowsKey.all }),
  });
}
