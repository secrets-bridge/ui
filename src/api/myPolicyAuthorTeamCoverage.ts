/**
 * R-follow-up #3 (api#126) — coverage endpoint for sidebar + capability
 * helper consumption.
 *
 *   GET /api/v1/users/me/policy-author-team-coverage
 *
 * Returns the resolved team set from the api's `EffectiveTeamAccess`
 * helper — every team the actor's policy.author grants cover
 * (subtree-expanded). The SPA reads this to:
 *
 *   - Decide whether to render the "Team policies" sidebar entry
 *   - Gate canAuthorTeamPolicy(teamID) without walking the team tree
 *     client-side
 *
 * §5 C5 — sidebar visibility is scope-aware: rendered only when the
 * coverage set is non-empty (or global). Cache posture is generous
 * (5 min staleTime) — the data is admin-mutated and changes rarely.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from './client';
import type { MyPolicyAuthorTeamCoverage } from './types';

export const myPolicyAuthorTeamCoverageKey = ['me', 'policy-author-team-coverage'] as const;

export function useMyPolicyAuthorTeamCoverage(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: myPolicyAuthorTeamCoverageKey,
    queryFn: () =>
      api.get<MyPolicyAuthorTeamCoverage>('/api/v1/users/me/policy-author-team-coverage'),
    enabled: opts?.enabled ?? true,
    staleTime: 5 * 60_000,
  });
}
