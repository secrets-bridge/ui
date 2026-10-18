/**
 * Roles (`/admin/roles`): every role with its description, how many
 * permissions it carries and whether it is built in. The name opens the
 * role in a drawer, where its permissions can change; name and
 * description are fixed at create (the api has no rename).
 *
 * Built-in roles (`is_system`) can be edited but not deleted: the api
 * answers 409 on DELETE for them, so the page offers no Delete.
 *
 * api: GET/POST /roles, PUT /roles/:id/permissions, DELETE /roles/:id.
 */

import { useState } from 'react';

import { useCreateRole, useDeleteRole, useRoles, useUpdateRole } from '../../api/roles';
import type { Role } from '../../api/types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { useToast } from '../../ui/toastContext';
import { RoleForm } from './RoleForm';
import { errorText } from './roles/format';

export function Roles() {
  const list = useRoles();
  const create = useCreateRole();
  const del = useDeleteRole();
  const toast = useToast();

  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  const rows = [...(list.data ?? [])].sort(
    (a, b) => Number(!!b.is_system) - Number(!!a.is_system) || a.name.localeCompare(b.name),
  );
  const builtIn = rows.filter((r) => r.is_system).length;

  const openCreate = () => {
    create.reset();
    setEditing(null);
    setCreating(true);
  };

  const nameButton = (r: Role) => (
    <button
      type="button"
      onClick={() => {
        setCreating(false);
        setEditing(r);
      }}
      className="text-left font-mono text-mono font-medium text-accent hover:underline"
    >
      {r.name}
    </button>
  );

  const columns: Column<Role>[] = [
    { key: 'name', header: 'Role', render: nameButton },
    {
      key: 'description',
      header: 'Description',
      render: (r) => (r.description ? <span>{r.description}</span> : <span className="text-muted">No description</span>),
      className: 'max-w-[420px]',
    },
    { key: 'perms', header: 'Permissions', render: (r) => <PermissionCount role={r} />, className: 'whitespace-nowrap' },
    { key: 'type', header: 'Type', render: (r) => (r.is_system ? 'Built in' : <span className="text-muted">Custom</span>) },
    {
      key: 'actions',
      header: 'Actions',
      hiddenHeader: true,
      align: 'right',
      render: (r) =>
        r.is_system ? null : (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(r)} aria-label={`Delete ${r.name}`}>
            Delete…
          </Button>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Roles"
        description={
          list.data
            ? `${rows.length} ${rows.length === 1 ? 'role' : 'roles'}, ${builtIn} built in. A role is a set of permissions; assignments give it to people.`
            : 'A role is a set of permissions; assignments give it to people.'
        }
        actions={
          <Button variant="primary" onClick={openCreate}>
            Create role
          </Button>
        }
      />

      {list.isLoading && <p className="text-muted">Loading roles…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the roles."
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
        (rows.length === 0 ? (
          <EmptyState title="No roles yet.">
            The api creates the built-in roles (admin, approver, developer and others) when it first starts.
          </EmptyState>
        ) : (
          <>
            <DataTable
              label="Roles"
              columns={columns}
              rows={rows}
              rowKey={(r) => r.id}
              onRowClick={(r) => {
                setCreating(false);
                setEditing(r);
              }}
              minWidth={720}
              stacked={(r) => (
                <div className="flex flex-col gap-1">
                  <p className="flex items-center justify-between gap-3">
                    {nameButton(r)}
                    <span className="text-caption text-muted">{r.is_system ? 'Built in' : 'Custom'}</span>
                  </p>
                  {r.description && <p className="text-caption text-muted">{r.description}</p>}
                  <p className="flex items-center justify-between gap-3 text-caption">
                    <PermissionCount role={r} />
                    {!r.is_system && (
                      <Button variant="danger" size="sm" onClick={() => setConfirmDelete(r)} aria-label={`Delete ${r.name}`}>
                        Delete…
                      </Button>
                    )}
                  </p>
                </div>
              )}
            />
            <p className="mt-2 text-caption text-muted">Built-in roles can be edited but not deleted.</p>
          </>
        ))}

      {creating && (
        <RoleForm
          onCreate={async (body) => {
            await create.mutateAsync(body);
            setCreating(false);
            toast(`Created role ${body.name}.`);
          }}
          onCancel={() => setCreating(false)}
          submitting={create.isPending}
          submitError={create.error}
        />
      )}

      {editing && <EditRole role={editing} onClose={() => setEditing(null)} />}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete role ${confirmDelete.name}?`}
          body="The role and every assignment of it are removed, so people who had it lose its permissions at once. Workflows that used it as their approver role stop requiring it. This can't be undone."
          confirmText="Delete role"
          danger
          onCancel={() => {
            del.reset();
            setConfirmDelete(null);
          }}
          onConfirm={async () => {
            try {
              await del.mutateAsync(confirmDelete.id);
              toast(`Deleted role ${confirmDelete.name}.`);
              setConfirmDelete(null);
            } catch {
              // Shown in the dialog.
            }
          }}
          loading={del.isPending}
          error={del.error}
        />
      )}
    </div>
  );
}

function PermissionCount({ role }: { role: Role }) {
  const n = role.permissions.length;
  if (n === 0) return <span className="text-muted">None</span>;
  return (
    <span title={[...role.permissions].sort().join(', ')}>
      {n} {n === 1 ? 'permission' : 'permissions'}
    </span>
  );
}

function EditRole({ role, onClose }: { role: Role; onClose: () => void }) {
  const update = useUpdateRole(role.id);
  const toast = useToast();
  return (
    <RoleForm
      initial={role}
      onUpdatePermissions={async (body) => {
        await update.mutateAsync(body);
        onClose();
        toast(`Saved permissions for ${role.name}.`);
      }}
      onCancel={onClose}
      submitting={update.isPending}
      submitError={update.error}
    />
  );
}
