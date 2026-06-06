/**
 * Assignments admin page (`/admin/assignments`).
 *
 * The third leg of the pattern-2 RBAC tripod (the first two being
 * Roles + Projects). Each row binds a user to a role with an optional
 * narrowing scope.
 *
 * Polished in ui#17 to match the design pattern (PageHeader, Card,
 * shared `src/ui/` primitives, StatusPill for the role + scope chips).
 *
 * Layout:
 *   - Filter strip + table of every assignment in the system. Role
 *     pill + scope chips per row.
 *   - "+ Grant role" drawer with a role dropdown + project +
 *     environment + secret_ref_prefix + provider_type inputs.
 *   - Per-row Revoke confirm.
 *
 * Hard rules:
 *   - The user_id field is free-form text today (no users table —
 *     identities come from the future OIDC flow, api#26).
 *   - Empty scope fields are stripped on submit so the api treats
 *     them as wildcards (matching the policy_rules.selector pattern).
 *   - Project_id is a UUID dropdown hydrated from useProjects;
 *     environment is a name input (not a UUID — the api scope keys
 *     reference envs by name to match user_roles.scope).
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import type { UserRole, UserRoleInput } from '../../api/types';
import {
  useGrantUserRole,
  useRevokeUserRole,
  useUserRoles,
} from '../../api/assignments';
import { useRoles } from '../../api/roles';
import { useTeams, type Team } from '../../api/teams';
import { useEnvironments, useProjects } from '../../api/tenancy';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';

export function Assignments() {
  const list = useUserRoles();
  const roles = useRoles();
  const projects = useProjects();
  const teamLookup = useTeams();
  const revoke = useRevokeUserRole();

  const [filter, setFilter] = useState('');
  const [granting, setGranting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<UserRole | null>(null);

  const filtered = useMemo(() => {
    if (!list.data) return [];
    if (!filter.trim()) return list.data;
    const f = filter.toLowerCase();
    return list.data.filter((r) => r.user_id.toLowerCase().includes(f));
  }, [list.data, filter]);

  const roleName = (id: string) =>
    roles.data?.find((r) => r.id === id)?.name ?? id.slice(0, 8) + '…';

  const projectName = (id: string) =>
    projects.data?.find((p) => p.id === id)?.name ?? id.slice(0, 8) + '…';

  const teamName = (id: string) =>
    teamLookup.data?.find((t) => t.id === id)?.name ?? id.slice(0, 8) + '…';

  return (
    <div>
      <PageHeader
        title="Assignments"
        description="User × role × scope bindings. Scope keys narrow the assignment to a single project / environment / ref prefix / provider type. Empty scope = global."
        actions={
          <Button variant="primary" onClick={() => setGranting(true)}>
            + Grant role
          </Button>
        }
      />

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by user_id…"
          className="flex-1 bg-bg border border-border rounded-lg px-3.5 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
        />
        {filter && (
          <Button variant="secondary" size="sm" onClick={() => setFilter('')}>
            Clear
          </Button>
        )}
      </div>

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">
            Failed to load assignments
          </div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No assignments yet. Grant a role to start scoping access.
        </Card>
      )}

      {list.data && list.data.length > 0 && filtered.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No assignments match{' '}
          <code className="font-mono text-accent">{filter}</code>.
        </Card>
      )}

      {filtered.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Scope</Th>
                <Th>Granted</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <AssignmentRow
                  key={r.id}
                  row={r}
                  roleName={roleName(r.role_id)}
                  projectName={projectName}
                  teamName={teamName}
                  onRevoke={() => setConfirmRevoke(r)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {granting && (
        <Drawer title="Grant role" onClose={() => setGranting(false)}>
          <AssignmentForm
            onDone={() => setGranting(false)}
            onCancel={() => setGranting(false)}
          />
        </Drawer>
      )}

      {confirmRevoke && (
        <ConfirmModal
          title={`Revoke ${roleName(confirmRevoke.role_id)} from ${confirmRevoke.user_id}?`}
          body="This assignment will be removed. Any in-flight requests already gated on this scope continue uninterrupted; new requests fall back to whatever other assignments the user has."
          confirmText="Revoke"
          danger
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            await revoke.mutateAsync(confirmRevoke.id);
            setConfirmRevoke(null);
          }}
          loading={revoke.isPending}
          error={revoke.error}
        />
      )}
    </div>
  );
}

// --- row + cell bits ------------------------------------------------

function AssignmentRow({
  row: r,
  roleName,
  projectName,
  teamName,
  onRevoke,
}: {
  row: UserRole;
  roleName: string;
  projectName: (id: string) => string;
  teamName: (id: string) => string;
  onRevoke: () => void;
}) {
  const scopeKeys = Object.entries(r.scope ?? {});
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top">
      <Td>
        <span className="font-mono text-text text-sm">{r.user_id}</span>
      </Td>
      <Td>
        <StatusPill variant="accent" tone="outline">
          <span className="font-mono">{roleName}</span>
        </StatusPill>
      </Td>
      <Td>
        {scopeKeys.length === 0 ? (
          <span className="text-muted text-xs italic">global</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {scopeKeys.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border px-2.5 py-0.5 text-[11px] font-mono"
              >
                <span className="text-muted">{k}</span>
                <span className="text-muted/50">=</span>
                <span className="text-accent">
                  {k === 'project_id'
                    ? projectName(v)
                    : k === 'team_id'
                      ? teamName(v)
                      : v}
                </span>
              </span>
            ))}
          </div>
        )}
      </Td>
      <Td className="text-muted text-xs">
        <div>{r.granted_at.slice(0, 10)}</div>
        {r.granted_by && (
          <div className="text-muted/70 mt-0.5">by {r.granted_by}</div>
        )}
      </Td>
      <Td className="text-right">
        <button
          onClick={onRevoke}
          className="text-red-300 hover:text-red-200 text-sm font-medium"
        >
          Revoke
        </button>
      </Td>
    </tr>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-5 py-3.5 align-top ${className}`}>{children}</td>;
}

// --- form -----------------------------------------------------------

const schema = z.object({
  user_id: z.string().min(1, 'user_id is required').max(255),
  role_id: z.string().uuid('pick a role'),
  // Scope inputs (all optional; empty stripped on submit)
  sc_project_id: z.string().uuid().optional().or(z.literal('')),
  // team_id: when set, the api expands the grant to the team's
  // descendant subtree via auth.EffectiveProjectAccess (api#50). This
  // is the "section head over X" pattern — Alice grants Bob
  // `secret.approve` scoped to team "Section", and Bob covers every
  // team / project under Section automatically.
  sc_team_id: z.string().uuid().optional().or(z.literal('')),
  sc_environment: z.string().max(120).optional(),
  sc_secret_ref_prefix: z.string().max(255).optional(),
  sc_provider_type: z.string().max(60).optional(),
});

type FormShape = z.infer<typeof schema>;

function AssignmentForm({
  onDone,
  onCancel,
}: {
  onDone: () => void;
  onCancel: () => void;
}) {
  const grant = useGrantUserRole();
  const roles = useRoles();
  const projects = useProjects();
  const envs = useEnvironments();
  const teams = useTeams();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      user_id: '',
      role_id: '',
      sc_project_id: '',
      sc_team_id: '',
      sc_environment: '',
      sc_secret_ref_prefix: '',
      sc_provider_type: '',
    },
  });

  // Teams flattened with a depth-indent prefix so the dropdown shows
  // the hierarchy without rendering an actual tree (browsers don't
  // support nested <option>s). Built from a single buildIndentedTeams
  // pass so editing a team's parent reorders the list automatically.
  const teamOptions = useMemo(() => buildIndentedTeams(teams.data ?? []), [teams.data]);

  // Distinct environment names for the dropdown (the api scope key is
  // by name, not UUID; multiple projects can each have a "uat" env).
  const envNames = useMemo(() => {
    const set = new Set<string>();
    envs.data?.forEach((e) => set.add(e.name));
    return Array.from(set).sort();
  }, [envs.data]);

  // Slice N5 — value_provider is team-scoped by design. The role
  // controls who can be on a team's inbox; granting it globally hands
  // every team's inbox to one user. Require a team pick OR a
  // type-to-confirm "global".
  const watchedRoleID = watch('role_id');
  const watchedTeamID = watch('sc_team_id');
  const selectedRole = roles.data?.find((r) => r.id === watchedRoleID);
  const isValueProviderRole = selectedRole?.name === 'value_provider';
  const teamPicked = !!watchedTeamID;
  const [globalConfirmTyped, setGlobalConfirmTyped] = useState('');
  const showGlobalScopeGate =
    isValueProviderRole && !teamPicked;
  const globalGateOpen = showGlobalScopeGate;
  const globalConfirmOk = globalConfirmTyped.trim() === 'global';

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const scope: Record<string, string> = {};
    if (data.sc_project_id) scope.project_id = data.sc_project_id;
    if (data.sc_team_id) scope.team_id = data.sc_team_id;
    if (data.sc_environment) scope.environment = data.sc_environment;
    if (data.sc_secret_ref_prefix)
      scope.secret_ref_prefix = data.sc_secret_ref_prefix;
    if (data.sc_provider_type) scope.provider_type = data.sc_provider_type;

    // Slice N5 — enforce the value_provider team-pick rule here too
    // (defense in depth alongside the submit-button gate).
    if (isValueProviderRole && !data.sc_team_id && !globalConfirmOk) {
      return;
    }

    const body: UserRoleInput = {
      user_id: data.user_id,
      role_id: data.role_id,
      scope: Object.keys(scope).length > 0 ? scope : undefined,
    };
    await grant.mutateAsync(body);
    onDone();
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <Field
        label="User ID"
        error={errors.user_id?.message}
        hint="Free-form for now (no users table — identities come from the future OIDC flow). Use the same identifier your IdP issues as `sub`."
      >
        <input
          type="text"
          {...register('user_id')}
          className={inputCls}
          placeholder="alice"
        />
      </Field>

      <Field label="Role" error={errors.role_id?.message}>
        <select {...register('role_id')} className={inputCls}>
          <option value="">— pick a role —</option>
          {roles.data?.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
              {r.is_system ? ' (system)' : ''}
            </option>
          ))}
        </select>
        {roles.isError && (
          <div className="text-xs text-red-300">failed to load roles</div>
        )}
      </Field>

      <fieldset className="border border-border/60 rounded-lg p-4 space-y-3">
        <legend className="text-[11px] text-muted uppercase tracking-wider px-1 font-medium">
          Scope — narrow the assignment. All optional; empty = global.
        </legend>

        <Field label="Project" error={errors.sc_project_id?.message}>
          <select {...register('sc_project_id')} className={inputCls}>
            <option value="">(any project)</option>
            {projects.data
              ?.filter((p) => p.status === 'active')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>

        <Field
          label="Team"
          error={errors.sc_team_id?.message}
          hint="Grant applies to the team AND every descendant team's projects. Use for 'section head over X' — Alice grants Bob `secret.approve` scoped to team 'Section', and Bob covers every team/project under Section automatically."
        >
          <select {...register('sc_team_id')} className={inputCls}>
            <option value="">(any team)</option>
            {teamOptions.map((opt) => (
              <option key={opt.team.id} value={opt.team.id}>
                {opt.indentedLabel}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Environment"
          hint="By NAME (not UUID) since multiple projects can each have `uat`."
        >
          <input
            list="env-options"
            {...register('sc_environment')}
            className={inputCls}
            placeholder="uat"
          />
          <datalist id="env-options">
            {envNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Secret ref prefix"
          hint="Prefix match (e.g. `billing/`)."
        >
          <input
            type="text"
            {...register('sc_secret_ref_prefix')}
            className={inputCls}
            placeholder="billing/"
          />
        </Field>

        <Field
          label="Provider type"
          hint="exact: vault | aws-sm | gcp-sm | azure-kv"
        >
          <input
            type="text"
            {...register('sc_provider_type')}
            className={inputCls}
            placeholder="vault"
          />
        </Field>
      </fieldset>

      {globalGateOpen && (
        <div className="bg-yellow-400/10 border border-yellow-400/40 border-l-4 border-l-yellow-400 rounded-lg px-3 py-3 text-xs space-y-2">
          <p className="text-yellow-200 font-semibold">
            value_provider with no team scope = global inbox access
          </p>
          <p className="text-yellow-200/90">
            Without a team pick, this user becomes a value provider for{' '}
            <em>every</em> team's cross-team inbox. That's almost never
            what you want — assign a specific team in Scope, or type{' '}
            <span className="font-mono">global</span> below to override.
          </p>
          <input
            type="text"
            value={globalConfirmTyped}
            onChange={(e) => setGlobalConfirmTyped(e.target.value)}
            placeholder="type `global` to confirm"
            className="w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          />
        </div>
      )}

      {grant.error instanceof ApiError && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
          {grant.error.status}: {grant.error.message}
        </div>
      )}

      <div className="flex items-center justify-between pt-3 border-t border-border/60">
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          size="md"
          disabled={
            grant.isPending ||
            (isValueProviderRole && !teamPicked && !globalConfirmOk)
          }
        >
          {grant.isPending ? 'Saving…' : 'Grant'}
        </Button>
      </div>
    </form>
  );
}

// --- shared bits ----------------------------------------------------

const inputCls =
  'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && !error && (
        <div className="text-[11px] text-muted/80">{hint}</div>
      )}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

// buildIndentedTeams takes the flat team list and produces a
// preorder-traversal list with each entry decorated with a label
// like "··· alpha-east-billing" so a flat <select> can display the
// hierarchy. Detached subtrees become roots so they stay pickable.
interface IndentedTeamOption {
  team: Team;
  indentedLabel: string;
}

function buildIndentedTeams(all: Team[]): IndentedTeamOption[] {
  const ids = new Set(all.map((t) => t.id));
  const byParent = new Map<string | null, Team[]>();
  for (const t of all) {
    const parent = t.parent_team_id && ids.has(t.parent_team_id) ? t.parent_team_id : null;
    const bucket = byParent.get(parent) ?? [];
    bucket.push(t);
    byParent.set(parent, bucket);
  }
  const sorted = (arr: Team[]) => [...arr].sort((a, b) => a.name.localeCompare(b.name));
  const out: IndentedTeamOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const t of sorted(byParent.get(parent) ?? [])) {
      const prefix = depth === 0 ? '' : '· '.repeat(depth);
      const archived = t.status === 'archived' ? ' (archived)' : '';
      out.push({ team: t, indentedLabel: `${prefix}${t.name}${archived}` });
      walk(t.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
