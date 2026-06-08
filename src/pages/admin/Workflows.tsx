/**
 * Workflows admin page. Visual layout matches the Roles + Policies
 * pattern landed in ui#13 — PageHeader + Card-wrapped table + shared
 * Drawer + ConfirmModal from `src/ui/`.
 *
 * System workflows (the seed `standard` row) are editable but the
 * Delete action is disabled — the api returns 409 on DELETE for them.
 *
 * Mutation invariants (unchanged from the original page):
 * - Every successful create/update/delete invalidates the list query
 *   so the table re-renders without a manual refetch.
 * - The form drawer disappears immediately on successful submit; the
 *   refreshed row appears in the table once Query refetches.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import type { Workflow, WorkflowInput } from '../../api/types';
import {
  useCreateWorkflow,
  useDeleteWorkflow,
  useUpdateWorkflow,
  useWorkflows,
} from '../../api/workflows';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';
import { WorkflowForm } from './WorkflowForm';

export function Workflows() {
  const list = useWorkflows();
  const create = useCreateWorkflow();
  const del = useDeleteWorkflow();

  const [editing, setEditing] = useState<Workflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null);

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Approval templates resolved at request submit time. System seeds are editable but cannot be deleted."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            + New workflow
          </Button>
        }
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load workflows</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No workflows defined yet. The api seeds one named{' '}
          <code className="font-mono">standard</code> on first boot.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
                <tr className="border-b border-border/60">
                  <Th>Name</Th>
                  <Th>Approvers</Th>
                  <Th>Justification</Th>
                  <Th>Self-approval</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((w) => (
                  <WorkflowRow
                    key={w.id}
                    workflow={w}
                    onEdit={() => {
                      setCreating(false);
                      setEditing(w);
                    }}
                    onDelete={() => setConfirmDelete(w)}
                  />
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-muted text-xs mt-3">
            System seed workflows can't be deleted — delete is disabled
            (muted) with a tooltip <em>"System seed — not deletable"</em>.
          </p>
        </>
      )}

      {creating && (
        <Drawer title="New workflow" onClose={() => setCreating(false)}>
          <WorkflowForm
            onSubmit={async (body: WorkflowInput) => {
              await create.mutateAsync(body);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            submitting={create.isPending}
            submitError={create.error}
          />
        </Drawer>
      )}

      {editing && (
        <EditDrawer workflow={editing} onClose={() => setEditing(null)} />
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete workflow "${confirmDelete.name}"?`}
          body="This cannot be undone. Requests already pinned to this workflow at submit time keep using it; new requests will fall back to the default."
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

function WorkflowRow({
  workflow: w,
  onEdit,
  onDelete,
}: {
  workflow: Workflow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sys = !!w.is_system;
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top">
      <Td>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-accent text-sm">{w.name}</span>
          {w.is_default && (
            <StatusPill variant="accent" tone="outline">
              default
            </StatusPill>
          )}
          {sys && (
            <StatusPill variant="system" tone="outline">
              system
            </StatusPill>
          )}
          {/* R-follow-up #1 (api#118) — visibility chip for the
              scoped policy author surface. Operators see at a glance
              which workflows are exposed to /projects/:id/policies
              without opening every drawer. */}
          {w.scoped_policy_authorable && (
            <StatusPill variant="accent" tone="outline">
              scoped
            </StatusPill>
          )}
        </div>
        {w.description && (
          <div className="text-muted text-xs mt-1">{w.description}</div>
        )}
      </Td>
      <Td>
        <span className="text-text">
          min <span className="font-mono text-accent">{w.min_approvers}</span>
        </span>
      </Td>
      <Td className="text-muted">
        {w.require_justification ? 'required' : 'optional'}
      </Td>
      <Td className="text-muted">
        {w.allow_self_approval ? 'allowed' : 'blocked'}
      </Td>
      <Td>
        {w.enabled ? (
          <StatusPill variant="success" tone="outline">
            enabled
          </StatusPill>
        ) : (
          <StatusPill variant="error" tone="outline">
            disabled
          </StatusPill>
        )}
      </Td>
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

// --- edit drawer ----------------------------------------------------

function EditDrawer({
  workflow,
  onClose,
}: {
  workflow: Workflow;
  onClose: () => void;
}) {
  const update = useUpdateWorkflow(workflow.id);
  return (
    <Drawer title={`Edit ${workflow.name}`} onClose={onClose}>
      <WorkflowForm
        initial={workflow}
        onSubmit={async (body) => {
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
