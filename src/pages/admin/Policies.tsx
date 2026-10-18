/**
 * Policies (`/admin/policies`, policy.edit): the rules that pick which
 * workflow a request goes through. The highest-priority enabled rule
 * whose selector matches wins; empty selector keys match anything, and
 * the system default rule (priority 0) catches the rest.
 *
 * - The name opens the rule's page (overview and audit history, which
 *   stays readable after a delete). Edit opens the form in a drawer.
 * - The system default can be edited but not deleted (the api returns
 *   409); its Delete is disabled with the reason.
 * - Workflow names come from `useWorkflows()` (same key as the
 *   Workflows page).
 */

import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { useCreatePolicy, useDeletePolicy, usePolicies, useUpdatePolicy } from '../../api/policies';
import type { Policy, PolicyInput } from '../../api/types';
import { useTeams } from '../../api/teams';
import { useProjects } from '../../api/tenancy';
import { useWorkflows } from '../../api/workflows';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { useToast } from '../../ui/toastContext';
import { ANCHOR_LABEL, anchorOf, type SelectorNames } from '../policies/labels';
import { RuleStatus, Selector } from '../policies/parts';
import { PolicyForm } from './PolicyForm';

export function Policies() {
  const list = usePolicies();
  const workflows = useWorkflows();
  const projects = useProjects();
  const teams = useTeams();
  const del = useDeletePolicy();
  const toast = useToast();
  const navigate = useNavigate();

  const [editing, setEditing] = useState<Policy | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Policy | null>(null);

  const workflowName = (id: string) => workflows.data?.find((w) => w.id === id)?.name;
  const names: SelectorNames = {
    project: (id) => projects.data?.find((p) => p.id === id)?.name,
    team: (id) => teams.data?.find((t) => t.id === id)?.name,
  };
  const anchorText = (p: Policy) => {
    const a = anchorOf(p);
    if (a === 'project') return `${ANCHOR_LABEL.project} · ${names.project?.(p.project_id!) ?? 'unknown project'}`;
    if (a === 'team') return `${ANCHOR_LABEL.team} · ${names.team?.(p.team_id!) ?? 'unknown team'}`;
    return ANCHOR_LABEL.platform;
  };
  const rows = [...(list.data ?? [])].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const detail = (p: Policy) => `/admin/policies/${p.id}`;

  const actions = (p: Policy) => (
    <span className="inline-flex gap-2">
      <Button variant="secondary" size="sm" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
        Edit
      </Button>
      <Button
        variant="danger"
        size="sm"
        onClick={() => setConfirmDelete(p)}
        disabled={!!p.is_system}
        title={p.is_system ? "The system default rule can't be deleted." : undefined}
        aria-label={`Delete ${p.name}`}
      >
        Delete…
      </Button>
    </span>
  );

  const columns: Column<Policy>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (p) => (
        <span>
          <Link to={detail(p)} className="font-medium text-accent hover:underline">
            {p.name}
          </Link>
          {p.is_system && <span className="ml-2 text-caption text-muted">System default</span>}
        </span>
      ),
    },
    { key: 'anchor', header: 'Applies to', render: (p) => anchorText(p) },
    { key: 'selector', header: 'Matches', render: (p) => <Selector selector={p.selector ?? {}} names={names} />, className: 'max-w-[360px]' },
    { key: 'workflow', header: 'Workflow', render: (p) => workflowName(p.workflow_id) ?? <span className="font-mono text-mono text-muted">{p.workflow_id.slice(0, 8)}</span> },
    { key: 'priority', header: 'Priority', align: 'right', render: (p) => <span className="font-mono text-mono">{p.priority}</span> },
    { key: 'status', header: 'Status', render: (p) => <RuleStatus enabled={p.enabled} /> },
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', className: 'whitespace-nowrap', render: actions },
  ];

  const enabled = rows.filter((p) => p.enabled).length;

  return (
    <div>
      <PageHeader
        title="Policies"
        description={
          list.data
            ? `${rows.length} ${rows.length === 1 ? 'rule' : 'rules'}, ${enabled} enabled. The highest-priority enabled rule that matches a request picks its workflow; empty fields match anything.`
            : 'Rules that pick which workflow a request goes through.'
        }
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            Create policy
          </Button>
        }
      />

      {list.isLoading && <p className="text-muted">Loading policies…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the policies."
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
          <EmptyState title="No policies yet.">The api seeds a system default rule at priority 0; it may not have run yet.</EmptyState>
        ) : (
          <DataTable
            label="Policies"
            columns={columns}
            rows={rows}
            rowKey={(p) => p.id}
            onRowClick={(p) => navigate(detail(p))}
            minWidth={900}
            stacked={(p) => (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center justify-between gap-3">
                  <Link to={detail(p)} className="font-medium text-accent hover:underline">
                    {p.name}
                  </Link>
                  <RuleStatus enabled={p.enabled} />
                </p>
                <p className="text-caption text-muted">
                  {anchorText(p)} · priority <span className="font-mono">{p.priority}</span> · {workflowName(p.workflow_id) ?? 'unknown workflow'}
                </p>
                <Selector selector={p.selector ?? {}} names={names} />
                <div className="mt-1">{actions(p)}</div>
              </div>
            )}
          />
        ))}

      {creating && <PolicyDrawer onClose={() => setCreating(false)} />}
      {editing && <PolicyDrawer policy={editing} onClose={() => setEditing(null)} />}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body="Requests submitted after this fall to the next rule that matches, often the system default. The rule's history stays readable."
          confirmText="Delete policy"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            try {
              await del.mutateAsync(confirmDelete.id);
              toast(`Deleted ${confirmDelete.name}.`);
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

/** Create (no `policy`) or edit a rule. */
function PolicyDrawer({ policy, onClose }: { policy?: Policy; onClose: () => void }) {
  return policy ? <EditPolicyDrawer policy={policy} onClose={onClose} /> : <CreatePolicyDrawer onClose={onClose} />;
}

function CreatePolicyDrawer({ onClose }: { onClose: () => void }) {
  const create = useCreatePolicy();
  const toast = useToast();
  return (
    <FormDrawer
      title="Create policy"
      pending={create.isPending}
      error={create.error}
      submitLabel="Create policy"
      onClose={onClose}
      form={
        <PolicyForm
          formId="policy-form"
          onSubmit={async (body: PolicyInput) => {
            await create.mutateAsync(body);
            toast(`Created ${body.name}.`);
            onClose();
          }}
        />
      }
    />
  );
}

function EditPolicyDrawer({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const update = useUpdatePolicy(policy.id);
  const toast = useToast();
  return (
    <FormDrawer
      title={`Edit ${policy.name}`}
      pending={update.isPending}
      error={update.error}
      submitLabel="Save changes"
      onClose={onClose}
      form={
        <PolicyForm
          formId="policy-form"
          initial={policy}
          onSubmit={async (body) => {
            await update.mutateAsync(body);
            toast(`Saved ${body.name}.`);
            onClose();
          }}
        />
      }
    />
  );
}

function FormDrawer({
  title,
  pending,
  error,
  submitLabel,
  onClose,
  form,
}: {
  title: string;
  pending: boolean;
  error: unknown;
  submitLabel: string;
  onClose: () => void;
  form: ReactNode;
}) {
  return (
    <Drawer
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="policy-form" variant="primary" disabled={pending} aria-busy={pending}>
            {pending ? 'Saving…' : submitLabel}
          </Button>
        </>
      }
    >
      {form}
      {error != null && (
        <Banner tone="error" title="Not saved." className="mt-[18px]">
          {errorText(error)}
        </Banner>
      )}
    </Drawer>
  );
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
