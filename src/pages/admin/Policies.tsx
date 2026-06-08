/**
 * Policies admin page. Same shape as Workflows / Roles — PageHeader +
 * Card-wrapped table + shared `src/ui/` primitives.
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
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';
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
    <div>
      <PageHeader
        title="Policies"
        description="Selector → workflow mapping. Higher priority wins on overlap. Empty selector keys are wildcards; the seed match-all rule (priority 0) is the fallback."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            + New policy
          </Button>
        }
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load policies</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No policies defined yet. The api seeds one named{' '}
          <code className="font-mono">match-all</code> at priority 0.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <>
          <Card className="overflow-hidden">
            <table className="w-full text-sm">
              <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
                <tr className="border-b border-border/60">
                  <Th>Name</Th>
                  <Th>Anchor</Th>
                  <Th>Selector</Th>
                  <Th>Workflow</Th>
                  <Th>Priority</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {list.data.map((p) => (
                  <PolicyRow
                    key={p.id}
                    policy={p}
                    workflowName={workflowName(p.workflow_id)}
                    onEdit={() => {
                      setCreating(false);
                      setEditing(p);
                    }}
                    onDelete={() => setConfirmDelete(p)}
                  />
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-muted text-xs mt-3">
            System seed policies can't be deleted — delete is disabled
            (muted) with a tooltip <em>"System seed — not deletable"</em>.
          </p>
        </>
      )}

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

      {editing && <EditDrawer policy={editing} onClose={() => setEditing(null)} />}

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

// --- row + cell bits ------------------------------------------------

function PolicyRow({
  policy: p,
  workflowName,
  onEdit,
  onDelete,
}: {
  policy: Policy;
  workflowName: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const sys = !!p.is_system;
  const selectorKeys = Object.entries(p.selector ?? {});
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top">
      <Td>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-accent text-sm">{p.name}</span>
          {sys && (
            <StatusPill variant="system" tone="outline">
              system
            </StatusPill>
          )}
        </div>
      </Td>
      <Td>
        <span className="text-[11px] uppercase tracking-wide text-muted">
          {p.team_id ? 'team' : p.project_id ? 'project' : 'platform'}
        </span>
      </Td>
      <Td>
        {selectorKeys.length === 0 ? (
          <span className="text-muted text-xs italic">match-all</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {selectorKeys.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border px-2.5 py-0.5 text-[11px] font-mono"
              >
                <span className="text-muted">{k}</span>
                <span className="text-muted/50">=</span>
                <span className="text-accent">{v}</span>
              </span>
            ))}
          </div>
        )}
      </Td>
      <Td>
        <span className="font-mono text-text text-sm">{workflowName}</span>
      </Td>
      <Td>
        <span className="font-mono text-accent text-sm">{p.priority}</span>
      </Td>
      <Td>
        {p.enabled ? (
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
  policy,
  onClose,
}: {
  policy: Policy;
  onClose: () => void;
}) {
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

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
