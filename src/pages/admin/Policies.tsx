/**
 * Policies admin page. Lists policy rules in a table; provides create
 * + edit (drawer) + delete (with confirm) actions.
 *
 * System policies (the seed `match-all` row at priority 0) are
 * editable but the Delete action is disabled — the api returns 409 on
 * DELETE for them.
 *
 * Workflow lookup: the table shows workflow NAMES, not UUIDs. We hydrate
 * the name from `useWorkflows()` (same query key as the Workflows admin
 * page, so navigating between them is cache-free).
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import type { Policy, PolicyInput } from '../../api/types';
import {
  useCreatePolicy,
  useDeletePolicy,
  usePolicies,
  useUpdatePolicy,
} from '../../api/policies';
import { useWorkflows } from '../../api/workflows';
import { PolicyForm } from './PolicyForm';

export function Policies() {
  const list = usePolicies();
  const workflows = useWorkflows();
  const create = useCreatePolicy();
  const del = useDeletePolicy();

  const [editing, setEditing] = useState<Policy | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Policy | null>(null);

  const workflowName = (id: string) =>
    workflows.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8) + '…';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-text text-xl font-semibold">Policies</h1>
          <p className="text-muted text-sm mt-1">
            Selector → workflow mapping. Higher priority wins on overlap. Empty selector keys are wildcards; the seed <code>match-all</code> rule (priority 0) is the fallback.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setCreating(true);
          }}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90"
        >
          + New policy
        </button>
      </div>

      {list.isError && (
        <div className="bg-surface border border-red-500/40 rounded p-4 text-sm">
          <div className="text-red-400 font-medium">Failed to load policies</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </div>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
          No policies defined yet. The api seeds one named <code>match-all</code> at priority 0.
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Name</th>
                <th className="px-4 py-3 font-normal">Selector</th>
                <th className="px-4 py-3 font-normal">Workflow</th>
                <th className="px-4 py-3 font-normal">Priority</th>
                <th className="px-4 py-3 font-normal">Flags</th>
                <th className="px-4 py-3 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id} className="border-b border-border/50 last:border-0 hover:bg-bg/30 align-top">
                  <td className="px-4 py-3 text-text">{p.name}</td>
                  <td className="px-4 py-3">
                    {Object.keys(p.selector ?? {}).length === 0 ? (
                      <span className="text-muted text-xs italic">match-all</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(p.selector).map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[11px] bg-bg border border-border text-muted rounded px-2 py-0.5"
                          >
                            <span className="text-text">{k}</span>
                            <span className="opacity-50 mx-1">=</span>
                            <span>{v}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text">{workflowName(p.workflow_id)}</td>
                  <td className="px-4 py-3 text-text">{p.priority}</td>
                  <td className="px-4 py-3 space-x-1">
                    {p.is_system && (
                      <span className="text-xs bg-yellow-400/20 text-yellow-300 border border-yellow-400/40 rounded px-2 py-0.5">
                        system
                      </span>
                    )}
                    {!p.enabled && (
                      <span className="text-xs bg-red-400/20 text-red-300 border border-red-400/40 rounded px-2 py-0.5">
                        disabled
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <button
                      onClick={() => {
                        setCreating(false);
                        setEditing(p);
                      }}
                      className="text-xs text-muted hover:text-text border border-border px-2 py-1 rounded"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setConfirmDelete(p)}
                      disabled={!!p.is_system}
                      title={p.is_system ? 'System seed — not deletable' : undefined}
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
        <Drawer title="New policy" onClose={() => setCreating(false)}>
          <PolicyForm
            onSubmit={async (body: PolicyInput) => {
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
      {editing && <EditDrawer policy={editing} onClose={() => setEditing(null)} />}

      {/* Confirm: delete */}
      {confirmDelete && (
        <ConfirmModal
          title={`Delete policy "${confirmDelete.name}"?`}
          body="Requests submitted after this deletion fall back to whichever lower-priority rule still matches — typically the seed match-all policy."
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

function EditDrawer({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const update = useUpdatePolicy(policy.id);
  return (
    <Drawer title={`Edit ${policy.name}`} onClose={onClose}>
      <PolicyForm
        initial={policy}
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
