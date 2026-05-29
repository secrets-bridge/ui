/**
 * Roles admin page. Visual layout matches the Figma frame
 * `Roles · /admin/roles (list)` on page 06:
 *
 *   PageHeader: "Roles" / "Define what each role can do across the
 *   platform. Permissions are grouped by resource." / "+ New role"
 *   primary CTA (brand gradient pill).
 *
 *   Card containing a table:
 *     NAME (mono)  · DESCRIPTION · PERMISSIONS · TYPE · ACTIONS
 *     System rows show a small `system` pill next to the name.
 *     Permissions column shows count + label ("N permissions" / "all").
 *     Actions column is text-only (Edit + Delete); Delete dims for
 *     system rows.
 *
 *   System-seed footer note.
 *
 * Drawer + ConfirmModal moved to `src/ui/` as shared components.
 *
 * Behavior is unchanged: list + create + edit-permissions + delete.
 * api endpoint: POST /roles, PUT /roles/:id/permissions, DELETE.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import type { Role } from '../../api/types';
import {
  useCreateRole,
  useDeleteRole,
  useRoles,
  useUpdateRole,
} from '../../api/roles';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';
import { RoleForm } from './RoleForm';

export function Roles() {
  const list = useRoles();
  const create = useCreateRole();
  const del = useDeleteRole();

  const [editing, setEditing] = useState<Role | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Role | null>(null);

  return (
    <div>
      <PageHeader
        title="Roles"
        description="Define what each role can do across the platform. Permissions are grouped by resource."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            + New role
          </Button>
        }
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load roles</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No roles defined yet. The api seeds <code className="font-mono">admin</code>{' '}
          / <code className="font-mono">approver</code> /{' '}
          <code className="font-mono">developer</code> on first boot.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
                <tr className="border-b border-border/60">
                  <Th>Name</Th>
                  <Th>Description</Th>
                  <Th>Permissions</Th>
                  <Th>Type</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((r) => (
                  <RoleRow
                    key={r.id}
                    role={r}
                    onEdit={() => {
                      setCreating(false);
                      setEditing(r);
                    }}
                    onDelete={() => setConfirmDelete(r)}
                  />
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-muted text-xs mt-3">
            System seed roles can't be deleted — delete is disabled (muted) with a tooltip <em>"System seed — not deletable"</em>.
          </p>
        </>
      )}

      {creating && (
        <Drawer title="New role" onClose={() => setCreating(false)}>
          <RoleForm
            onCreate={async (body) => {
              await create.mutateAsync(body);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            submitting={create.isPending}
            submitError={create.error}
          />
        </Drawer>
      )}

      {editing && <EditDrawer role={editing} onClose={() => setEditing(null)} />}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete role "${confirmDelete.name}"?`}
          body="This permanently removes the role. Members lose its permissions immediately. This cannot be undone."
          confirmText="Delete"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            await del.mutateAsync(confirmDelete.id);
            setConfirmDelete(null);
          }}
          loading={del.isPending}
          error={del.error}
        />
      )}
    </div>
  );
}

// --- row + cell bits ------------------------------------------------

function RoleRow({
  role,
  onEdit,
  onDelete,
}: {
  role: Role;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sys = !!role.is_system;
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20">
      <Td>
        <div className="flex items-center gap-2">
          <span className="font-mono text-accent text-sm">{role.name}</span>
          {sys && (
            <StatusPill variant="system" tone="outline">
              system
            </StatusPill>
          )}
        </div>
      </Td>
      <Td className="text-muted">
        {role.description || (
          <span className="italic text-muted/60">no description</span>
        )}
      </Td>
      <Td>
        <PermissionsCell role={role} />
      </Td>
      <Td className="text-text">{sys ? 'System' : 'Custom'}</Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onEdit}
            className="text-accent hover:text-accent-bright text-sm font-medium"
          >
            Edit
          </button>
          <button
            onClick={onDelete}
            disabled={sys}
            title={sys ? 'System seed — not deletable' : undefined}
            className={
              sys
                ? 'text-muted/50 cursor-not-allowed text-sm font-medium'
                : 'text-red-300 hover:text-red-200 text-sm font-medium'
            }
          >
            Delete
          </button>
        </div>
      </Td>
    </tr>
  );
}

function PermissionsCell({ role }: { role: Role }) {
  const n = role.permissions.length;
  // System "admin" role gets the special "all" label per the Figma
  // frame — visually distinguishes the omnipotent role from large but
  // bounded permission lists.
  if (role.name === 'admin') {
    return <span className="text-accent text-sm font-medium">all</span>;
  }
  if (n === 0) {
    return <span className="text-muted italic text-sm">none</span>;
  }
  return (
    <span className="text-accent text-sm font-medium">
      {n} permission{n === 1 ? '' : 's'}
    </span>
  );
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-5 py-3.5 align-middle ${className}`}>{children}</td>;
}

// --- edit drawer ----------------------------------------------------

function EditDrawer({ role, onClose }: { role: Role; onClose: () => void }) {
  const update = useUpdateRole(role.id);
  return (
    <Drawer title={`Edit ${role.name}`} onClose={onClose}>
      <p className="text-muted text-sm mb-4 -mt-2">
        Name and description are immutable after creation.
      </p>
      <RoleForm
        initial={role}
        onUpdatePermissions={async (body) => {
          await update.mutateAsync(body);
          onClose();
        }}
        onCancel={onClose}
        submitting={update.isPending}
        submitError={update.error}
      />
    </Drawer>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
