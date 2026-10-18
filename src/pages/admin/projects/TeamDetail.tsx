/**
 * One team in the admin console (`/admin/teams?team=<id>`): edit it,
 * add a sub-team, archive or delete it, and manage its members. Also the
 * create and edit drawer the Teams list uses.
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UseQueryResult } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../../../api/client';
import { logoUrl } from '../../../api/logos';
import {
  useAddTeamMember,
  useCreateTeam,
  useDeleteTeam,
  useRemoveTeamMember,
  useTeamMembers,
  useUpdateTeam,
  useUpdateTeamStatus,
  type Team,
  type TeamMember,
} from '../../../api/teams';
import { useAuth } from '../../../auth/AuthContext';
import { formatExact } from '../../../lib/time';
import { Banner } from '../../../ui/Banner';
import { Breadcrumb, type Crumb } from '../../../ui/Breadcrumb';
import { Button } from '../../../ui/Button';
import { ConfirmModal } from '../../../ui/ConfirmModal';
import { DataTable, type Column } from '../../../ui/DataTable';
import { Drawer } from '../../../ui/Drawer';
import { EntityMark } from '../../../ui/EntityMark';
import { Field, Input, Select, Textarea } from '../../../ui/Field';
import { PageHeader } from '../../../ui/PageHeader';
import { useToast } from '../../../ui/toastContext';
import { LogoDialog } from './LogoDialog';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const teamLink = (id: string) => `/admin/teams?team=${id}`;

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const m = err.message.toLowerCase();
    if (err.status === 409 && m.includes('children')) return 'This team still has sub-teams. Move or delete them first.';
    if (err.status === 409 && m.includes('name')) return 'Another team under the same parent already has this name.';
    if (err.status === 409 && m.includes('cycle')) return 'That parent would put the team under itself. Pick another parent.';
    return `${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** The team and every team under it. */
function subtreeOf(rootID: string, all: Team[]): Set<string> {
  const out = new Set<string>();
  const stack = [rootID];
  while (stack.length) {
    const cur = stack.pop()!;
    out.add(cur);
    for (const t of all) if (t.parent_team_id === cur && !out.has(t.id)) stack.push(t.id);
  }
  return out;
}

function ancestorsOf(team: Team, all: Team[]): Team[] {
  const out: Team[] = [];
  const seen = new Set<string>([team.id]);
  let cur = all.find((t) => t.id === team.parent_team_id);
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = all.find((t) => t.id === cur!.parent_team_id);
  }
  return out;
}

export function TeamDetail({
  teamId,
  teams,
  onOpen,
  onDeleted,
}: {
  teamId: string;
  teams: UseQueryResult<Team[]>;
  onOpen: (id: string) => void;
  onDeleted: () => void;
}) {
  const all = useMemo(() => teams.data ?? [], [teams.data]);
  const team = all.find((t) => t.id === teamId);

  if (teams.isLoading) {
    return (
      <div>
        <Breadcrumb items={[{ label: 'Teams', to: '/admin/teams' }, { label: 'Team' }]} />
        <p className="mt-4 text-muted">Loading the team…</p>
      </div>
    );
  }
  if (!team) {
    return (
      <div>
        <Breadcrumb items={[{ label: 'Teams', to: '/admin/teams' }, { label: 'Team' }]} />
        <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
          You can't open this team
        </h1>
        <Banner
          tone={teams.isError ? 'error' : 'note'}
          title={teams.isError ? "Couldn't load the teams." : "It doesn't exist any more, or the link is wrong."}
          action={
            teams.isError ? (
              <Button variant="secondary" size="sm" onClick={() => void teams.refetch()}>
                Try again
              </Button>
            ) : undefined
          }
        >
          <Link to="/admin/teams" className="font-medium text-accent hover:underline">
            Back to teams
          </Link>
        </Banner>
      </div>
    );
  }

  return <TeamView key={team.id} team={team} all={all} onOpen={onOpen} onDeleted={onDeleted} />;
}

function TeamView({ team, all, onOpen, onDeleted }: { team: Team; all: Team[]; onOpen: (id: string) => void; onDeleted: () => void }) {
  const toast = useToast();
  const status = useUpdateTeamStatus(team.id);
  const remove = useDeleteTeam();
  const [editing, setEditing] = useState(false);
  const [logo, setLogo] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const ancestors = ancestorsOf(team, all);
  const children = all.filter((t) => t.parent_team_id === team.id).sort((a, b) => a.name.localeCompare(b.name));
  const parent = ancestors[ancestors.length - 1];
  const archived = team.status === 'archived';
  const crumbs: Crumb[] = [
    { label: 'Teams', to: '/admin/teams' },
    ...ancestors.map((a) => ({ label: a.name, to: teamLink(a.id) })),
    { label: team.name },
  ];

  const toggle = async () => {
    try {
      await status.mutateAsync(archived ? 'active' : 'archived');
      toast(archived ? `Activated ${team.name}.` : `Archived ${team.name}. Activate it at any time.`);
    } catch {
      // Shown below.
    }
  };

  const facts = [
    parent ? `Under ${parent.name}` : 'Top-level team',
    `${children.length} ${children.length === 1 ? 'sub-team' : 'sub-teams'}`,
    archived ? 'Archived' : null,
  ].filter(Boolean);

  return (
    <div>
      <Breadcrumb items={crumbs} />
      <div className="mt-3">
        <PageHeader
          title={team.name}
          mark={<EntityMark name={team.name} kind="team" size="lg" src={logoUrl('team', team.id, team.logo_version)} />}
          description={
            <>
              {facts.join(' · ')}
              {team.description && <span className="mt-0.5 block text-ink">{team.description}</span>}
            </>
          }
          actions={
            <>
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit team
              </Button>
              {/* Only when this api stores logos (its bodies carry logo_version). */}
              {'logo_version' in team && (
                <Button variant="secondary" onClick={() => setLogo(true)}>
                  Change logo
                </Button>
              )}
              <Button variant="secondary" onClick={() => setAddingChild(true)}>
                Add sub-team
              </Button>
              <Button variant="secondary" onClick={() => void toggle()} disabled={status.isPending} aria-busy={status.isPending}>
                {status.isPending ? 'Working…' : archived ? 'Activate' : 'Archive'}
              </Button>
              <Button
                variant="danger"
                onClick={() => setConfirmDelete(true)}
                disabled={children.length > 0}
                title={children.length > 0 ? 'Move or delete its sub-teams first.' : undefined}
              >
                Delete…
              </Button>
            </>
          }
        />
      </div>
      {logo && <LogoDialog kind="team" id={team.id} name={team.name} logoVersion={team.logo_version} onClose={() => setLogo(false)} />}
      {status.isError && (
        <Banner tone="error" title={archived ? 'Not activated.' : 'Not archived.'} className="mb-4">
          {errorText(status.error)}
        </Banner>
      )}
      {children.length > 0 && <p className="-mt-3 mb-5 text-caption text-muted">Delete is unavailable while the team has sub-teams.</p>}

      <div className="flex flex-col gap-8">
        <MembersSection team={team} />

        {children.length > 0 && (
          <section aria-labelledby="subteams-heading">
            <h2 id="subteams-heading" className="mb-3 text-block-heading text-ink">
              Sub-teams
              <span className="ml-2 font-mono text-mono-small font-normal text-muted">{children.length}</span>
            </h2>
            <ul className="m-0 list-none rounded-md border border-border bg-surface p-0">
              {children.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 border-t border-rule px-4 py-2.5 first:border-t-0">
                  <button type="button" onClick={() => onOpen(c.id)} className="text-left font-medium text-accent hover:underline">
                    {c.name}
                  </button>
                  <span className="text-caption text-muted">{c.status === 'archived' ? 'Archived' : c.description}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {editing && (
        <TeamFormDrawer
          team={team}
          allTeams={all}
          onSaved={() => {
            setEditing(false);
            toast(`Saved ${team.name}.`);
          }}
          onCancel={() => setEditing(false)}
        />
      )}
      {addingChild && (
        <TeamFormDrawer
          parentTeamId={team.id}
          allTeams={all}
          onSaved={(t) => {
            setAddingChild(false);
            toast(`Created team ${t.name} under ${team.name}.`);
          }}
          onCancel={() => setAddingChild(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${team.name}?`}
          body="This removes the team and its memberships. Role grants on the team stop covering anything. It can't be undone; archive it instead to keep it for history."
          confirmText="Delete team"
          danger
          loading={remove.isPending}
          error={remove.error}
          onCancel={() => {
            remove.reset();
            setConfirmDelete(false);
          }}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(team.id);
              toast(`Deleted ${team.name}.`);
              onDeleted();
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </div>
  );
}

// --- members ---------------------------------------------------------

function MembersSection({ team }: { team: Team }) {
  const { identity } = useAuth();
  const members = useTeamMembers(team.id);
  const add = useAddTeamMember(team.id);
  const remove = useRemoveTeamMember(team.id);
  const toast = useToast();
  const [userId, setUserId] = useState('');
  const [tried, setTried] = useState(false);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const trimmed = userId.trim();
  const already = (members.data ?? []).some((m) => m.user_id.toLowerCase() === trimmed.toLowerCase());
  const fieldError = !tried
    ? undefined
    : !trimmed
      ? 'Paste the user id to add.'
      : !UUID.test(trimmed)
        ? 'A user id looks like 8-4-4-4-12 hexadecimal characters.'
        : already
          ? 'This person is already a member.'
          : undefined;

  const onAdd = async () => {
    setTried(true);
    if (!trimmed || !UUID.test(trimmed) || already) {
      document.getElementById('member-id')?.focus();
      return;
    }
    try {
      await add.mutateAsync(trimmed);
      setUserId('');
      setTried(false);
      toast(`Added a member to ${team.name}.`);
    } catch {
      // Shown below.
    }
  };

  const rows = [...(members.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const who = (m: TeamMember) => (
    <span className="flex flex-wrap items-center gap-2">
      <span className="break-all font-mono text-mono">{m.user_id}</span>
      {identity?.id === m.user_id && <span className="text-caption font-medium text-muted">you</span>}
    </span>
  );
  const removeButton = (m: TeamMember) => (
    <Button variant="secondary" size="sm" onClick={() => setRemoving(m)} aria-label={`Remove ${m.user_id}`}>
      Remove…
    </Button>
  );
  const columns: Column<TeamMember>[] = [
    { key: 'user', header: 'User id', render: who },
    { key: 'added', header: 'Added', render: (m) => <span className="whitespace-nowrap">{formatExact(m.created_at)}</span> },
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', render: removeButton },
  ];

  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading" className="text-block-heading text-ink">
        Members
        {members.data && <span className="ml-2 font-mono text-mono-small font-normal text-muted">{rows.length}</span>}
      </h2>
      <p className="mb-3 mt-0.5 max-w-3xl text-caption text-muted">
        Membership only groups people. To give members access, grant a role on this team in{' '}
        <Link to="/admin/assignments" className="font-medium text-accent hover:underline">
          Assignments
        </Link>
        .
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onAdd();
        }}
        className="mb-4 flex flex-wrap items-start gap-2.5"
      >
        <div className="min-w-0 flex-1 basis-[320px]">
          <Field id="member-id" label="Add a member" hint="The person's user id, from their profile page." error={fieldError}>
            {(p) => (
              <Input
                {...p}
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
                className="w-full font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
        </div>
        <Button type="submit" variant="secondary" className="mt-[27px] max-[600px]:mt-0" disabled={add.isPending} aria-busy={add.isPending}>
          {add.isPending ? 'Adding…' : 'Add member'}
        </Button>
      </form>
      {add.isError && (
        <Banner tone="error" title="Not added." className="mb-4">
          {errorText(add.error)}
        </Banner>
      )}

      {members.isLoading && <p className="text-muted">Loading members…</p>}
      {members.isError && (
        <Banner
          tone="error"
          title="Couldn't load the members."
          action={
            <Button variant="secondary" size="sm" onClick={() => void members.refetch()}>
              Try again
            </Button>
          }
        >
          {errorText(members.error)}
        </Banner>
      )}
      {members.data &&
        (rows.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">No members yet.</p>
        ) : (
          <DataTable label={`Members of ${team.name}`} columns={columns} rows={rows} rowKey={(m) => m.user_id} minWidth={480} />
        ))}

      {removing && (
        <ConfirmModal
          title="Remove this member?"
          body={`${removing.user_id} leaves ${team.name}. Roles granted to them directly are not affected.`}
          confirmText="Remove member"
          danger
          loading={remove.isPending}
          error={remove.error}
          onCancel={() => {
            remove.reset();
            setRemoving(null);
          }}
          onConfirm={async () => {
            try {
              await remove.mutateAsync(removing.user_id);
              toast(`Removed a member from ${team.name}.`);
              setRemoving(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </section>
  );
}

// --- create and edit -------------------------------------------------

const teamFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a team name.').max(120, 'Use 120 characters or fewer.'),
  description: z.string().max(500, 'Use 500 characters or fewer.').optional(),
  parent_team_id: z.string().optional(),
});

type TeamFormShape = z.infer<typeof teamFormSchema>;

export function TeamFormDrawer({
  team,
  parentTeamId,
  allTeams,
  onSaved,
  onCancel,
}: {
  team?: Team;
  parentTeamId?: string | null;
  allTeams: Team[];
  onSaved: (team: Team) => void;
  onCancel: () => void;
}) {
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? '');
  const parentName = parentTeamId ? allTeams.find((t) => t.id === parentTeamId)?.name : undefined;

  // A team can't move under itself or anything under it.
  const excluded = useMemo(() => (team ? subtreeOf(team.id, allTeams) : new Set<string>()), [team, allTeams]);
  const parentChoices = allTeams.filter((t) => !excluded.has(t.id)).sort((a, b) => a.name.localeCompare(b.name));

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<TeamFormShape>({
    resolver: zodResolver(teamFormSchema),
    defaultValues: {
      name: team?.name ?? '',
      description: team?.description ?? '',
      parent_team_id: team?.parent_team_id ?? parentTeamId ?? '',
    },
  });

  const onValid: SubmitHandler<TeamFormShape> = async (data) => {
    const body = { name: data.name.trim(), description: data.description ?? '', parent_team_id: data.parent_team_id || null };
    try {
      if (team) {
        const saved = await update.mutateAsync(body);
        onSaved(saved ?? { ...team, ...body });
      } else {
        onSaved(await create.mutateAsync(body));
      }
    } catch {
      // Shown in the banner below.
    }
  };

  const err = team ? update.error : create.error;
  const title = team ? 'Edit team' : parentName ? 'Add sub-team' : 'Create team';
  return (
    <Drawer
      title={title}
      subtitle={team ? team.name : parentName ? `A new team under ${parentName}.` : 'A new team. Pick a parent to put it under another team.'}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="team-form" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Saving…' : team ? 'Save team' : 'Create team'}
          </Button>
        </>
      }
    >
      <form id="team-form" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        <Field id="team-name" label="Name" hint="Unique among teams with the same parent." error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="Platform East" autoComplete="off" data-autofocus />}
        </Field>
        <Field id="team-description" label="Description (optional)" error={errors.description?.message}>
          {(p) => <Textarea {...p} {...register('description')} rows={2} placeholder="What the team owns, in one line." maxLength={500} />}
        </Field>
        <Field
          id="team-parent"
          label="Parent team"
          hint="A role granted on the parent also covers this team."
          error={errors.parent_team_id?.message}
        >
          {(p) => (
            <Select {...p} {...register('parent_team_id')}>
              <option value="">None (top-level team)</option>
              {parentChoices.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.status === 'archived' ? ' (archived)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {err != null && (
          <Banner tone="error" title={team ? 'Not saved.' : 'Not created.'}>
            {errorText(err)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
