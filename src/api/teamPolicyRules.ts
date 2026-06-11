/**
 * R-follow-up #3 (api#114) — team-anchored scoped policy.author hooks.
 *
 *   POST   /api/v1/teams/:teamID/policy-rules
 *   GET    /api/v1/teams/:teamID/policy-rules
 *   GET    /api/v1/teams/:teamID/policy-rules/:ruleID
 *   PUT    /api/v1/teams/:teamID/policy-rules/:ruleID
 *   DELETE /api/v1/teams/:teamID/policy-rules/:ruleID
 *
 * Per §3 C2 / §5 C1 — all response shapes carry the live priority_cap
 * envelope alongside the rule(s). SPA Author drawer reads the cap from
 * the cached list response (no separate /platform-settings GET).
 *
 * §5 C2 — every mutation invalidates FIVE keys to cover the broader
 * dependent surface:
 *   - teamPolicyRulesKey.list(teamID)   — the team page itself
 *   - teamPolicyRulesKey.one(teamID, ruleID) on update/delete
 *   - ['policies']                       — admin /admin/policies
 *   - ['policy-engine']                  — workflow resolution
 *   - ['project-policy-rules']           — broad prefix; team rules
 *                                          appear inherited on project pages
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { policiesKey } from './policies';
import { policyRuleHistoryKey } from './policyRuleHistory';
import type {
  AuthorTeamPolicyRuleInput,
  TeamPolicyRuleResponse,
  TeamPolicyRulesListResponse,
  UpdateTeamPolicyRuleInput,
} from './types';

export const teamPolicyRulesKey = {
  all: ['team-policy-rules'] as const,
  list: (teamID: string) => ['team-policy-rules', teamID] as const,
  one: (teamID: string, ruleID: string) =>
    ['team-policy-rules', teamID, ruleID] as const,
};

const invalidateAfterTeamMutation = (
  qc: ReturnType<typeof useQueryClient>,
  teamID: string,
  ruleID?: string,
) => {
  qc.invalidateQueries({ queryKey: teamPolicyRulesKey.list(teamID) });
  if (ruleID) {
    qc.invalidateQueries({ queryKey: teamPolicyRulesKey.one(teamID, ruleID) });
  }
  qc.invalidateQueries({ queryKey: policiesKey.all });
  qc.invalidateQueries({ queryKey: ['policy-engine'] });
  // Broad prefix — a team rule appears as inherited on every project
  // under the team subtree. The SPA can't practically know which
  // projects without walking the team tree, so we invalidate the
  // prefix and let TanStack refetch what's currently mounted.
  qc.invalidateQueries({ queryKey: ['project-policy-rules'] });
  // R-follow-up #5 §5 D3 — 6th key. Any mutation may add a new event
  // to a rule whose history view isn't currently mounted; broad
  // invalidate keeps the cache honest without enumerating mounted
  // history queries.
  qc.invalidateQueries({ queryKey: policyRuleHistoryKey.base });
};

export function useTeamPolicyRules(teamID: string | undefined) {
  return useQuery({
    queryKey: teamPolicyRulesKey.list(teamID ?? ''),
    queryFn: () =>
      api.get<TeamPolicyRulesListResponse>(
        `/api/v1/teams/${encodeURIComponent(teamID!)}/policy-rules`,
      ),
    enabled: !!teamID,
    staleTime: 30_000,
  });
}

export function useTeamPolicyRule(
  teamID: string | undefined,
  ruleID: string | undefined,
) {
  return useQuery({
    queryKey: teamPolicyRulesKey.one(teamID ?? '', ruleID ?? ''),
    queryFn: () =>
      api.get<TeamPolicyRuleResponse>(
        `/api/v1/teams/${encodeURIComponent(teamID!)}/policy-rules/${encodeURIComponent(ruleID!)}`,
      ),
    enabled: !!teamID && !!ruleID,
    staleTime: 30_000,
  });
}

export function useAuthorTeamPolicyRule(teamID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AuthorTeamPolicyRuleInput) =>
      api.post<TeamPolicyRuleResponse>(
        `/api/v1/teams/${encodeURIComponent(teamID)}/policy-rules`,
        body,
      ),
    onSuccess: () => invalidateAfterTeamMutation(qc, teamID),
  });
}

export function useUpdateTeamPolicyRule(teamID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { ruleID: string; body: UpdateTeamPolicyRuleInput }) =>
      api.put<TeamPolicyRuleResponse>(
        `/api/v1/teams/${encodeURIComponent(teamID)}/policy-rules/${encodeURIComponent(vars.ruleID)}`,
        vars.body,
      ),
    onSuccess: (_data, vars) =>
      invalidateAfterTeamMutation(qc, teamID, vars.ruleID),
  });
}

export function useDeleteTeamPolicyRule(teamID: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleID: string) =>
      api.delete<void>(
        `/api/v1/teams/${encodeURIComponent(teamID)}/policy-rules/${encodeURIComponent(ruleID)}`,
      ),
    onSuccess: (_data, ruleID) =>
      invalidateAfterTeamMutation(qc, teamID, ruleID),
  });
}
