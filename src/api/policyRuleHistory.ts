/**
 * R-follow-up #5 (api#132) — policy rule audit history hooks.
 *
 * Three per-anchor read endpoints; one shared timeline component
 * (`src/pages/PolicyHistoryTimeline.tsx`) consumes the response.
 *
 *   GET /api/v1/projects/:projectID/policy-rules/:ruleID/history    — scoped
 *   GET /api/v1/teams/:teamID/policy-rules/:ruleID/history          — scoped
 *   GET /api/v1/policies/:ruleID/history                            — admin
 *
 * `limit` is part of the queryKey per §5 D2 — each "Load more" click
 * is naturally a different cache slice, so TanStack handles paging
 * without manual invalidation.
 *
 * Mutation hooks across teamPolicyRules / projectPolicyRules /
 * policies all invalidate the broad `['policy-rule-history']` prefix
 * on success (§5 D3 6-key invariant). Implemented in each mutation
 * module; this file only re-exports the prefix.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from './client';
import type { PolicyRuleHistoryResponse } from './types';

export const policyRuleHistoryKey = {
  /** Broad prefix — mutation modules invalidate this to refresh
   *  every currently-mounted history view. */
  base: ['policy-rule-history'] as const,
  /** Per-rule scope (anchor-agnostic — same rule_id maps to the
   *  same key across all three URL families since the underlying
   *  audit chain is the same). */
  one: (ruleID: string, limit: number) =>
    ['policy-rule-history', ruleID, limit] as const,
};

export function useProjectPolicyRuleHistory(
  projectID: string | undefined,
  ruleID: string | undefined,
  limit: number,
) {
  return useQuery({
    queryKey: ruleID
      ? policyRuleHistoryKey.one(ruleID, limit)
      : policyRuleHistoryKey.base,
    queryFn: () =>
      api.get<PolicyRuleHistoryResponse>(
        `/api/v1/projects/${encodeURIComponent(projectID!)}/policy-rules/${encodeURIComponent(ruleID!)}/history?limit=${limit}`,
      ),
    enabled: !!projectID && !!ruleID,
    staleTime: 30_000,
  });
}

export function useTeamPolicyRuleHistory(
  teamID: string | undefined,
  ruleID: string | undefined,
  limit: number,
) {
  return useQuery({
    queryKey: ruleID
      ? policyRuleHistoryKey.one(ruleID, limit)
      : policyRuleHistoryKey.base,
    queryFn: () =>
      api.get<PolicyRuleHistoryResponse>(
        `/api/v1/teams/${encodeURIComponent(teamID!)}/policy-rules/${encodeURIComponent(ruleID!)}/history?limit=${limit}`,
      ),
    enabled: !!teamID && !!ruleID,
    staleTime: 30_000,
  });
}

export function useAdminPolicyRuleHistory(
  ruleID: string | undefined,
  limit: number,
) {
  return useQuery({
    queryKey: ruleID
      ? policyRuleHistoryKey.one(ruleID, limit)
      : policyRuleHistoryKey.base,
    queryFn: () =>
      api.get<PolicyRuleHistoryResponse>(
        `/api/v1/policies/${encodeURIComponent(ruleID!)}/history?limit=${limit}`,
      ),
    enabled: !!ruleID,
    staleTime: 30_000,
  });
}
