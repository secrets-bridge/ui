/**
 * Workflows (`/admin/workflows`): the approval templates a policy
 * points requests at. Each row shows how many approvals it needs (and
 * from which role, when one is set), how long values stay available,
 * when undecided requests expire, its rules and whether it is enabled.
 * The name opens it in a drawer.
 *
 * Built-in workflows (the seeded `standard`) can be edited but not
 * deleted: the api answers 409 on DELETE, so the page offers no Delete.
 * Every create, update and delete invalidates the list query.
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { policiesKey, usePolicies } from '../../api/policies';
import { useRoles } from '../../api/roles';
import type { Workflow, WorkflowInput } from '../../api/types';
import { useCreateWorkflow, useDeleteWorkflow, useUpdateWorkflow, useWorkflows } from '../../api/workflows';
import { useAuth } from '../../auth/AuthContext';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Dialog } from '../../ui/Dialog';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';
import { errorText, formatDuration } from './roles/format';
import { WorkflowForm } from './WorkflowForm';

export function Workflows() {
  const list = useWorkflows();
  const roles = useRoles();
  const create = useCreateWorkflow();
  const toast = useToast();

  const [editing, setEditing] = useState<Workflow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Workflow | null>(null);

  const rows = [...(list.data ?? [])].sort(
    (a, b) => Number(!!b.is_default) - Number(!!a.is_default) || a.name.localeCompare(b.name),
  );
  const fallback = rows.find((w) => w.is_default);
  const roleName = (id?: string | null) => (id ? roles.data?.find((r) => r.id === id)?.name : undefined);
  const open = (w: Workflow) => {
    setCreating(false);
    setEditing(w);
  };

  const nameCell = (w: Workflow) => (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <button type="button" onClick={() => open(w)} className="text-left font-mono text-mono font-medium text-accent hover:underline">
          {w.name}
        </button>
        <Tags w={w} />
      </span>
      {w.description && <span className="text-caption text-muted">{w.description}</span>}
    </span>
  );
  const approvals = (w: Workflow) => {
    const role = roleName(w.approver_role_id);
    const n = w.min_approvers;
    return (
      <span>
        {n === 0 ? 'None' : `${n} ${n === 1 ? 'approval' : 'approvals'}`}
        {role && <span className="block text-caption text-muted">from {role}</span>}
      </span>
    );
  };
  const rules = (w: Workflow) =>
    w.require_justification ? 'Reason required' : 'Reason optional';
  const deleteButton = (w: Workflow) =>
    w.is_system ? null : (
      <Button
        variant="danger"
        size="sm"
        onClick={() => setConfirmDelete(w)}
        aria-label={`Delete ${w.name}`}
      >
        Delete…
      </Button>
    );

  const columns: Column<Workflow>[] = [
    { key: 'name', header: 'Workflow', render: nameCell, className: 'max-w-[320px]' },
    { key: 'approvals', header: 'Approvals', render: approvals, className: 'whitespace-nowrap' },
    { key: 'values', header: 'Values available', render: (w) => formatDuration(w.wrap_ttl_approved_seconds), className: 'whitespace-nowrap' },
    { key: 'expiry', header: 'Requests expire', render: (w) => formatDuration(w.request_ttl_seconds), className: 'whitespace-nowrap' },
    { key: 'rules', header: 'Rules', render: (w) => <span className="text-muted">{rules(w)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (w) => (w.enabled ? <ToneStatus tone="ok">Enabled</ToneStatus> : <ToneStatus tone="neutral">Disabled</ToneStatus>),
    },
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', render: deleteButton },
  ];

  return (
    <div>
      <PageHeader
        title="Workflows"
        description={
          list.data
            ? `${rows.length} ${rows.length === 1 ? 'workflow' : 'workflows'}${fallback ? `; ${fallback.name} is the default` : ''}. Policies decide which workflow a request follows.`
            : 'Policies decide which workflow a request follows.'
        }
        actions={
          <Button
            variant="primary"
            onClick={() => {
              create.reset();
              setEditing(null);
              setCreating(true);
            }}
          >
            Create workflow
          </Button>
        }
      />

      {list.isLoading && <p className="text-muted">Loading workflows…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the workflows."
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
          <EmptyState title="No workflows yet.">The api creates a built-in workflow named standard when it first starts.</EmptyState>
        ) : (
          <>
            <DataTable
              label="Workflows"
              columns={columns}
              rows={rows}
              rowKey={(w) => w.id}
              onRowClick={open}
              minWidth={900}
              stacked={(w) => (
                <div className="flex flex-col gap-1">
                  <div className="flex items-start justify-between gap-3">
                    {nameCell(w)}
                    {w.enabled ? <ToneStatus tone="ok">Enabled</ToneStatus> : <ToneStatus tone="neutral">Disabled</ToneStatus>}
                  </div>
                  <p className="text-caption">
                    {w.min_approvers === 0 ? 'No approvals' : `${w.min_approvers} ${w.min_approvers === 1 ? 'approval' : 'approvals'}`}
                    {roleName(w.approver_role_id) ? ` from ${roleName(w.approver_role_id)}` : ''} · values {formatDuration(w.wrap_ttl_approved_seconds)} ·
                    requests expire after {formatDuration(w.request_ttl_seconds)}
                  </p>
                  <p className="text-caption text-muted">{rules(w)}</p>
                  {!w.is_system && <div className="mt-1">{deleteButton(w)}</div>}
                </div>
              )}
            />
            <p className="mt-2 text-caption text-muted">Built-in workflows can be edited but not deleted.</p>
          </>
        ))}

      {creating && (
        <WorkflowForm
          onSubmit={async (body: WorkflowInput) => {
            await create.mutateAsync(body);
            setCreating(false);
            toast(`Created workflow ${body.name}.`);
          }}
          onCancel={() => setCreating(false)}
          submitting={create.isPending}
          submitError={create.error}
        />
      )}

      {editing && <EditWorkflow workflow={editing} onClose={() => setEditing(null)} />}

      {confirmDelete && (
        <DeleteWorkflow
          workflow={confirmDelete}
          onClose={() => setConfirmDelete(null)}
          onDeleted={() => {
            toast(`Deleted workflow ${confirmDelete.name}.`);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

// Deleting a workflow also deletes every policy that points to it, and
// the api refuses it while any request references the workflow. The
// dialog says both and counts the policies first. Deleting the policies
// is a policy change, so the api also needs policy.edit for it
// (delete_policy_rules=true). Without policy.edit the dialog sends a
// plain delete, and when policies point to the workflow it says who can
// delete or repoint them instead of offering a delete the api refuses.
function DeleteWorkflow({ workflow, onClose, onDeleted }: { workflow: Workflow; onClose: () => void; onDeleted: () => void }) {
  const del = useDeleteWorkflow();
  const policies = usePolicies();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canDeletePolicies = hasPermission('policy.edit');
  const n = (policies.data ?? []).filter((p) => p.workflow_id === workflow.id).length;
  const counted = !policies.isLoading && !policies.isError;
  const pointLine = `${n} ${n === 1 ? 'policy points' : 'policies point'} to it`;

  if (counted && n > 0 && !canDeletePolicies) {
    return (
      <Dialog
        title={`Workflow ${workflow.name} is in use`}
        onClose={onClose}
        actions={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <p className="text-muted">
          {`${pointLine}. Deleting a workflow together with its policies needs policy access, so ask a policy admin to delete those policies or point them to another workflow first.`}
        </p>
      </Dialog>
    );
  }

  const policyLine = policies.isLoading
    ? 'Checking which policies use it…'
    : policies.isError
      ? canDeletePolicies
        ? "Couldn't check which policies use it. Any policy that points to it is deleted too."
        : "Couldn't check which policies use it. If any do, the delete is refused."
      : n === 0
        ? 'No policy points to it.'
        : `${pointLine} and will be deleted too.`;
  return (
    <ConfirmModal
      title={`Delete workflow ${workflow.name}?`}
      body={`${policyLine} A workflow that any request has used can't be deleted; disable it instead. This can't be undone.`}
      confirmText="Delete workflow"
      danger
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await del.mutateAsync({ id: workflow.id, deletePolicyRules: canDeletePolicies });
          void qc.invalidateQueries({ queryKey: policiesKey.all });
          onDeleted();
        } catch {
          // Shown in the dialog.
        }
      }}
      loading={del.isPending}
      error={del.error}
    />
  );
}

function Tags({ w }: { w: Workflow }) {
  const tags = [w.is_default && 'Default', w.is_system && 'Built in', w.scoped_policy_authorable && 'For project policies'].filter(Boolean) as string[];
  if (tags.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="inline-flex h-[18px] items-center rounded-sm border border-border px-[5px] text-[11px] font-medium text-muted">
          {t}
        </span>
      ))}
    </span>
  );
}

function EditWorkflow({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const update = useUpdateWorkflow(workflow.id);
  const toast = useToast();
  return (
    <WorkflowForm
      initial={workflow}
      onSubmit={async (body) => {
        await update.mutateAsync(body);
        onClose();
        toast(`Saved workflow ${body.name}.`);
      }}
      onCancel={onClose}
      submitting={update.isPending}
      submitError={update.error}
    />
  );
}
