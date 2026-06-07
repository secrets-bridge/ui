/**
 * EPIC R (api#108) Slice R3 — project-anchored scoped policy.author
 * hooks.
 *
 *   POST   /api/v1/projects/:projectID/policy-rules
 *   GET    /api/v1/projects/:projectID/policy-rules
 *   GET    /api/v1/projects/:projectID/policy-rules/:ruleID
 *   PUT    /api/v1/projects/:projectID/policy-rules/:ruleID
 *   DELETE /api/v1/projects/:projectID/policy-rules/:ruleID
 *
 * These routes are gated server-side by `policy.author` scoped to
 * (projectID) via the team-aware resolver. Admin (`policy.edit`)
 * callers use the existing `./policies.ts` admin URLs for platform
 * global rules. Per §5 correction 2 the two permissions do NOT imply
 * each other — they live as distinct hooks against distinct endpoints.
 *
 * Cache invariant per §6:
 *   - `projectPolicyRulesKey.list(projectID)` — the project page
 *   - `['policies']` — the admin /admin/policies list (if open)
 *   - `['policy-engine']` — defensive invalidation for any consumer
 *     that may have a different resolution
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { policiesKey } from './policies';
import type {
  AuthorPolicyRuleInput,
  PolicyRule,
  UpdatePolicyRuleInput,
} from './types';

export const projectPolicyRulesKey = {
  all: ['project-policy-rules'] as const,
  list: (projectID: string) =>
    ['project-policy-rules', projectID] as const,
  one: (projectID: string, ruleID: string) =>
    ['project-policy-rules', projectID, ruleID] as const,
};

const invalidateAfterPolicyMutation = (
  qc: ReturnType<typeof useQueryClient>,
  projectID: string,
) => {
  qc.invalidateQueries({ queryKey: projectPolicyRulesKey.list(projectID) });
  qc.invalidateQueries({ queryKey: policiesKey.all });
  // Defensive: anything that resolved a workflow via the policy engine
  // should refetch in case the new rule changes the answer.
  qc.invalidateQueries({ queryKey: ['policy-engine'] });
};

/**
 * List a project's scoped rules joined with inherited platform rules.
 *
 * §4 correction 1: inherited platform rows carry `selector_keys` only —
 * the `selector` field is omitted server-side. Scoped rows carry the
 * full `selector` map.
 */
export function useProjectPolicyRules(projectID: string | undefined) {
  return useQuery({
    queryKey: projectPolicyRulesKey.list(projectID ?? ''),
    queryFn: () =>
      api.get<PolicyRule[]>(
        `/api/v1/projects/${encodeURIComponent(projectID!)}/policy-rules`,
      ),
    enabled: !!projectID,
    staleTime: 30_000,
  });
}

export function useProjectPolicyRule(
  projectID: string | undefined,
  ruleID: string | undefined,
) {
  return useQuery({
    queryKey: projectPolicyRulesKey.one(projectID ?? '', ruleID ?? ''),
    queryFn: () =>
      api.get<PolicyRule>(
        `/api/v1/projects/${encodeURIComponent(projectID!)}/policy-rules/${encodeURIComponent(ruleID!)}`,
      ),
    enabled: !!projectID && !!ruleID,
    staleTime: 30_000,
  });
}

export function useAuthorPolicyRule(projectID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AuthorPolicyRuleInput) =>
      api.post<PolicyRule>(
        `/api/v1/projects/${encodeURIComponent(projectID)}/policy-rules`,
        body,
      ),
    onSuccess: () => invalidateAfterPolicyMutation(qc, projectID),
  });
}

export function useUpdatePolicyRule(projectID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ruleID: string; body: UpdatePolicyRuleInput }) =>
      api.put<PolicyRule>(
        `/api/v1/projects/${encodeURIComponent(projectID)}/policy-rules/${encodeURIComponent(vars.ruleID)}`,
        vars.body,
      ),
    onSuccess: () => invalidateAfterPolicyMutation(qc, projectID),
  });
}

export function useDeletePolicyRule(projectID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleID: string) =>
      api.delete<void>(
        `/api/v1/projects/${encodeURIComponent(projectID)}/policy-rules/${encodeURIComponent(ruleID)}`,
      ),
    onSuccess: () => invalidateAfterPolicyMutation(qc, projectID),
  });
}
