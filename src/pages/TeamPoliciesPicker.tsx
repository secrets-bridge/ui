/**
 * R-follow-up #3 (api#114) — team picker behind the sidebar's "Team
 * policies" entry.
 *
 *   /teams/policies
 *
 * Like the project picker: one team goes straight to its page, several
 * show this list, none says so. Coverage comes from
 * GET /users/me/policy-author-team-coverage; names from useTeams().
 */

import { useMemo } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useMyPolicyAuthorTeamCoverage } from '../api/myPolicyAuthorTeamCoverage';
import { type Team, useTeams } from '../api/teams';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { EntityMark } from '../ui/EntityMark';
import { PageHeader } from '../ui/PageHeader';
import { Loading } from './policies/parts';

export function TeamPoliciesPicker() {
  const coverage = useMyPolicyAuthorTeamCoverage();
  const teams = useTeams();
  const navigate = useNavigate();

  const covered = useMemo(() => {
    if (!coverage.data || !teams.data) return [];
    const list = coverage.data.global ? teams.data : teams.data.filter((t) => coverage.data!.team_ids.includes(t.id));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [coverage.data, teams.data]);

  if (coverage.isLoading || teams.isLoading) return <Loading>Loading your teams…</Loading>;
  if (covered.length === 1) return <Navigate to={`/teams/${covered[0].id}/policies`} replace />;

  const nameOf = (id: string | null) => teams.data?.find((t) => t.id === id)?.name;
  const to = (t: Team) => `/teams/${t.id}/policies`;
  const columns: Column<Team>[] = [
    {
      key: 'name',
      header: 'Team',
      render: (t) => (
        <span className="inline-flex items-center gap-2.5">
          <EntityMark name={t.name} kind="team" size="md" />
          <Link to={to(t)} className="font-medium text-accent hover:underline">
            {t.name}
          </Link>
        </span>
      ),
    },
    { key: 'parent', header: 'Part of', render: (t) => nameOf(t.parent_team_id) ?? <span className="text-muted">—</span> },
  ];
  const error = coverage.error ?? teams.error;

  return (
    <div>
      <PageHeader
        title="Team policies"
        description="Choose a team to see its rules. Team rules apply to non-production environments in every project under the team."
      />
      {error && (
        <Banner
          tone="error"
          title="Couldn't load your teams."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                void coverage.refetch();
                void teams.refetch();
              }}
            >
              Try again
            </Button>
          }
        >
          {error instanceof ApiError ? `${error.status}: ${error.message}` : 'Network error.'}
        </Banner>
      )}
      {!error &&
        (covered.length === 0 ? (
          <EmptyState title="No teams to show.">You can author rules for a team once you hold policy.author for it. Ask a platform administrator.</EmptyState>
        ) : (
          <DataTable label="Your teams" columns={columns} rows={covered} rowKey={(t) => t.id} onRowClick={(t) => navigate(to(t))} minWidth={420} />
        ))}
    </div>
  );
}
