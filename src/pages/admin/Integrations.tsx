/**
 * Integrations (`/admin/integrations`, BRD §26: read-only GitOps
 * visibility).
 *
 * Two sections, semantics unchanged:
 *   1. ArgoCD endpoints: connection details and a write-once token, an
 *      enabled switch, delete, and "Find apps" (bulk mappings from
 *      discovery). No edit: create, toggle and delete only, by api
 *      design.
 *   2. GitOps app mappings: tie an ArgoCD application to the workload
 *      that consumes a secret. Create and delete only.
 *
 * The feature is opt-in server-side (`SB_GITOPS_ENABLED`). When it is
 * off the api doesn't mount the routes and answers 404; the page then
 * explains how to turn it on instead of showing empty tables.
 */

import { useId, useState, type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import {
  useArgoCDEndpoints,
  useCreateArgoCDEndpoint,
  useCreateGitOpsAppMapping,
  useDeleteArgoCDEndpoint,
  useDeleteGitOpsAppMapping,
  useGitOpsAppMappings,
  useSetArgoCDEndpointEnabled,
} from '../../api/integrations';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import type { ArgoCDEndpoint, ArgoCDEndpointInput, GitOpsAppMapping, GitOpsAppMappingInput } from '../../api/types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';
import { ArgoCDEndpointForm } from './ArgoCDEndpointForm';
import { DiscoverAppsPanel } from './DiscoverAppsPanel';
import { GitOpsAppMappingForm } from './GitOpsAppMappingForm';

const DESCRIPTION = 'ArgoCD sync status on the request page, read-only.';

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export function Integrations() {
  const endpoints = useArgoCDEndpoints();
  const mappings = useGitOpsAppMappings();

  if (isNotFound(endpoints.error) || isNotFound(mappings.error)) return <FeatureOff />;

  const facts =
    endpoints.data && mappings.data
      ? `${endpoints.data.length} ArgoCD ${endpoints.data.length === 1 ? 'endpoint' : 'endpoints'} · ${mappings.data.length} app ${mappings.data.length === 1 ? 'mapping' : 'mappings'}. `
      : '';

  return (
    <div>
      <PageHeader title="Integrations" description={`${facts}${DESCRIPTION}`} />
      <div className="flex flex-col gap-10">
        <EndpointsSection />
        <MappingsSection />
      </div>
    </div>
  );
}

function SectionHeader({ id, title, count, description, action }: { id: string; title: string; count?: number; description: string; action: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} className="text-block-heading text-ink">
          {title}
          {count !== undefined && <span className="ml-2 font-mono text-mono-small font-normal text-muted">{count}</span>}
        </h2>
        <p className="mt-0.5 max-w-2xl text-caption text-muted">{description}</p>
      </div>
      {action}
    </div>
  );
}

// --- endpoints ------------------------------------------------------

function EndpointsSection() {
  const list = useArgoCDEndpoints();
  const create = useCreateArgoCDEndpoint();
  const del = useDeleteArgoCDEndpoint();
  const toast = useToast();
  const formId = useId();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ArgoCDEndpoint | null>(null);
  const [finding, setFinding] = useState<ArgoCDEndpoint | null>(null);

  // `create` outlives the drawer (this section stays mounted), and its
  // variables carry token_b64. Reset it whenever the drawer closes,
  // success or not, so the token doesn't sit in the MutationCache while
  // the page stays open (UI-N-02). Also clears a stale error on reopen.
  const closeCreate = () => {
    create.reset();
    setCreating(false);
  };

  const rows = list.data ?? [];
  const actions = (e: ArgoCDEndpoint) => (
    <span className="inline-flex gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setFinding(e)}
        disabled={!e.enabled}
        title={e.enabled ? undefined : 'Turn the endpoint on first.'}
        aria-label={`Find apps in ${e.name}`}
      >
        Find apps
      </Button>
      <Button variant="danger" size="sm" onClick={() => setDeleting(e)} aria-label={`Delete ${e.name}…`}>
        Delete…
      </Button>
    </span>
  );
  const columns: Column<ArgoCDEndpoint>[] = [
    { key: 'name', header: 'Name', render: (e) => <span className="font-medium text-ink">{e.name}</span> },
    {
      key: 'url',
      header: 'Base URL',
      render: (e) => (
        <span className="block max-w-[320px] break-all font-mono text-mono">
          {e.base_url}
          {e.kms_key_id && <span className="block text-caption text-muted" title="KMS key that encrypts the token">key {e.kms_key_id}</span>}
        </span>
      ),
    },
    { key: 'health', header: 'Health', render: (e) => <Health endpoint={e} /> },
    { key: 'enabled', header: 'On', render: (e) => <EnabledSwitch endpoint={e} /> },
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', className: 'whitespace-nowrap', render: actions },
  ];

  return (
    <section aria-labelledby="argo-heading">
      <SectionHeader
        id="argo-heading"
        title="ArgoCD endpoints"
        count={list.data ? rows.length : undefined}
        description="The token is set once. After that you can turn an endpoint on or off, or delete it."
        action={
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Add endpoint
          </Button>
        }
      />
      {list.isLoading && <p className="text-muted">Loading endpoints…</p>}
      {list.isError && !isNotFound(list.error) && (
        <Banner
          tone="error"
          title="Couldn't load the ArgoCD endpoints."
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
          <EmptyState title="No ArgoCD endpoints yet.">Add one with a read-only token to show sync status on requests.</EmptyState>
        ) : (
          <DataTable
            label="ArgoCD endpoints"
            columns={columns}
            rows={rows}
            rowKey={(e) => e.id}
            minWidth={760}
            stacked={(e) => (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center justify-between gap-3">
                  <span className="font-medium text-ink">{e.name}</span>
                  <Health endpoint={e} />
                </p>
                <p className="break-all font-mono text-mono-small text-muted">{e.base_url}</p>
                <EnabledSwitch endpoint={e} withLabel />
                <div className="mt-1">{actions(e)}</div>
              </div>
            )}
          />
        ))}

      {creating && (
        <Drawer
          title="Add an ArgoCD endpoint"
          onClose={closeCreate}
          footer={
            <>
              <Button variant="secondary" onClick={closeCreate} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" form={formId} variant="primary" disabled={create.isPending} aria-busy={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add endpoint'}
              </Button>
            </>
          }
        >
          <ArgoCDEndpointForm
            formId={formId}
            submitError={create.error}
            onSubmit={async (body: ArgoCDEndpointInput) => {
              await create.mutateAsync(body);
              toast(`Added ${body.name}.`);
              closeCreate();
            }}
          />
        </Drawer>
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete ${deleting.name}?`}
          body="Mappings on this endpoint stay, but their sync status stops updating. To rotate the token, delete the endpoint and add it again."
          confirmText="Delete endpoint"
          danger
          loading={del.isPending}
          error={del.error ?? undefined}
          onCancel={() => {
            del.reset();
            setDeleting(null);
          }}
          onConfirm={async () => {
            try {
              await del.mutateAsync(deleting.id);
              toast(`Deleted ${deleting.name}.`);
              setDeleting(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}

      {finding && <DiscoverAppsPanel endpoint={finding} onClose={() => setFinding(null)} onDone={() => setFinding(null)} />}
    </section>
  );
}

function Health({ endpoint: e }: { endpoint: ArgoCDEndpoint }) {
  if (e.health_error) {
    return (
      <span title={e.health_error}>
        <ToneStatus tone="bad">Error</ToneStatus>
      </span>
    );
  }
  if (e.last_health_at) return <ToneStatus tone="ok">Healthy</ToneStatus>;
  return <ToneStatus tone="neutral">Unknown</ToneStatus>;
}

function EnabledSwitch({ endpoint, withLabel }: { endpoint: ArgoCDEndpoint; withLabel?: boolean }) {
  const setEnabled = useSetArgoCDEndpointEnabled(endpoint.id);
  const toast = useToast();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-ui font-normal">
      <input
        type="checkbox"
        checked={endpoint.enabled}
        disabled={setEnabled.isPending}
        onChange={async (ev) => {
          const on = ev.target.checked;
          try {
            await setEnabled.mutateAsync(on);
            toast(`${endpoint.name} turned ${on ? 'on' : 'off'}.`);
          } catch (err) {
            toast(`Couldn't turn ${endpoint.name} ${on ? 'on' : 'off'}: ${errorText(err)}`);
          }
        }}
        className="h-4 w-4 accent-accent"
        aria-label={withLabel ? undefined : `${endpoint.name} on`}
      />
      {withLabel && 'On'}
    </label>
  );
}

// --- mappings -------------------------------------------------------

function MappingsSection() {
  const list = useGitOpsAppMappings();
  const endpoints = useArgoCDEndpoints();
  const connections = useProviderConnectionsAdmin();
  const create = useCreateGitOpsAppMapping();
  const del = useDeleteGitOpsAppMapping();
  const toast = useToast();
  const formId = useId();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<GitOpsAppMapping | null>(null);

  const endpointName = (id: string) => endpoints.data?.find((e) => e.id === id)?.name ?? 'Unknown endpoint';
  const binding = (m: GitOpsAppMapping) => {
    if (m.provider_connection_id) {
      return connections.data?.find((c) => c.id === m.provider_connection_id)?.name ?? 'A provider connection';
    }
    return m.secret_mapping_id ? (
      <span>
        Legacy secret mapping <span className="font-mono text-mono-small text-muted">{m.secret_mapping_id.slice(0, 8)}</span>
      </span>
    ) : (
      '—'
    );
  };
  const closeCreate = () => {
    create.reset();
    setCreating(false);
  };

  const rows = list.data ?? [];
  const dash = <span className="text-muted">—</span>;
  const columns: Column<GitOpsAppMapping>[] = [
    { key: 'app', header: 'Application', render: (m) => <span className="font-mono text-mono text-ink">{m.application_name}</span> },
    { key: 'endpoint', header: 'Endpoint', render: (m) => endpointName(m.argocd_endpoint_id) },
    { key: 'ns', header: 'Namespace', render: (m) => (m.application_namespace ? <span className="font-mono text-mono">{m.application_namespace}</span> : dash) },
    { key: 'project', header: 'ArgoCD project', render: (m) => (m.project_name ? <span className="font-mono text-mono">{m.project_name}</span> : dash) },
    { key: 'cluster', header: 'Cluster', render: (m) => (m.cluster_name ? <span className="font-mono text-mono">{m.cluster_name}</span> : dash) },
    { key: 'binding', header: 'Bound to', render: binding },
    {
      key: 'actions',
      header: 'Actions',
      hiddenHeader: true,
      align: 'right',
      render: (m) => (
        <Button variant="danger" size="sm" onClick={() => setDeleting(m)} aria-label={`Delete mapping for ${m.application_name}…`}>
          Delete…
        </Button>
      ),
    },
  ];

  return (
    <section aria-labelledby="map-heading">
      <SectionHeader
        id="map-heading"
        title="GitOps app mappings"
        count={list.data ? rows.length : undefined}
        description="Ties an ArgoCD application to the workload that uses a secret. Its sync status appears on the request page once observed."
        action={
          <Button variant="secondary" onClick={() => setCreating(true)}>
            Add mapping
          </Button>
        }
      />
      {list.isLoading && <p className="text-muted">Loading mappings…</p>}
      {list.isError && !isNotFound(list.error) && (
        <Banner
          tone="error"
          title="Couldn't load the mappings."
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
          <EmptyState title="No app mappings yet.">Add one by hand, or use Find apps on an endpoint to add several at once.</EmptyState>
        ) : (
          <DataTable
            label="GitOps app mappings"
            columns={columns}
            rows={rows}
            rowKey={(m) => m.id}
            minWidth={860}
            stacked={(m) => (
              <div className="flex flex-col gap-1">
                <p className="font-mono text-mono text-ink">{m.application_name}</p>
                <p className="text-caption text-muted">
                  {endpointName(m.argocd_endpoint_id)}
                  {m.application_namespace ? ` · ${m.application_namespace}` : ''}
                  {m.cluster_name ? ` · ${m.cluster_name}` : ''}
                </p>
                <p className="text-caption">Bound to {binding(m)}</p>
                <div className="mt-1">
                  <Button variant="danger" size="sm" onClick={() => setDeleting(m)} aria-label={`Delete mapping for ${m.application_name}…`}>
                    Delete…
                  </Button>
                </div>
              </div>
            )}
          />
        ))}

      {creating && (
        <Drawer
          title="Add a GitOps app mapping"
          onClose={closeCreate}
          footer={
            <>
              <Button variant="secondary" onClick={closeCreate} disabled={create.isPending}>
                Cancel
              </Button>
              <Button type="submit" form={formId} variant="primary" disabled={create.isPending} aria-busy={create.isPending}>
                {create.isPending ? 'Adding…' : 'Add mapping'}
              </Button>
            </>
          }
        >
          <GitOpsAppMappingForm
            formId={formId}
            submitError={create.error}
            onSubmit={async (body: GitOpsAppMappingInput) => {
              await create.mutateAsync(body);
              toast(`Added a mapping for ${body.application_name}.`);
              closeCreate();
            }}
          />
        </Drawer>
      )}

      {deleting && (
        <ConfirmModal
          title={`Delete the mapping for ${deleting.application_name}?`}
          body="Its sync status stops updating on requests. You can add it again later."
          confirmText="Delete mapping"
          danger
          loading={del.isPending}
          error={del.error ?? undefined}
          onCancel={() => {
            del.reset();
            setDeleting(null);
          }}
          onConfirm={async () => {
            try {
              await del.mutateAsync(deleting.id);
              toast(`Deleted the mapping for ${deleting.application_name}.`);
              setDeleting(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </section>
  );
}

function FeatureOff() {
  return (
    <div>
      <PageHeader title="Integrations" description={DESCRIPTION} />
      <EmptyState
        title="GitOps observation is turned off on this control plane."
        action={
          <ul className="m-0 list-disc pl-5 font-mono text-mono">
            <li>SB_GITOPS_ENABLED=true on the api</li>
            <li>SB_WORKER_GITOPS_ENABLED=true on the worker, so sync status is polled</li>
          </ul>
        }
      >
        The api doesn't serve the ArgoCD routes. To turn it on, set both of these and restart the services:
      </EmptyState>
    </div>
  );
}
