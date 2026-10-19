/**
 * Users (`/admin/users`): accounts waiting for approval (api#266).
 *
 * Someone who signs in with Google for the first time gets an account
 * that can't do anything until an administrator approves it here with a
 * role, optionally limited to a team or a project. Declining disables
 * the account. Both need a global user_role.edit, the same permission as
 * granting roles on the Assignments page.
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { useApproveUser, useDeclineUser, usePendingUsers, type PendingUser } from '../../api/pendingUsers';
import { useRoles } from '../../api/roles';
import { useTeams } from '../../api/teams';
import { useProjects } from '../../api/tenancy';
import { useAuth } from '../../auth/AuthContext';
import { formatExact, formatShort } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { Field, Select } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { useToast } from '../../ui/toastContext';
import { buildIndentedTeams, errorText } from './roles/format';

export function Users() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('user_role.edit');
  const pending = usePendingUsers({ enabled: allowed });
  const toast = useToast();
  const [approving, setApproving] = useState<PendingUser | null>(null);
  const [declining, setDeclining] = useState<PendingUser | null>(null);
  const decline = useDeclineUser();

  if (!allowed) {
    return (
      <div>
        <PageHeader title="Users" />
        <Banner title="You can't approve new users.">
          It needs the <code className="font-mono text-mono">user_role.edit</code> permission. Ask an administrator.
        </Banner>
      </div>
    );
  }

  const rows = pending.data?.users ?? [];
  const total = pending.data?.total ?? 0;
  const columns: Column<PendingUser>[] = [
    {
      key: 'who',
      header: 'Person',
      render: (u) => (
        <span className="block min-w-0">
          <span className="block truncate font-medium text-ink">{u.display_name || u.email}</span>
          {u.display_name && u.display_name !== u.email && <span className="block truncate text-caption text-muted">{u.email}</span>}
        </span>
      ),
    },
    {
      key: 'since',
      header: 'Waiting since',
      render: (u) => (
        <span title={formatExact(u.waiting_since)} className="whitespace-nowrap">
          {formatShort(u.waiting_since)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      hiddenHeader: true,
      align: 'right',
      render: (u) => (
        <span className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setApproving(u)} aria-label={`Approve ${u.email}`}>
            Approve…
          </Button>
          <Button size="sm" variant="quiet" onClick={() => setDeclining(u)} aria-label={`Decline ${u.email}`}>
            Decline…
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Users"
        description="People who signed in with Google for the first time wait here until you approve them with a role."
      />
      <div className="flex flex-col gap-6">
        <section aria-labelledby="waiting-heading" className="flex flex-col gap-3">
          <h2 id="waiting-heading" className="text-block-heading text-ink">
            Waiting for approval{total > 0 ? ` (${total})` : ''}
          </h2>
          {pending.isLoading && <p className="text-body text-muted">Loading…</p>}
          {pending.isError && (
            <Banner
              tone="error"
              action={
                <Button variant="secondary" size="sm" onClick={() => void pending.refetch()}>
                  Try again
                </Button>
              }
            >
              {errorText(pending.error)}
            </Banner>
          )}
          {pending.isSuccess && rows.length === 0 && (
            <EmptyState title="No one is waiting.">New Google sign-ins show up here for you to approve.</EmptyState>
          )}
          {rows.length > 0 && (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(u) => u.id}
                label="Accounts waiting for approval"
                stacked={(u) => (
                  <div className="flex flex-col gap-2">
                    <div>
                      <p className="font-medium text-ink">{u.display_name || u.email}</p>
                      <p className="text-caption text-muted">
                        {u.display_name && u.display_name !== u.email
                          ? `${u.email} · waiting since ${formatShort(u.waiting_since)}`
                          : `Waiting since ${formatShort(u.waiting_since)}`}
                      </p>
                    </div>
                    <span className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setApproving(u)}>
                        Approve…
                      </Button>
                      <Button size="sm" variant="quiet" onClick={() => setDeclining(u)}>
                        Decline…
                      </Button>
                    </span>
                  </div>
                )}
              />
              {total > rows.length && (
                <p className="text-caption text-muted">
                  Showing the {rows.length} who have waited longest of {total}.
                </p>
              )}
            </>
          )}
        </section>

        {approving && (
          <ApproveDrawer
            user={approving}
            onCancel={() => setApproving(null)}
            onDone={(roleName) => {
              toast(`Approved ${approving.email} with ${roleName}.`);
              setApproving(null);
            }}
          />
        )}

        {declining && (
          <ConfirmModal
            title={`Decline ${declining.email}?`}
            body="Their account is disabled and they can't sign in. To let them in later, an administrator has to enable the account and approve it."
            confirmText="Decline"
            danger
            onCancel={() => {
              decline.reset();
              setDeclining(null);
            }}
            onConfirm={async () => {
              try {
                await decline.mutateAsync(declining.id);
                toast(`Declined ${declining.email}.`);
                setDeclining(null);
              } catch {
                // Shown in the dialog.
              }
            }}
            loading={decline.isPending}
            error={decline.error}
          />
        )}
      </div>
    </div>
  );
}

const schema = z.object({
  role_id: z.guid('Choose a role.'),
  sc_team_id: z.guid('Choose from the list.').optional().or(z.literal('')),
  sc_project_id: z.guid('Choose from the list.').optional().or(z.literal('')),
});

type FormShape = z.infer<typeof schema>;

function ApproveDrawer({ user, onDone, onCancel }: { user: PendingUser; onDone: (roleName: string) => void; onCancel: () => void }) {
  const approve = useApproveUser();
  const roles = useRoles();
  const teams = useTeams();
  const projects = useProjects();
  const teamOptions = useMemo(() => buildIndentedTeams(teams.data ?? []), [teams.data]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: { role_id: '', sc_team_id: '', sc_project_id: '' },
  });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const scope: Record<string, string> = {};
    if (data.sc_team_id) scope.team_id = data.sc_team_id;
    if (data.sc_project_id) scope.project_id = data.sc_project_id;
    try {
      await approve.mutateAsync({
        id: user.id,
        role_id: data.role_id,
        scope: Object.keys(scope).length > 0 ? scope : undefined,
      });
      onDone(roles.data?.find((r) => r.id === data.role_id)?.name ?? 'the role');
    } catch {
      // Shown below the form.
    }
  };

  return (
    <Drawer
      title="Approve"
      subtitle={`Let ${user.email} in with a role, everywhere or within a team or project.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="approve-user" variant="primary" disabled={approve.isPending} aria-busy={approve.isPending}>
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </>
      }
    >
      <form id="approve-user" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        <Field id="approve-role" label="Role" error={errors.role_id?.message ?? (roles.isError ? "Couldn't load the roles." : undefined)}>
          {(p) => (
            <Select {...p} {...register('role_id')} data-autofocus>
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
          <p className="text-caption text-muted">Optional. Leave both empty to grant the role everywhere.</p>
          <Field
            id="approve-team"
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
          <Field id="approve-project" label="Project" error={errors.sc_project_id?.message}>
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
        </fieldset>

        {approve.isError && (
          <Banner tone="error" title="Not approved.">
            {errorText(approve.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
