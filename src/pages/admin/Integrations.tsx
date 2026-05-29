/**
 * Integrations admin page (BRD §26 — read-only GitOps visibility).
 *
 * Polished in ui#15 to match the design pattern from ui#13/ui#14:
 *   - PageHeader + Card-wrapped tables + shared `src/ui/` primitives
 *   - Brand-gradient primary CTAs; font-mono cyan accent for identifiers
 *   - StatusPill for health + enabled state
 *
 * Two stacked sections (semantics unchanged from before):
 *   1. ArgoCD endpoints — connection metadata + write-once token, with
 *      an inline `enabled` toggle and delete confirm. No edit drawer;
 *      create-only + toggle-only by api design.
 *   2. GitOps app mappings — bind an ArgoCD application to a secret
 *      consumer. Create-only + delete-only.
 *
 * The feature is opt-in server-side (`SB_GITOPS_ENABLED`). When OFF,
 * the api literally doesn't mount the routes — calls return 404. We
 * detect that via the first list query and render a "feature disabled"
 * banner instead of an empty table.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import type {
  ArgoCDEndpoint,
  ArgoCDEndpointInput,
  GitOpsAppMapping,
  GitOpsAppMappingInput,
} from '../../api/types';
import {
  useArgoCDEndpoints,
  useCreateArgoCDEndpoint,
  useCreateGitOpsAppMapping,
  useDeleteArgoCDEndpoint,
  useDeleteGitOpsAppMapping,
  useGitOpsAppMappings,
  useSetArgoCDEndpointEnabled,
} from '../../api/integrations';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';
import { ArgoCDEndpointForm } from './ArgoCDEndpointForm';
import { DiscoverAppsPanel } from './DiscoverAppsPanel';
import { GitOpsAppMappingForm } from './GitOpsAppMappingForm';

export function Integrations() {
  const endpoints = useArgoCDEndpoints();
  const mappings = useGitOpsAppMappings();

  const featureDisabled =
    isNotFound(endpoints.error) || isNotFound(mappings.error);

  if (featureDisabled) {
    return <FeatureDisabledBanner />;
  }

  return (
    <div>
      <PageHeader
        title="Integrations"
        description="ArgoCD endpoints and GitOps application mappings powering the read-only sync-status panel (BRD §26)."
      />

      <div className="space-y-8">
        <EndpointsSection />
        <MappingsSection />
      </div>
    </div>
  );
}

// --- endpoints section ----------------------------------------------

function EndpointsSection() {
  const list = useArgoCDEndpoints();
  const create = useCreateArgoCDEndpoint();
  const del = useDeleteArgoCDEndpoint();

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ArgoCDEndpoint | null>(null);
  const [discovering, setDiscovering] = useState<ArgoCDEndpoint | null>(null);

  return (
    <section>
      <SectionHeader
        title="ArgoCD endpoints"
        description="Write-once token; toggle or delete after create."
        action={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            + New endpoint
          </Button>
        }
      />

      {list.isError && !isNotFound(list.error) && (
        <ErrorBanner title="Failed to load endpoints" err={list.error} />
      )}
      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No endpoints registered yet.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>Name</Th>
                <Th>Base URL</Th>
                <Th>KMS key</Th>
                <Th>Health</Th>
                <Th>Enabled</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((e) => (
                <EndpointRow
                  key={e.id}
                  endpoint={e}
                  onDelete={() => setConfirmDelete(e)}
                  onDiscover={() => setDiscovering(e)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <Drawer title="New ArgoCD endpoint" onClose={() => setCreating(false)}>
          <ArgoCDEndpointForm
            onSubmit={async (body: ArgoCDEndpointInput) => {
              await create.mutateAsync(body);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            submitting={create.isPending}
            submitError={create.error}
          />
        </Drawer>
      )}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete endpoint "${confirmDelete.name}"?`}
          body="Existing mappings on this endpoint will continue to reference it but observations will stop succeeding. To rotate the token, delete + recreate."
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

      {discovering && (
        <Drawer
          wide
          title={`Discover apps in "${discovering.name}"`}
          onClose={() => setDiscovering(null)}
        >
          <DiscoverAppsPanel
            endpoint={discovering}
            onClose={() => setDiscovering(null)}
            onDone={() => setDiscovering(null)}
          />
        </Drawer>
      )}
    </section>
  );
}

function EndpointRow({
  endpoint,
  onDelete,
  onDiscover,
}: {
  endpoint: ArgoCDEndpoint;
  onDelete: () => void;
  onDiscover: () => void;
}) {
  const setEnabled = useSetArgoCDEndpointEnabled(endpoint.id);

  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top">
      <Td>
        <span className="font-mono text-accent text-sm">{endpoint.name}</span>
      </Td>
      <Td>
        <code className="text-xs font-mono text-muted break-all">
          {endpoint.base_url}
        </code>
      </Td>
      <Td>
        <span className="font-mono text-muted text-[11px]">
          {endpoint.kms_key_id || '—'}
        </span>
      </Td>
      <Td>
        {endpoint.health_error ? (
          <StatusPill
            variant="error"
            tone="outline"
            title={endpoint.health_error}
          >
            error
          </StatusPill>
        ) : endpoint.last_health_at ? (
          <StatusPill variant="success" tone="outline">
            healthy
          </StatusPill>
        ) : (
          <StatusPill variant="neutral" tone="outline">
            unknown
          </StatusPill>
        )}
      </Td>
      <Td>
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={endpoint.enabled}
            disabled={setEnabled.isPending}
            onChange={(e) =>
              setEnabled.mutateAsync(e.target.checked).catch(() => {})
            }
            className="h-4 w-4 accent-accent"
          />
        </label>
      </Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onDiscover}
            disabled={!endpoint.enabled}
            title={
              endpoint.enabled
                ? 'Discover ArgoCD apps + bulk-create mappings'
                : 'Enable the endpoint first'
            }
            className={
              endpoint.enabled
                ? 'text-accent hover:text-accent-bright text-sm font-medium'
                : 'text-muted/50 cursor-not-allowed text-sm font-medium'
            }
          >
            Discover
          </button>
          <button
            onClick={onDelete}
            className="text-red-300 hover:text-red-200 text-sm font-medium"
          >
            Delete
          </button>
        </div>
      </Td>
    </tr>
  );
}

// --- mappings section -----------------------------------------------

function MappingsSection() {
  const list = useGitOpsAppMappings();
  const endpoints = useArgoCDEndpoints();
  const create = useCreateGitOpsAppMapping();
  const del = useDeleteGitOpsAppMapping();

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GitOpsAppMapping | null>(
    null,
  );

  const endpointName = (id: string) =>
    endpoints.data?.find((e) => e.id === id)?.name ?? id.slice(0, 8) + '…';

  return (
    <section>
      <SectionHeader
        title="GitOps app mappings"
        description="Bind an ArgoCD application to the workload that consumes a secret. Read-only; sync state appears in the request detail page after observation lands."
        action={
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            + New mapping
          </Button>
        }
      />

      {list.isError && !isNotFound(list.error) && (
        <ErrorBanner title="Failed to load mappings" err={list.error} />
      )}
      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No mappings yet.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>Endpoint</Th>
                <Th>App</Th>
                <Th>Namespace</Th>
                <Th>Project</Th>
                <Th>Cluster</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top"
                >
                  <Td>
                    <span className="font-mono text-accent text-sm">
                      {endpointName(m.argocd_endpoint_id)}
                    </span>
                  </Td>
                  <Td>
                    <span className="font-mono text-text text-sm">
                      {m.application_name}
                    </span>
                  </Td>
                  <Td className="text-muted">
                    {m.application_namespace || (
                      <span className="text-muted/50 italic">—</span>
                    )}
                  </Td>
                  <Td className="text-muted">
                    {m.project_name || (
                      <span className="text-muted/50 italic">—</span>
                    )}
                  </Td>
                  <Td className="text-muted">
                    {m.cluster_name || (
                      <span className="text-muted/50 italic">—</span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <button
                      onClick={() => setConfirmDelete(m)}
                      className="text-red-300 hover:text-red-200 text-sm font-medium"
                    >
                      Delete
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <Drawer title="New GitOps mapping" onClose={() => setCreating(false)}>
          <GitOpsAppMappingForm
            onSubmit={async (body: GitOpsAppMappingInput) => {
              await create.mutateAsync(body);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
            submitting={create.isPending}
            submitError={create.error}
          />
        </Drawer>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete mapping?"
          body={`Application "${confirmDelete.application_name}" will stop receiving observation polls.`}
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
    </section>
  );
}

// --- shared bits ----------------------------------------------------

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-3">
      <div>
        <h2 className="text-text text-base font-semibold">{title}</h2>
        <p className="text-muted text-sm mt-1 max-w-2xl">{description}</p>
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}

function FeatureDisabledBanner() {
  return (
    <div>
      <PageHeader
        title="Integrations"
        description="ArgoCD endpoints and GitOps application mappings powering the read-only sync-status panel (BRD §26)."
      />
      <Card className="p-6 text-sm space-y-3">
        <div className="flex items-center gap-2">
          <StatusPill variant="warning" tone="outline">
            disabled
          </StatusPill>
          <span className="text-yellow-300 font-medium">
            GitOps observation integration is off on this api.
          </span>
        </div>
        <p className="text-muted">
          The api process responded with <code className="font-mono">404</code>{' '}
          on the ArgoCD endpoints route, which means the BRD §26 integration is
          not mounted. Enable it by setting:
        </p>
        <ul className="text-muted text-xs list-disc ml-5 space-y-1 font-mono">
          <li>
            <code>SB_GITOPS_ENABLED=true</code> on the api process
          </li>
          <li>
            <code>SB_WORKER_GITOPS_ENABLED=true</code> on the worker process
            (so observations actually poll)
          </li>
        </ul>
        <p className="text-muted">Then restart both services and reload this page.</p>
      </Card>
    </div>
  );
}

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function ErrorBanner({ title, err }: { title: string; err: unknown }) {
  return (
    <Card className="border-red-500/40 p-5 text-sm mb-4">
      <div className="text-red-300 font-medium">{title}</div>
      <div className="text-muted mt-1">{stringifyError(err)}</div>
    </Card>
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

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
