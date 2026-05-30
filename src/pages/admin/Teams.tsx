/**
 * /admin/teams — N-level team hierarchy management. Master-detail
 * layout: tree on the left (root teams collapse/expand to reveal
 * descendants), selected team's detail on the right (name, parent,
 * description, status, members).
 *
 * Backed by the api#49 endpoints exposed via src/api/teams.ts.
 *
 * Hard rules surfaced in this UI:
 *   - Delete refuses with 409 when the team has children. The button
 *     is disabled when the local tree shows any descendants so the
 *     user gets immediate feedback instead of round-tripping.
 *   - Parent picker excludes the team itself + all its descendants
 *     (the server's cycle-prevention check would refuse those, but
 *     filtering them client-side keeps the UX clean).
 *   - Archive ≠ Delete. Archive flips status; the row stays in the
 *     tree (dimmed). Delete removes the row entirely after refusing
 *     when children exist.
 *   - Membership is structural only — the page does NOT mint role
 *     grants. Use /admin/assignments to grant a role scoped to a
 *     team_id; that's the piece that says "section head over X."
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import {
  buildTeamTree,
  useAddTeamMember,
  useCreateTeam,
  useDeleteTeam,
  useRemoveTeamMember,
  useTeamMembers,
  useTeams,
  useUpdateTeam,
  useUpdateTeamStatus,
  type Team,
  type TeamNode,
} from '../../api/teams';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';

export function Teams() {
  const list = useTeams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createParent, setCreateParent] = useState<string | null>(null);

  // Auto-select the first root team once the list loads.
  useEffect(() => {
    if (!selectedId && list.data && list.data.length > 0) {
      const first = list.data.find((t) => t.parent_team_id === null) ?? list.data[0];
      setSelectedId(first.id);
    }
  }, [list.data, selectedId]);

  const tree = useMemo(() => buildTeamTree(list.data ?? []), [list.data]);
  const selected = list.data?.find((t) => t.id === selectedId) ?? null;

  return (
    <div>
      <PageHeader
        title="Teams"
        description="N-level team hierarchy. Role grants scoped to a team_id cover the entire descendant subtree — that's how a section head sees their reports' work without per-project enumeration."
        actions={
          <Button variant="primary" onClick={() => { setCreateParent(null); setCreating(true); }}>
            + New team
          </Button>
        }
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load teams</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No teams yet. Create one to start organising the access hierarchy.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          <TeamTree
            nodes={tree}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAddChild={(parentId) => { setCreateParent(parentId); setCreating(true); }}
          />
          {selected ? (
            <TeamDetail
              team={selected}
              allTeams={list.data ?? []}
            />
          ) : (
            <Card className="p-10 text-center text-muted text-sm">
              Pick a team to view its members + edit its parent / name / status.
            </Card>
          )}
        </div>
      )}

      {creating && (
        <Drawer title={createParent ? 'New child team' : 'New root team'} onClose={() => setCreating(false)}>
          <TeamForm
            parentTeamId={createParent}
            allTeams={list.data ?? []}
            onCreated={(id) => {
              setCreating(false);
              setSelectedId(id);
            }}
            onCancel={() => setCreating(false)}
          />
        </Drawer>
      )}
    </div>
  );
}

// --- left rail: collapsible tree ------------------------------------

function TeamTree({
  nodes,
  selectedId,
  onSelect,
  onAddChild,
}: {
  nodes: TeamNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const total = countAll(nodes);
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3 border-b border-border/60 text-[11px] uppercase tracking-wider text-muted">
        {total} team{total === 1 ? '' : 's'}
      </div>
      <ul className="max-h-[640px] overflow-auto">
        {nodes.map((n) => (
          <TreeRow key={n.team.id} node={n} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} />
        ))}
      </ul>
    </Card>
  );
}

function TreeRow({
  node,
  selectedId,
  onSelect,
  onAddChild,
}: {
  node: TeamNode;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddChild: (parentId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isOn = node.team.id === selectedId;
  const archived = node.team.status === 'archived';
  const hasKids = node.children.length > 0;
  const indent = { paddingLeft: 16 + node.depth * 16 };

  return (
    <>
      <li>
        <div
          className={
            'group flex items-center gap-2 px-2 py-2 border-b border-border/40 last:border-0 transition-colors text-sm ' +
            (isOn
              ? 'bg-accent/10 border-l-2 border-l-accent'
              : 'hover:bg-bg/30')
          }
          style={indent}
        >
          {hasKids ? (
            <button
              onClick={() => setOpen((v) => !v)}
              className="w-4 h-4 flex items-center justify-center text-muted hover:text-text"
              title={open ? 'Collapse' : 'Expand'}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="w-4 h-4 inline-block" />
          )}
          <button
            onClick={() => onSelect(node.team.id)}
            className="flex-1 text-left min-w-0"
          >
            <span
              className={
                'font-mono text-sm ' +
                (archived ? 'text-muted line-through' : isOn ? 'text-accent-bright' : 'text-text')
              }
            >
              {node.team.name}
            </span>
          </button>
          <button
            onClick={() => onAddChild(node.team.id)}
            className="opacity-0 group-hover:opacity-100 text-[11px] text-muted hover:text-accent transition-opacity"
            title="Add child team"
          >
            + child
          </button>
        </div>
      </li>
      {open && node.children.map((c) => (
        <TreeRow key={c.team.id} node={c} selectedId={selectedId} onSelect={onSelect} onAddChild={onAddChild} />
      ))}
    </>
  );
}

function countAll(nodes: TeamNode[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1 + countAll(node.children);
  }
  return n;
}

// --- right pane: detail + members + actions -------------------------

function TeamDetail({ team, allTeams }: { team: Team; allTeams: Team[] }) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = useUpdateTeamStatus(team.id);
  const remove = useDeleteTeam();
  const [serverError, setServerError] = useState<string | null>(null);

  // Children (immediate); used to surface why Delete is disabled.
  const children = allTeams.filter((t) => t.parent_team_id === team.id);

  const toggleStatus = async () => {
    setServerError(null);
    try {
      await status.mutateAsync(team.status === 'active' ? 'archived' : 'active');
    } catch (err) {
      setServerError(stringifyError(err));
    }
  };

  const onDelete = async () => {
    setServerError(null);
    try {
      await remove.mutateAsync(team.id);
      setConfirmDelete(false);
    } catch (err) {
      setServerError(stringifyError(err));
      setConfirmDelete(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-text font-mono font-semibold truncate">{team.name}</h3>
              {team.status === 'archived' && (
                <StatusPill variant="warning" tone="outline">archived</StatusPill>
              )}
            </div>
            {team.description && (
              <p className="text-muted text-sm mt-1">{team.description}</p>
            )}
            <div className="text-muted text-xs mt-2 font-mono">{team.id}</div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleStatus}
              disabled={status.isPending}
            >
              {team.status === 'active' ? 'Archive' : 'Activate'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={children.length > 0}
              title={children.length > 0 ? 'Unparent or delete children first' : 'Delete this team'}
            >
              Delete
            </Button>
          </div>
        </div>

        {serverError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 mt-3">
            {serverError}
          </div>
        )}
      </Card>

      <MembersPanel team={team} />

      {editing && (
        <Drawer title="Edit team" onClose={() => setEditing(false)}>
          <TeamForm
            allTeams={allTeams}
            team={team}
            onUpdated={() => setEditing(false)}
            onCancel={() => setEditing(false)}
          />
        </Drawer>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete team"
          body={`Delete '${team.name}'? This removes the team and its membership rows. Cannot be undone.`}
          confirmText="Delete"
          danger
          loading={remove.isPending}
          error={remove.error}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={onDelete}
        />
      )}
    </div>
  );
}

// --- create / edit form ---------------------------------------------

const teamFormSchema = z.object({
  name: z
    .string()
    .min(1, 'name is required')
    .max(120, 'name too long'),
  description: z.string().max(500).optional(),
  parent_team_id: z.string().optional(),
});

type TeamFormShape = z.infer<typeof teamFormSchema>;

function TeamForm({
  team,
  parentTeamId,
  allTeams,
  onCreated,
  onUpdated,
  onCancel,
}: {
  team?: Team;
  parentTeamId?: string | null;
  allTeams: Team[];
  onCreated?: (newId: string) => void;
  onUpdated?: () => void;
  onCancel: () => void;
}) {
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? '');
  const [serverError, setServerError] = useState<string | null>(null);

  // Parent options: every team that isn't the one being edited AND
  // isn't in its descendant subtree. For Create, every team is fair
  // game — the server's unique-name-per-parent check catches collisions.
  const descendantSet = useMemo(() => {
    if (!team) return new Set<string>();
    return descendantsOf(team.id, allTeams);
  }, [team, allTeams]);

  const parentChoices = allTeams.filter(
    (t) => t.id !== team?.id && !descendantSet.has(t.id),
  );

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
    setServerError(null);
    const parent = data.parent_team_id && data.parent_team_id !== '' ? data.parent_team_id : null;
    try {
      if (team) {
        await update.mutateAsync({
          name: data.name,
          description: data.description ?? '',
          parent_team_id: parent,
        });
        onUpdated?.();
      } else {
        const created = await create.mutateAsync({
          name: data.name,
          description: data.description ?? '',
          parent_team_id: parent,
        });
        onCreated?.(created.id);
      }
    } catch (err) {
      setServerError(stringifyError(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <FormField label="Name" error={errors.name?.message}>
        <input
          {...register('name')}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent"
          placeholder="e.g. platform-east"
        />
      </FormField>

      <FormField label="Description (optional)" error={errors.description?.message}>
        <textarea
          {...register('description')}
          rows={2}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
          placeholder="One-line purpose"
        />
      </FormField>

      <FormField label="Parent team (optional — empty = root)" error={errors.parent_team_id?.message}>
        <select
          {...register('parent_team_id')}
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent"
        >
          <option value="">(root)</option>
          {parentChoices.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </FormField>

      {serverError && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
          {serverError}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={isSubmitting || create.isPending || update.isPending}>
          {team ? 'Save' : 'Create'}
        </Button>
      </div>
    </form>
  );
}

function descendantsOf(rootID: string, all: Team[]): Set<string> {
  const out = new Set<string>();
  const stack = [rootID];
  while (stack.length) {
    const cur = stack.pop()!;
    out.add(cur);
    for (const t of all) {
      if (t.parent_team_id === cur && !out.has(t.id)) stack.push(t.id);
    }
  }
  return out;
}

// --- members panel --------------------------------------------------

function MembersPanel({ team }: { team: Team }) {
  const members = useTeamMembers(team.id);
  const add = useAddTeamMember(team.id);
  const remove = useRemoveTeamMember(team.id);
  const [userIDInput, setUserIDInput] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const onAdd = async () => {
    setServerError(null);
    const v = userIDInput.trim();
    if (!v) return;
    try {
      await add.mutateAsync(v);
      setUserIDInput('');
    } catch (err) {
      setServerError(stringifyError(err));
    }
  };

  const onRemove = async (uid: string) => {
    setServerError(null);
    try {
      await remove.mutateAsync(uid);
    } catch (err) {
      setServerError(stringifyError(err));
    }
  };

  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-text font-semibold">
            Members <span className="text-muted text-xs font-normal">({members.data?.length ?? 0})</span>
          </h3>
          <p className="text-muted text-xs mt-1">
            Structural only. Granting a role scoped to this team's id happens on
            <span className="font-mono text-accent"> /admin/assignments</span>.
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={userIDInput}
          onChange={(e) => setUserIDInput(e.target.value)}
          placeholder="paste user id (UUID)"
          className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent"
        />
        <Button onClick={onAdd} variant="secondary" disabled={!userIDInput.trim() || add.isPending}>
          Add
        </Button>
      </div>

      {serverError && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
          {serverError}
        </div>
      )}

      {members.isLoading && <div className="text-muted text-sm">Loading…</div>}
      {members.data && members.data.length === 0 && (
        <div className="text-muted text-sm">No members yet.</div>
      )}
      {members.data && members.data.length > 0 && (
        <ul className="divide-y divide-border/40">
          {members.data.map((m) => (
            <li key={m.user_id} className="py-2 flex items-center justify-between gap-3">
              <div className="min-w-0 font-mono text-sm text-text truncate">{m.user_id}</div>
              <button
                onClick={() => onRemove(m.user_id)}
                disabled={remove.isPending}
                className="text-[11px] text-muted hover:text-red-300 transition-colors"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- bits -----------------------------------------------------------

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}

function stringifyError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409 && err.message.toLowerCase().includes('children')) {
      return 'Team still has children. Unparent or delete them first.';
    }
    if (err.status === 409 && err.message.toLowerCase().includes('name')) {
      return 'A sibling team already has this name.';
    }
    if (err.status === 409 && err.message.toLowerCase().includes('cycle')) {
      return 'Parent would create a cycle. Pick a different parent.';
    }
    return `${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}
