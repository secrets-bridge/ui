/**
 * Assignments (`/admin/assignments`): who holds which role, and where.
 * Each row gives one user a role, everywhere or narrowed by a scope
 * (project, team and its sub-teams, environment name, secret path
 * prefix, provider type).
 *
 * - "Grant a role" opens a drawer. Empty scope fields are left out of
 *   the body, so the api treats them as "any" (a grant with no scope is
 *   global).
 * - Revoke asks first.
 * - The user is typed as an id: the api has no user directory to pick
 *   from yet. People find their id on their Profile page.
 * - value_provider is team-scoped by design (Slice N5): granting it
 *   without a team hands every team's inbox to one person, so that
 *   asks for "global" to be typed.
 *
 * api: GET/POST /user-roles, DELETE /user-roles/:id.
 */

import { useMemo, useState } from 'react';
import { useForm, useWatch, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useGrantUserRole, useRevokeUserRole, useUserRoles } from '../../api/assignments';
import { useRoles } from '../../api/roles';
import { useTeams } from '../../api/teams';
import { useEnvironments, useProjects } from '../../api/tenancy';
import type { UserRole, UserRoleInput } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { providerLabel } from '../../lib/providers';
import { formatExact, formatShort } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { Field, Input, Select } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { useToast } from '../../ui/toastContext';
import { buildIndentedTeams, errorText } from './roles/format';

const PROVIDER_TYPES = ['vault', 'aws-sm', 'gcp-sm', 'azure-kv'];
const SCOPE_LABEL: Record<string, string> = {
  project_id: 'Project',
  team_id: 'Team',
  environment: 'Environment',
  secret_ref_prefix: 'Path prefix',
  provider_type: 'Provider',
};

export function Assignments() {
  const list = useUserRoles();
  const roles = useRoles();
  const projects = useProjects();
  const teams = useTeams();
  const revoke = useRevokeUserRole();
  const { identity } = useAuth();
  const toast = useToast();

  const [filter, setFilter] = useState('');
  const [granting, setGranting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<UserRole | null>(null);

  const roleName = (id: string) => roles.data?.find((r) => r.id === id)?.name ?? `${id.slice(0, 8)}…`;
  const projectName = (id: string) => projects.data?.find((p) => p.id === id)?.name ?? `${id.slice(0, 8)}…`;
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? `${id.slice(0, 8)}…`;
  const scopeValue = (k: string, v: string) =>
    k === 'project_id' ? projectName(v) : k === 'team_id' ? teamName(v) : k === 'provider_type' ? providerLabel(v) : v;

  const all = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => a.user_id.localeCompare(b.user_id) || Date.parse(b.granted_at) - Date.parse(a.granted_at)),
    [list.data],
  );
  const f = filter.trim().toLowerCase();
  const rows = f
    ? all.filter((r) => r.user_id.toLowerCase().includes(f) || (roles.data?.find((x) => x.id === r.role_id)?.name ?? '').toLowerCase().includes(f))
    : all;
  const people = new Set(all.map((r) => r.user_id)).size;

  const userCell = (r: UserRole) => (
    <span className="break-all font-mono text-mono text-ink">
      {r.user_id}
      {identity && r.user_id === identity.id && <span className="ml-2 font-sans text-caption text-muted">You</span>}
    </span>
  );
  const scopeCell = (r: UserRole) => {
    const entries = Object.entries(r.scope ?? {});
    if (entries.length === 0) return <span className="text-muted">Everywhere</span>;
    return (
      <span className="flex flex-col gap-0.5">
        {entries.map(([k, v]) => (
          <span key={k}>
            <span className="text-muted">{SCOPE_LABEL[k] ?? k}:</span>{' '}
            <span className={k === 'secret_ref_prefix' || k === 'environment' ? 'font-mono text-mono' : ''}>{scopeValue(k, v)}</span>
          </span>
        ))}
      </span>
    );
  };
  const revokeButton = (r: UserRole) => (
    <Button
      variant="danger"
      size="sm"
      onClick={() => {
        revoke.reset();
        setConfirmRevoke(r);
      }}
      aria-label={`Revoke ${roleName(r.role_id)} from ${r.user_id}`}
    >
      Revoke…
    </Button>
  );

  const columns: Column<UserRole>[] = [
    { key: 'user', header: 'User', render: userCell, className: 'max-w-[300px]' },
    { key: 'role', header: 'Role', render: (r) => <span className="font-mono text-mono">{roleName(r.role_id)}</span> },
    { key: 'scope', header: 'Scope', render: scopeCell },
    {
      key: 'granted',
      header: 'Granted (UTC)',
      render: (r) => (
        <span title={`${formatExact(r.granted_at)}${r.granted_by ? ` by ${r.granted_by}` : ''}`} className="whitespace-nowrap">
          {formatShort(r.granted_at)}
        </span>
      ),
    },
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', render: revokeButton },
  ];

  return (
    <div>
      <PageHeader
        title="Assignments"
        description={
          list.data
            ? `${all.length} ${all.length === 1 ? 'assignment' : 'assignments'} for ${people} ${people === 1 ? 'user' : 'users'}. Each gives one user a role, everywhere or within a scope.`
            : 'Each assignment gives one user a role, everywhere or within a scope.'
        }
        actions={
          <Button variant="primary" onClick={() => setGranting(true)}>
            Grant a role
          </Button>
        }
      />

      {all.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="min-w-[260px] flex-1 max-[600px]:w-full">
            <span className="sr-only">Filter by user id or role</span>
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by user id or role" className="w-full" />
          </label>
          {f && (
            <>
              <Button variant="quiet" onClick={() => setFilter('')}>
                Reset filter
              </Button>
              <span className="text-ui font-normal text-muted" aria-live="polite">
                Showing {rows.length} of {all.length}
              </span>
            </>
          )}
        </div>
      )}

      {list.isLoading && <p className="text-muted">Loading assignments…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the assignments."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {errorText(list.error)}
        </Banner>
      )}
      {list.data &&
        (all.length === 0 ? (
          <EmptyState title="No assignments yet.">Grant a role to give someone access.</EmptyState>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">No assignment matches that filter.</p>
        ) : (
          <DataTable
            label="Assignments"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            minWidth={780}
            stacked={(r) => (
              <div className="flex flex-col gap-1">
                <p className="flex items-start justify-between gap-3">
                  <span className="font-mono text-mono font-medium">{roleName(r.role_id)}</span>
                  {revokeButton(r)}
                </p>
                <p className="text-caption">{userCell(r)}</p>
                <div className="text-caption">{scopeCell(r)}</div>
                <p className="text-caption text-muted">Granted {formatShort(r.granted_at)} UTC</p>
              </div>
            )}
          />
        ))}

      {granting && (
        <GrantDrawer
          onDone={(roleLabel, user) => {
            setGranting(false);
            toast(`Granted ${roleLabel} to ${user}.`);
          }}
          onCancel={() => setGranting(false)}
        />
      )}

      {confirmRevoke && (
        <ConfirmModal
          title={`Revoke ${roleName(confirmRevoke.role_id)}?`}
          body={`${identity && confirmRevoke.user_id === identity.id ? 'This is your own assignment: you may lose access to this page. ' : ''}User ${confirmRevoke.user_id} loses this role${Object.keys(confirmRevoke.scope ?? {}).length ? ' in this scope' : ''} at once. Requests already approved go on; anything new needs another assignment that covers it.`}
          confirmText="Revoke"
          danger
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            try {
              await revoke.mutateAsync(confirmRevoke.id);
              toast(`Revoked ${roleName(confirmRevoke.role_id)} from ${confirmRevoke.user_id}.`);
              setConfirmRevoke(null);
            } catch {
              // Shown in the dialog.
            }
          }}
          loading={revoke.isPending}
          error={revoke.error}
        />
      )}
    </div>
  );
}

// --- grant drawer ---------------------------------------------------

const UUID_MSG = 'Choose from the list.';
const schema = z.object({
  user_id: z.string().trim().min(1, "Enter the user's id.").max(255, 'That id is too long.'),
  role_id: z.guid('Choose a role.'),
  // Scope inputs: all optional, empty ones are left out of the body.
  sc_project_id: z.guid(UUID_MSG).optional().or(z.literal('')),
  // A team grant covers the team and every sub-team's projects
  // (auth.EffectiveProjectAccess, api#50).
  sc_team_id: z.guid(UUID_MSG).optional().or(z.literal('')),
  sc_environment: z.string().trim().max(120, 'Keep it under 120 characters.').optional(),
  sc_secret_ref_prefix: z.string().trim().max(255, 'Keep it under 255 characters.').optional(),
  sc_provider_type: z.string().max(60).optional(),
});

type FormShape = z.infer<typeof schema>;

function GrantDrawer({ onDone, onCancel }: { onDone: (roleLabel: string, user: string) => void; onCancel: () => void }) {
  const grant = useGrantUserRole();
  const roles = useRoles();
  const projects = useProjects();
  const envs = useEnvironments();
  const teams = useTeams();

  const {
    register,
    handleSubmit,
    control,
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

  const teamOptions = useMemo(() => buildIndentedTeams(teams.data ?? []), [teams.data]);
  // Environment scope is by name: several projects can each have "uat".
  const envNames = useMemo(() => [...new Set((envs.data ?? []).map((e) => e.name))].sort(), [envs.data]);

  const [roleId, teamId] = useWatch({ control, name: ['role_id', 'sc_team_id'] });
  const role = roles.data?.find((r) => r.id === roleId);
  const needsGlobalConfirm = role?.name === 'value_provider' && !teamId;
  const [globalTyped, setGlobalTyped] = useState('');
  const [gateTried, setGateTried] = useState(false);
  const globalOk = globalTyped.trim() === 'global';

  const onValid: SubmitHandler<FormShape> = async (data) => {
    if (needsGlobalConfirm && !globalOk) {
      setGateTried(true);
      document.getElementById('grant-global')?.focus();
      return;
    }
    const scope: Record<string, string> = {};
    if (data.sc_project_id) scope.project_id = data.sc_project_id;
    if (data.sc_team_id) scope.team_id = data.sc_team_id;
    if (data.sc_environment) scope.environment = data.sc_environment;
    if (data.sc_secret_ref_prefix) scope.secret_ref_prefix = data.sc_secret_ref_prefix;
    if (data.sc_provider_type) scope.provider_type = data.sc_provider_type;
    const body: UserRoleInput = {
      user_id: data.user_id,
      role_id: data.role_id,
      scope: Object.keys(scope).length > 0 ? scope : undefined,
    };
    try {
      await grant.mutateAsync(body);
      onDone(role?.name ?? 'the role', data.user_id);
    } catch {
      // Shown below the form.
    }
  };

  return (
    <Drawer
      title="Grant a role"
      subtitle="Give one user a role, everywhere or within a scope."
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={grant.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="grant-role" variant="primary" disabled={grant.isPending} aria-busy={grant.isPending}>
            {grant.isPending ? 'Granting…' : 'Grant role'}
          </Button>
        </>
      }
    >
      <form id="grant-role" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        <Field id="grant-user" label="User id" hint="Each person can find their user id on their Profile page." error={errors.user_id?.message}>
          {(p) => (
            <Input {...p} {...register('user_id')} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono" autoComplete="off" spellCheck={false} data-autofocus />
          )}
        </Field>

        <Field id="grant-role-id" label="Role" error={errors.role_id?.message ?? (roles.isError ? "Couldn't load the roles." : undefined)}>
          {(p) => (
            <Select {...p} {...register('role_id')}>
              <option value="">{roles.isLoading ? 'Loading roles…' : 'Choose a role'}</option>
              {roles.data?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.is_system ? ' (built in)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <fieldset className="flex min-w-0 flex-col gap-3.5 rounded-md border border-border px-4 pb-4 pt-2">
          <legend className="px-1 text-body font-semibold text-ink">Scope</legend>
          <p className="text-caption text-muted">All optional. Leave everything empty to grant the role everywhere.</p>
          <Field id="grant-project" label="Project" error={errors.sc_project_id?.message}>
            {(p) => (
              <Select {...p} {...register('sc_project_id')}>
                <option value="">Any project</option>
                {projects.data
                  ?.filter((x) => x.status === 'active')
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field
            id="grant-team"
            label="Team"
            hint="Covers the team and every team under it, with all their projects."
            error={errors.sc_team_id?.message}
          >
            {(p) => (
              <Select {...p} {...register('sc_team_id')}>
                <option value="">Any team</option>
                {teamOptions.map((o) => (
                  <option key={o.team.id} value={o.team.id}>
                    {o.indentedLabel}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="grant-env" label="Environment" hint="By name, so uat covers every project's uat environment." error={errors.sc_environment?.message}>
            {(p) => (
              <>
                <Input {...p} list="grant-env-options" {...register('sc_environment')} placeholder="uat" className="font-mono" autoComplete="off" />
                <datalist id="grant-env-options">
                  {envNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
          <Field id="grant-prefix" label="Secret path prefix" hint="Only secrets whose path starts with this, like billing/." error={errors.sc_secret_ref_prefix?.message}>
            {(p) => <Input {...p} {...register('sc_secret_ref_prefix')} placeholder="billing/" className="font-mono" autoComplete="off" spellCheck={false} />}
          </Field>
          <Field id="grant-provider" label="Provider" error={errors.sc_provider_type?.message}>
            {(p) => (
              <Select {...p} {...register('sc_provider_type')}>
                <option value="">Any provider</option>
                {PROVIDER_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {providerLabel(t)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>

        {needsGlobalConfirm && (
          <div className="flex flex-col gap-3 rounded-md border border-bad-line px-3.5 py-3">
            <p className="text-ui font-normal">
              <span className="font-semibold text-bad">value_provider without a team covers every team's inbox.</span>{' '}
              That's rarely what you want. Pick a team in Scope, or type global to grant it everywhere.
            </p>
            <Field id="grant-global" label="Type global to confirm" error={gateTried && !globalOk ? 'Pick a team, or type global.' : undefined}>
              {(p) => <Input {...p} value={globalTyped} onChange={(e) => setGlobalTyped(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />}
            </Field>
          </div>
        )}

        {grant.isError && (
          <Banner tone="error" title="Not granted.">
            {errorText(grant.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
