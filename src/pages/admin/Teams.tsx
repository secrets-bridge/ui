/**
 * Teams (admin, `/admin/teams`, api#49): the team hierarchy, and
 * `?team=<id>` for one team (see ./projects/TeamDetail).
 *
 * A role granted on a team also covers every team under it; that is how
 * a section head sees their reports' work without listing each project.
 *
 * Rules the page keeps:
 *   - Delete is refused (409) while a team has sub-teams; the button is
 *     disabled with the reason when the loaded tree shows any.
 *   - The parent picker leaves out the team and everything under it (the
 *     api refuses cycles too).
 *   - Archive flips the status and is undone with Activate; Delete
 *     removes the team and its memberships.
 *   - Membership only groups people. Access comes from a role granted on
 *     the team in Assignments; this page never grants roles.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { logoUrl } from '../../api/logos';
import { buildTeamTree, useTeams, type Team, type TeamNode } from '../../api/teams';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { EntityMark } from '../../ui/EntityMark';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';
import { TeamDetail, TeamFormDrawer } from './projects/TeamDetail';

interface Row {
  team: Team;
  depth: number;
  children: number;
}

function flatten(nodes: TeamNode[], out: Row[] = []): Row[] {
  for (const n of nodes) {
    out.push({ team: n.team, depth: n.depth, children: n.children.length });
    flatten(n.children, out);
  }
  return out;
}

export function Teams() {
  const list = useTeams();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const selectedId = params.get('team');

  // List and detail share a path, so move focus to the new h1 here.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.getElementById('page-title')?.focus();
  }, [selectedId]);

  const rows = useMemo(() => flatten(buildTeamTree(list.data ?? [])), [list.data]);
  const open = (id: string) => setParams({ team: id });

  if (selectedId) {
    return <TeamDetail teamId={selectedId} teams={list} onOpen={open} onDeleted={() => setParams({})} />;
  }

  const all = list.data ?? [];
  const top = rows.filter((r) => r.depth === 0).length;
  const archived = all.filter((t) => t.status === 'archived').length;
  const status = (t: Team) => <ToneStatus tone={t.status === 'active' ? 'ok' : 'neutral'}>{t.status === 'active' ? 'Active' : 'Archived'}</ToneStatus>;
  const name = (r: Row) => (
    <span className="flex items-center gap-1.5" style={{ paddingLeft: r.depth * 18 }}>
      {r.depth > 0 && (
        <span aria-hidden="true" className="text-muted">
          └
        </span>
      )}
      <EntityMark name={r.team.name} kind="team" size={r.depth > 0 ? 'sm' : 'md'} src={logoUrl('team', r.team.id, r.team.logo_version)} />
      <button type="button" onClick={() => open(r.team.id)} className="text-left font-medium text-accent hover:underline">
        {r.team.name}
      </button>
    </span>
  );

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Team', render: name },
    { key: 'status', header: 'Status', render: (r) => status(r.team) },
    { key: 'subs', header: 'Sub-teams', align: 'right', render: (r) => <span className="font-mono text-mono">{r.children}</span> },
    {
      key: 'desc',
      header: 'Description',
      render: (r) =>
        r.team.description ? (
          <span title={r.team.description} className="block max-w-[420px] truncate text-muted">
            {r.team.description}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Teams"
        description={
          list.data
            ? `${all.length} ${all.length === 1 ? 'team' : 'teams'}, ${top} at the top level${archived ? `, ${archived} archived` : ''}. A role granted on a team also covers every team under it.`
            : 'A role granted on a team also covers every team under it.'
        }
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Create team
          </Button>
        }
      />

      {list.isLoading && <p className="text-muted">Loading teams…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the teams."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : 'Network error.'}
        </Banner>
      )}
      {list.data &&
        (rows.length === 0 ? (
          <EmptyState
            title="No teams yet."
            action={
              <Button variant="secondary" onClick={() => setCreating(true)}>
                Create team
              </Button>
            }
          >
            Teams group projects and people. Grant a role on a team to cover everything under it.
          </EmptyState>
        ) : (
          <DataTable
            label="Teams"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.team.id}
            onRowClick={(r) => open(r.team.id)}
            minWidth={620}
            stacked={(r) => (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-3">
                  {name(r)}
                  {status(r.team)}
                </div>
                <p className="text-caption text-muted" style={{ paddingLeft: r.depth * 18 }}>
                  {r.children} {r.children === 1 ? 'sub-team' : 'sub-teams'}
                  {r.team.description ? ` · ${r.team.description}` : ''}
                </p>
              </div>
            )}
          />
        ))}

      {creating && (
        <TeamFormDrawer
          allTeams={all}
          onSaved={(t) => {
            setCreating(false);
            toast(`Created team ${t.name}.`);
            open(t.id);
          }}
          onCancel={() => setCreating(false)}
        />
      )}
    </div>
  );
}
