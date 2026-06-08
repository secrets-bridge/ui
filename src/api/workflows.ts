/**
 * Workflow definitions API surface — wraps GET / POST / PUT / DELETE
 * against /api/v1/workflows. Each function returns a TanStack Query
 * key alongside the network call so callers stay consistent.
 *
 * Mutation strategy: every mutation invalidates BOTH `workflowsKey.all`
 * (admin Workflows list) AND `scopedWorkflowsKey.all` (the curated
 * dropdown the EPIC R Slice R3 Author drawer reads — R-follow-up #1,
 * api#118). When admin flips the `scoped_policy_authorable` flag, any
 * open author drawer must immediately see the workflow appear /
 * disappear without a page reload.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type { Workflow, WorkflowInput } from './types';

export const workflowsKey = {
  all: ['workflows'] as const,
  one: (id: string) => ['workflows', id] as const,
};

/**
 * R-follow-up #1 (api#118) — query key for the scoped author dropdown.
 * Distinct from `workflowsKey.all` so admin list cache + scoped
 * dropdown cache stay independent (different shapes, different
 * audiences).
 */
export const scopedWorkflowsKey = {
  all: ['workflows', 'scoped-policy-authorable'] as const,
};

const invalidateBothWorkflowKeys = (
  qc: ReturnType<typeof useQueryClient>,
) => {
  qc.invalidateQueries({ queryKey: workflowsKey.all });
  qc.invalidateQueries({ queryKey: scopedWorkflowsKey.all });
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

/**
 * R-follow-up #1 (api#118) — feeds the EPIC R Slice R3 Author drawer's
 * workflow dropdown. The endpoint returns workflows that satisfy
 * `enabled = true AND scoped_policy_authorable = true` server-side; no
 * client-side filtering needed (replaces R3's defensive stopgap).
 *
 * Auth: bearer + policy.author at any scope (api side enforces).
 * Callers who don't hold the permission get a 403 from the api; the
 * SPA gates the entire ProjectPolicies page on the same capability
 * helper so the hook only fires for legitimate users in practice.
 */
export function useScopedAuthorableWorkflows(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: scopedWorkflowsKey.all,
    queryFn: () =>
      api.get<Workflow[]>('/api/v1/workflows/scoped-policy-authorable'),
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowInput) => api.post<Workflow>('/api/v1/workflows', body),
    onSuccess: () => invalidateBothWorkflowKeys(qc),
  });
}

export function useUpdateWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkflowInput) => api.put<void>(`/api/v1/workflows/${id}`, body),
    onSuccess: () => invalidateBothWorkflowKeys(qc),
  });
}

export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/workflows/${id}`),
    onSuccess: () => invalidateBothWorkflowKeys(qc),
  });
}
