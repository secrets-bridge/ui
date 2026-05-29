/**
 * Workflows admin page. Lists workflow definitions in a table; provides
 * create + edit (drawer) + delete (with confirm) actions.
 *
 * System workflows (the seed `standard` row) are editable but the
 * Delete action is disabled — the api returns 409 on DELETE for them.
 *
 * Mutation invariants:
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
import { WorkflowForm } from './WorkflowForm';

export function Workflows() {
  const list = useWorkflows();
  const create = useCreateWorkflow();
  const del = useDeleteWorkflow();

  const [editing, setEditing] = useState<Workflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text text-xl font-semibold">Workflows</h1>
          <p className="text-muted text-sm mt-1">
            Approval templates resolved at request submit time. System seeds are editable but cannot be deleted.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90"
        >
          + New workflow
        </button>
      </div>

      {list.isError && (
        <div className="bg-surface border border-red-500/40 rounded p-4 text-sm">
          <div className="text-red-400 font-medium">Failed to load workflows</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </div>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
          No workflows defined yet. The api seeds one named <code>standard</code> on first boot.
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Name</th>
                <th className="px-4 py-3 font-normal">Min approvers</th>
                <th className="px-4 py-3 font-normal">Justification</th>
                <th className="px-4 py-3 font-normal">Self-approval</th>
                <th className="px-4 py-3 font-normal">Flags</th>
                <th className="px-4 py-3 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((w) => (
                <tr key={w.id} className="border-b border-border/50 last:border-0 hover:bg-bg/30">
                  <td className="px-4 py-3">
                    <div className="text-text">{w.name}</div>
                    {w.description && <div className="text-muted text-xs">{w.description}</div>}
                  </td>
                  <td className="px-4 py-3 text-text">{w.min_approvers}</td>
                  <td className="px-4 py-3 text-muted">{w.require_justification ? 'required' : 'optional'}</td>
                  <td className="px-4 py-3 text-muted">{w.allow_self_approval ? 'allowed' : 'blocked'}</td>
                  <td className="px-4 py-3 space-x-1">
                    {w.is_default && (
                      <span className="text-xs bg-accent/20 text-accent border border-accent/40 rounded px-2 py-0.5">
                        default
                      </span>
                    )}
                    {w.is_system && (
                      <span className="text-xs bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 rounded px-2 py-0.5">
                        system
                      </span>
                    )}
                    {!w.enabled && (
                      <span className="text-xs bg-red-400/20 text-red-300 border border-red-400/40 rounded px-2 py-0.5">
                        disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => {
                        setCreating(false);
                        setEditing(w);
                      }}
                      className="text-xs text-muted hover:text-text border border-border px-2 py-1 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(w)}
                      disabled={!!w.is_system}
                      title={w.is_system ? 'System seed — not deletable' : undefined}
                      className="text-xs text-red-400 hover:text-red-300 border border-border px-2 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer: create */}
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

      {/* Drawer: edit */}
      {editing && <EditDrawer workflow={editing} onClose={() => setEditing(null)} />}

      {/* Confirm: delete */}
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

function EditDrawer({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
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

function Drawer({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close drawer" />
      <div className="relative w-[480px] max-w-full bg-surface border-l border-border h-full overflow-auto">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <div className="text-text font-semibold">{title}</div>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ×
          </button>
        </div>
        <div className="px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title,
  body,
  confirmText,
  danger,
  onCancel,
  onConfirm,
  loading,
  error,
}: {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<unknown>;
  loading: boolean;
  error?: unknown;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button className="absolute inset-0 bg-black/60" onClick={onCancel} aria-label="Close" />
      <div className="relative bg-surface border border-border rounded-lg w-[420px] p-5 space-y-3">
        <div className="text-text font-semibold">{title}</div>
        <div className="text-muted text-sm">{body}</div>
        {error instanceof ApiError && (
          <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
            {error.status}: {error.message}
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            onClick={() => void onConfirm()}
            disabled={loading}
            className={`${
              danger ? 'bg-red-500 text-white' : 'bg-accent text-bg'
            } font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50`}
          >
            {loading ? 'Working…' : confirmText}
          </button>
          <button
            onClick={onCancel}
            className="text-muted hover:text-text px-3 py-2 rounded border border-border"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
