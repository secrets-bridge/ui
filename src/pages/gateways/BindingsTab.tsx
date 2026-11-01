/**
 * The bindings a caller can see (GET /gateway-bindings). A team sees its
 * own projects' bindings, suspended ones included, even once the target
 * is hidden from it, so it can find out why observation stopped.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import { type GatewayBindingItem, useConfirmTargetIdentity, useDeleteBinding, useTeamBindings } from '../../api/gateways';
import type { Project } from '../../api/types';
import { useEnvironments, useProjectSecrets } from '../../api/tenancy';
import { useAuth } from '../../auth/AuthContext';
import { SUSPENDED_HIDDEN_TARGET, SUSPENDED_LABEL, SUSPENDED_NEXT_STEP, words } from '../../lib/gatewayStatus';
import { formatExact } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { EnvTag } from '../../ui/EnvTag';
import { Field, Select } from '../../ui/Field';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';
import { TargetIdentity } from './TargetIdentity';

function nextStep(b: GatewayBindingItem, global: boolean): string {
  if (!b.suspended_reason) return '';
  if (!global && !b.app_project && b.suspended_reason !== 'scope_changed') return SUSPENDED_HIDDEN_TARGET;
  return SUSPENDED_NEXT_STEP[b.suspended_reason] ?? '';
}

/** A catalog secret by its path, the way the project's other pages name it. */
function SecretCell({ binding }: { binding: GatewayBindingItem }) {
  const secrets = useProjectSecrets(binding.secret_id ? binding.project_id : undefined);
  const known = (secrets.data ?? []).find((s) => s.secret_id === binding.secret_id)?.secret?.secret_ref;
  return <span className="font-mono text-mono-small break-all">{binding.secret_ref ?? known ?? 'Catalog secret'}</span>;
}

interface Props {
  projects: Project[];
  projectId: string;
  onProject: (id: string) => void;
}

export function BindingsTab({ projects, projectId, onProject }: Props) {
  const { hasPermission, hasGlobalPermission } = useAuth();
  const globalBind = hasGlobalPermission('gateway.bind');
  const [suspended, setSuspended] = useState(false);
  const list = useTeamBindings({ project_id: projectId || undefined, suspended: suspended || undefined });
  const envs = useEnvironments();
  const del = useDeleteBinding();
  const confirmIdentity = useConfirmTargetIdentity();
  const toast = useToast();
  const [deleting, setDeleting] = useState<GatewayBindingItem | null>(null);
  const [confirming, setConfirming] = useState<GatewayBindingItem | null>(null);

  const items = (list.data?.pages ?? []).flatMap((p) => p.items ?? []);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const envById = new Map((envs.data ?? []).map((e) => [e.id, e]));

  // The api keeps a team-scoped delete to targets the team can still see.
  const canDelete = (b: GatewayBindingItem) => globalBind || (hasPermission('gateway.bind') && !!b.app_project);

  const envCell = (b: GatewayBindingItem) => {
    const e = envById.get(b.environment_id);
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {projectName.get(b.project_id) ?? 'Project'} <EnvTag kind={e?.kind}>{e?.name ?? 'environment'}</EnvTag>
      </span>
    );
  };

  const stateCell = (b: GatewayBindingItem) =>
    b.suspended_reason ? (
      <span className="flex flex-col gap-0.5">
        <ToneStatus tone="warn">{words(b.suspended_reason, SUSPENDED_LABEL)}</ToneStatus>
        <span className="text-caption text-muted">{nextStep(b, globalBind)}</span>
      </span>
    ) : (
      <span className="flex flex-col gap-0.5">
        <ToneStatus tone="ok">Active</ToneStatus>
        <span className="text-caption text-muted">Created {formatExact(b.created_at)}</span>
      </span>
    );

  const actions = (b: GatewayBindingItem) => (
    <>
      {globalBind && b.suspended_reason === 'identity_changed' && b.argocd_connector_id && (
        <Button variant="secondary" size="sm" onClick={() => setConfirming(b)}>
          Re-confirm…
        </Button>
      )}
      {canDelete(b) && (
        <Button variant="danger" size="sm" onClick={() => setDeleting(b)}>
          Delete…
        </Button>
      )}
    </>
  );

  const columns: Column<GatewayBindingItem>[] = [
    {
      key: 'target',
      header: 'Target',
      render: (b) => <TargetIdentity targetId={b.argocd_target_id ?? ''} name={b.name} appProject={b.app_project} namespace={b.namespace} />,
    },
    {
      key: 'env',
      header: 'Environment',
      render: (b) => envCell(b),
    },
    {
      key: 'secret',
      header: 'Secret',
      render: (b) => <SecretCell binding={b} />,
    },
    {
      key: 'state',
      header: 'State',
      render: (b) => stateCell(b),
    },
    {
      key: 'actions',
      header: 'Actions',
      hiddenHeader: true,
      align: 'right',
      render: (b) => <span className="flex flex-wrap justify-end gap-2">{actions(b)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="bt-project" label="Project">
          {(p) => (
            <Select {...p} value={projectId} onChange={(e) => onProject(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="bt-state" label="State">
          {(p) => (
            <Select {...p} value={suspended ? 'suspended' : ''} onChange={(e) => setSuspended(e.target.value === 'suspended')}>
              <option value="">Any</option>
              <option value="suspended">Suspended</option>
            </Select>
          )}
        </Field>
      </div>

      {list.isError && (
        <Banner tone="error" title="Couldn't load the bindings.">
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : 'Network error.'}
        </Banner>
      )}
      {list.isLoading && <p className="text-muted">Loading bindings…</p>}
      {list.isSuccess && items.length === 0 && (
        <EmptyState title={suspended ? 'Nothing is suspended.' : 'No bindings yet.'}>
          {suspended ? 'Every binding you can see is active.' : 'Choose a project on the Targets tab, then bind a target to one of its environments.'}
        </EmptyState>
      )}
      {items.length > 0 && (
        <DataTable
          label="Bindings"
          columns={columns}
          rows={items}
          rowKey={(b) => b.id}
          minWidth={960}
          alignTop
          stacked={(b) => (
            <div className="flex flex-col gap-2">
              <TargetIdentity targetId={b.argocd_target_id ?? ''} name={b.name} appProject={b.app_project} namespace={b.namespace} />
              {envCell(b)}
              <SecretCell binding={b} />
              {stateCell(b)}
              <div className="flex flex-wrap gap-2">{actions(b)}</div>
            </div>
          )}
        />
      )}
      {list.hasNextPage && (
        <div>
          <Button variant="secondary" onClick={() => void list.fetchNextPage()} disabled={list.isFetchingNextPage} aria-busy={list.isFetchingNextPage}>
            {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title="Delete this binding?"
          body="Changes in this scope are no longer observed by this Gateway. Its open observation tasks are cancelled."
          confirmText="Delete binding"
          danger
          loading={del.isPending}
          error={del.error}
          onCancel={() => {
            del.reset();
            setDeleting(null);
          }}
          onConfirm={async () => {
            try {
              await del.mutateAsync({ id: deleting.id });
              toast('Deleted the binding.');
              setDeleting(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
      {confirming && (
        <ConfirmModal
          title="Re-confirm this target?"
          body="Do this only if you know why the Application changed. Its bindings resume and observe the new Application."
          confirmText="Re-confirm target"
          loading={confirmIdentity.isPending}
          error={confirmIdentity.error}
          onCancel={() => {
            confirmIdentity.reset();
            setConfirming(null);
          }}
          onConfirm={async () => {
            try {
              await confirmIdentity.mutateAsync({
                gatewayId: confirming.gateway_id,
                connectorId: confirming.argocd_connector_id!,
                targetId: confirming.argocd_target_id!,
              });
              toast('Re-confirmed the target.');
              setConfirming(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </div>
  );
}
