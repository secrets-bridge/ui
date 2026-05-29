/**
 * Integrations admin page (BRD §26 — read-only GitOps visibility).
 *
 * Two stacked sections:
 *   1. ArgoCD endpoints — connection metadata + write-once token,
 *      with an inline `enabled` toggle and delete confirm. No edit
 *      drawer; create-only + toggle-only by api design.
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
    <div className="space-y-8">
      <div>
        <h1 className="text-text text-xl font-semibold">Integrations</h1>
        <p className="text-muted text-sm mt-1">
          ArgoCD endpoints and GitOps application mappings for the read-only sync-status panel
          (<a className="underline" href="https://github.com/secrets-bridge/api/issues/27" target="_blank" rel="noreferrer">BRD §26</a>).
        </p>
      </div>

      <EndpointsSection />

      <hr className="border-border" />

      <MappingsSection />
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
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text text-base font-semibold">ArgoCD endpoints</h2>
          <p className="text-muted text-sm">
            Write-once token; toggle or delete after create.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90"
        >
          + New endpoint
        </button>
      </div>

      {list.isError && !isNotFound(list.error) && (
        <ErrorBanner title="Failed to load endpoints" err={list.error} />
      )}
      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
          No endpoints registered yet.
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Name</th>
                <th className="px-4 py-3 font-normal">Base URL</th>
                <th className="px-4 py-3 font-normal">KMS key</th>
                <th className="px-4 py-3 font-normal">Health</th>
                <th className="px-4 py-3 font-normal">Enabled</th>
                <th className="px-4 py-3 font-normal text-right">Actions</th>
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
        </div>
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
    <tr className="border-b border-border/50 last:border-0 hover:bg-bg/30 align-top">
      <td className="px-4 py-3 text-text">{endpoint.name}</td>
      <td className="px-4 py-3 text-muted">
        <code className="text-xs">{endpoint.base_url}</code>
      </td>
      <td className="px-4 py-3 text-muted text-xs">{endpoint.kms_key_id}</td>
      <td className="px-4 py-3 text-xs">
        {endpoint.health_error ? (
          <span title={endpoint.health_error} className="text-red-300">
            error
          </span>
        ) : endpoint.last_health_at ? (
          <span className="text-green-300">healthy</span>
        ) : (
          <span className="text-muted italic">unknown</span>
        )}
      </td>
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
          <input
            type="checkbox"
            checked={endpoint.enabled}
            disabled={setEnabled.isPending}
            onChange={(e) => setEnabled.mutateAsync(e.target.checked).catch(() => {})}
            className="h-4 w-4 accent-accent"
          />
        </label>
      </td>
      <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
        <button
          onClick={onDiscover}
          disabled={!endpoint.enabled}
          title={endpoint.enabled ? 'Discover ArgoCD apps + bulk-create mappings' : 'Enable the endpoint first'}
          className="text-xs text-accent hover:opacity-90 border border-border px-2 py-1 rounded disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Discover
        </button>
        <button
          onClick={onDelete}
          className="text-xs text-red-400 hover:text-red-300 border border-border px-2 py-1 rounded"
        >
          Delete
        </button>
      </td>
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
  const [confirmDelete, setConfirmDelete] = useState<GitOpsAppMapping | null>(null);

  const endpointName = (id: string) =>
    endpoints.data?.find((e) => e.id === id)?.name ?? id.slice(0, 8) + '…';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-text text-base font-semibold">GitOps app mappings</h2>
          <p className="text-muted text-sm">
            Bind an ArgoCD application to the workload that consumes a secret. Read-only; sync state appears in the request detail page after observation lands.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90"
        >
          + New mapping
        </button>
      </div>

      {list.isError && !isNotFound(list.error) && (
        <ErrorBanner title="Failed to load mappings" err={list.error} />
      )}
      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <div className="bg-surface border border-border rounded p-6 text-center text-muted text-sm">
          No mappings yet.
        </div>
      )}

      {list.data && list.data.length > 0 && (
        <div className="bg-surface border border-border rounded overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-normal">Endpoint</th>
                <th className="px-4 py-3 font-normal">App</th>
                <th className="px-4 py-3 font-normal">Namespace</th>
                <th className="px-4 py-3 font-normal">Project</th>
                <th className="px-4 py-3 font-normal">Cluster</th>
                <th className="px-4 py-3 font-normal text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((m) => (
                <tr key={m.id} className="border-b border-border/50 last:border-0 hover:bg-bg/30">
                  <td className="px-4 py-3 text-text">{endpointName(m.argocd_endpoint_id)}</td>
                  <td className="px-4 py-3 text-text">{m.application_name}</td>
                  <td className="px-4 py-3 text-muted">{m.application_namespace || '—'}</td>
                  <td className="px-4 py-3 text-muted">{m.project_name || '—'}</td>
                  <td className="px-4 py-3 text-muted">{m.cluster_name || '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setConfirmDelete(m)}
                      className="text-xs text-red-400 hover:text-red-300 border border-border px-2 py-1 rounded"
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

function FeatureDisabledBanner() {
  return (
    <div className="space-y-4">
      <h1 className="text-text text-xl font-semibold">Integrations</h1>
      <div className="bg-surface border border-border rounded p-6 text-sm space-y-2">
        <div className="text-yellow-300 font-medium">GitOps observation integration is disabled on this api.</div>
        <p className="text-muted">
          The api process responded with <code>404</code> on the ArgoCD endpoints route, which means the BRD §26 integration is not mounted. Enable it by setting:
        </p>
        <ul className="text-muted text-xs list-disc ml-5 space-y-1">
          <li><code>SB_GITOPS_ENABLED=true</code> on the api process</li>
          <li><code>SB_WORKER_GITOPS_ENABLED=true</code> on the worker process (so observations actually poll)</li>
        </ul>
        <p className="text-muted">
          Then restart both services and reload this page.
        </p>
      </div>
    </div>
  );
}

function isNotFound(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

function ErrorBanner({ title, err }: { title: string; err: unknown }) {
  return (
    <div className="bg-surface border border-red-500/40 rounded p-4 text-sm">
      <div className="text-red-400 font-medium">{title}</div>
      <div className="text-muted mt-1">{stringifyError(err)}</div>
    </div>
  );
}

function Drawer({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="absolute inset-0 bg-black/50" onClick={onClose} aria-label="Close drawer" />
      <div
        className={
          (wide ? 'w-[760px]' : 'w-[520px]') +
          ' relative max-w-full bg-surface border-l border-border h-full overflow-auto'
        }
      >
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
      <div className="relative bg-surface border border-border rounded-lg w-[440px] p-5 space-y-3">
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
