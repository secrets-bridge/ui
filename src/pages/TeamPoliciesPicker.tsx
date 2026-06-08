/**
 * R-follow-up #3 (api#114) — team picker for the sidebar
 * "Team policies" entry.
 *
 *   /teams/policies
 *
 * Behaviour mirrors ProjectPoliciesPicker:
 *   - Actor covers exactly one team → auto-route to that team's
 *     policies page.
 *   - Actor covers multiple → show a picker list.
 *   - Actor covers none → "Nothing to author here" message.
 *
 * Coverage source: GET /api/v1/users/me/policy-author-team-coverage
 * via useMyPolicyAuthorTeamCoverage. Team names hydrated from the
 * existing useTeams() admin-shaped hook (already cached by other
 * admin pages).
 */

import { useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';

import { useMyPolicyAuthorTeamCoverage } from '../api/myPolicyAuthorTeamCoverage';
import { useTeams } from '../api/teams';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';

export function TeamPoliciesPicker() {
  const coverage = useMyPolicyAuthorTeamCoverage();
  const teams = useTeams();

  const coveredTeams = useMemo(() => {
    if (!coverage.data || !teams.data) return [];
    if (coverage.data.global) return teams.data;
    const set = new Set(coverage.data.team_ids);
    return teams.data.filter((t) => set.has(t.id));
  }, [coverage.data, teams.data]);

  if (coverage.isLoading || teams.isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Loading your teams…</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (coveredTeams.length === 1) {
    return <Navigate to={`/teams/${coveredTeams[0].id}/policies`} replace />;
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <PageHeader
        title="Team policies"
        description="Pick a team to manage its non-prod policy rules. Team rules cascade down to every descendant project."
      />
      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">Your teams</h3>
        </CardHeader>
        <CardBody>
          {coveredTeams.length === 0 ? (
            <p className="text-sm text-muted">
              You don't have any teams with policy authoring access yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {coveredTeams.map((t) => (
                <li key={t.id} className="py-3 flex items-center justify-between">
                  <span className="text-sm text-text">{t.name}</span>
                  <Link
                    to={`/teams/${t.id}/policies`}
                    className="text-[12px] text-accent hover:underline"
                  >
                    Manage policies →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
