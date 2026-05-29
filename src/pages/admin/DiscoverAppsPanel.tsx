/**
 * Bulk-create gitops_app_mappings from ArgoCD discovery.
 *
 * Drawer panel opened from the Integrations page's endpoint row.
 * Calls `GET /argocd-endpoints/:id/discovered-apps[?project=…]`,
 * renders the result grouped by destination_namespace, and lets the
 * operator:
 *
 *   - Optionally filter by ArgoCD project name (default = none).
 *   - Toggle individual apps (default = all checked).
 *   - Bulk toggle per namespace group via group-header checkboxes.
 *   - Provide a SHARED binding (secret_mapping_id OR
 *     provider_connection_id) applied to every checked app.
 *   - Submit one POST per checked app and watch a progress counter.
 *
 * Why one shared binding instead of per-row: in egov-uat shape every
 * team's apps bind to the same provider connection (per team). The
 * operator runs the panel once per binding-target. Re-running with a
 * different filter + binding is cheap.
 *
 * Hard rule respected: each row POST goes through the standard
 * `POST /api/v1/gitops-app-mappings` so the api's "exactly one of
 * secret_mapping_id or provider_connection_id" check still applies.
 * Discovery does NOT bypass the audit / validation path.
 */

import { useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import type {
  ArgoCDEndpoint,
  DiscoveredApp,
  GitOpsAppMappingInput,
} from '../../api/types';
import {
  useCreateGitOpsAppMapping,
  useDiscoveredApps,
} from '../../api/integrations';

interface Props {
  endpoint: ArgoCDEndpoint;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Render this inside the existing Integrations page Drawer; the
 * caller supplies the drawer chrome. Component takes the endpoint
 * directly so the discovery query keys are stable across re-mounts.
 */
export function DiscoverAppsPanel({ endpoint, onClose, onDone }: Props) {
  const [project, setProject] = useState('');
  const [active, setActive] = useState(false);
  const [secretMappingId, setSecretMappingId] = useState('');
  const [providerConnectionId, setProviderConnectionId] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkState>({ running: false, done: 0, failed: 0, errors: [] });

  const discover = useDiscoveredApps(endpoint.id, project, { enabled: active });
  const createOne = useCreateGitOpsAppMapping();

  const groups = useMemo(() => groupByDestination(discover.data ?? []), [discover.data]);

  const allChecked = checked.size > 0 && checked.size === (discover.data?.length ?? 0);
  const noneChecked = checked.size === 0;

  const bindingValid =
    (!!secretMappingId && !providerConnectionId) ||
    (!secretMappingId && !!providerConnectionId);
  const validId = isUUID(secretMappingId) || isUUID(providerConnectionId);

  const toggleApp = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const toggleGroup = (apps: DiscoveredApp[]) => {
    setChecked((prev) => {
      const next = new Set(prev);
      const keys = apps.map(rowKey);
      const allOn = keys.every((k) => next.has(k));
      if (allOn) keys.forEach((k) => next.delete(k));
      else keys.forEach((k) => next.add(k));
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set((discover.data ?? []).map(rowKey)));
  };

  const submitBulk = async () => {
    if (!bindingValid || !validId) return;
    if (!discover.data) return;

    const toCreate = discover.data.filter((a) => checked.has(rowKey(a)));
    setBulk({ running: true, done: 0, failed: 0, errors: [] });

    let done = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const app of toCreate) {
      const body: GitOpsAppMappingInput = {
        argocd_endpoint_id: endpoint.id,
        application_name: app.name,
        application_namespace: app.namespace || undefined,
        project_name: app.project || undefined,
        cluster_name: app.destination_cluster || undefined,
        secret_mapping_id: secretMappingId || undefined,
        provider_connection_id: providerConnectionId || undefined,
      };
      try {
        await createOne.mutateAsync(body);
        done++;
      } catch (e) {
        failed++;
        const msg =
          e instanceof ApiError ? `${app.name}: ${e.status} ${e.message}` : `${app.name}: ${String(e)}`;
        errors.push(msg);
      }
      setBulk({ running: true, done, failed, errors });
    }

    setBulk({ running: false, done, failed, errors });
    if (failed === 0) onDone();
  };

  return (
    <div className="space-y-4">
      <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2">
        Bulk-create gitops mappings from ArgoCD discovery. The shared binding below applies to every checked app; re-run the panel for a different binding.
      </div>

      <div className="grid grid-cols-1 gap-3">
        <Field label="ArgoCD project filter (optional)" hint="e.g. egov-uat. Empty = every app the token can see.">
          <div className="flex gap-2">
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="egov-uat"
              className={inputCls + ' flex-1'}
            />
            <button
              onClick={() => setActive(true)}
              disabled={discover.isFetching}
              className="bg-accent text-bg font-medium px-4 rounded hover:opacity-90 disabled:opacity-50"
            >
              {discover.isFetching ? 'Loading…' : 'Discover'}
            </button>
          </div>
        </Field>

        <fieldset className="border border-border rounded p-3 space-y-3">
          <legend className="text-xs text-muted px-1">Shared binding — set exactly one for the batch</legend>
          <Field label="secret_mapping_id (UUID)">
            <input
              value={secretMappingId}
              onChange={(e) => setSecretMappingId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={inputCls}
            />
          </Field>
          <Field label="provider_connection_id (UUID)">
            <input
              value={providerConnectionId}
              onChange={(e) => setProviderConnectionId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
              className={inputCls}
            />
          </Field>
          {!bindingValid && (
            <div className="text-[11px] text-yellow-300">Set exactly one of the two UUIDs above.</div>
          )}
        </fieldset>
      </div>

      {discover.error && (
        <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
          {stringifyError(discover.error)}
        </div>
      )}

      {discover.data && discover.data.length === 0 && active && !discover.isFetching && (
        <div className="bg-surface border border-border rounded p-4 text-center text-muted text-sm">
          No apps visible to the endpoint's token. Check the token's RBAC (e.g. ArgoCD project role with <code>applications, get</code>).
        </div>
      )}

      {discover.data && discover.data.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>
              {discover.data.length} apps discovered across {groups.length} namespaces · {checked.size} selected
            </span>
            <div className="flex gap-3">
              <button onClick={toggleAll} className="text-accent hover:opacity-90">
                {allChecked ? 'Uncheck all' : 'Check all'}
              </button>
            </div>
          </div>

          <div className="max-h-[420px] overflow-auto border border-border rounded">
            {groups.map((g) => {
              const groupKeys = g.apps.map(rowKey);
              const groupOn = groupKeys.every((k) => checked.has(k));
              const groupPartial = !groupOn && groupKeys.some((k) => checked.has(k));
              return (
                <div key={g.namespace} className="border-b border-border/40 last:border-0">
                  <div className="flex items-center gap-2 px-3 py-2 bg-bg/30">
                    <input
                      type="checkbox"
                      checked={groupOn}
                      ref={(el) => el && (el.indeterminate = groupPartial)}
                      onChange={() => toggleGroup(g.apps)}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="text-text text-sm font-medium">{g.namespace || '(no destination namespace)'}</span>
                    <span className="text-muted text-xs">· {g.apps.length} apps</span>
                  </div>
                  <ul>
                    {g.apps.map((a) => {
                      const k = rowKey(a);
                      return (
                        <li key={k} className="px-3 py-1.5 flex items-center gap-2 hover:bg-bg/20">
                          <input
                            type="checkbox"
                            checked={checked.has(k)}
                            onChange={() => toggleApp(k)}
                            className="h-4 w-4 accent-accent"
                          />
                          <span className="text-text text-sm flex-1">{a.name}</span>
                          {a.project && (
                            <span className="text-[11px] bg-bg border border-border text-muted rounded px-2">
                              {a.project}
                            </span>
                          )}
                          {a.sync_status && (
                            <span
                              className={
                                'text-[11px] rounded px-2 ' +
                                (a.sync_status === 'Synced'
                                  ? 'bg-green-400/15 text-green-300'
                                  : 'bg-yellow-400/15 text-yellow-300')
                              }
                            >
                              {a.sync_status}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bulk.running && (
        <div className="text-xs text-muted">
          Creating mappings… {bulk.done + bulk.failed} / {checked.size} ({bulk.failed} failed)
        </div>
      )}

      {!bulk.running && bulk.done + bulk.failed > 0 && (
        <div
          className={
            bulk.failed === 0
              ? 'text-xs text-green-300 bg-green-400/10 border border-green-400/30 rounded px-3 py-2'
              : 'text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2'
          }
        >
          {bulk.done} created, {bulk.failed} failed.
          {bulk.errors.length > 0 && (
            <ul className="mt-2 list-disc list-inside space-y-0.5">
              {bulk.errors.slice(0, 5).map((e, i) => (
                <li key={i} className="font-mono text-[11px]">{e}</li>
              ))}
              {bulk.errors.length > 5 && (
                <li className="text-[11px]">…and {bulk.errors.length - 5} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          onClick={submitBulk}
          disabled={
            bulk.running ||
            noneChecked ||
            !bindingValid ||
            !validId
          }
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
        >
          {bulk.running ? 'Creating…' : `Create ${checked.size} mappings`}
        </button>
        <button
          onClick={onClose}
          className="text-muted hover:text-text px-3 py-2 rounded border border-border"
        >
          Close
        </button>
      </div>
    </div>
  );
}

interface BulkState {
  running: boolean;
  done: number;
  failed: number;
  errors: string[];
}

function rowKey(a: DiscoveredApp): string {
  return `${a.namespace ?? ''}/${a.name}`;
}

function groupByDestination(apps: DiscoveredApp[]): { namespace: string; apps: DiscoveredApp[] }[] {
  const map = new Map<string, DiscoveredApp[]>();
  for (const a of apps) {
    const ns = a.destination_namespace ?? '';
    const bucket = map.get(ns);
    if (bucket) bucket.push(a);
    else map.set(ns, [a]);
  }
  return Array.from(map.entries())
    .map(([namespace, apps]) => ({
      namespace,
      apps: [...apps].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return 'Discovery unavailable — the endpoint is disabled or ArgoCD did not respond.';
    if (e.status === 404) return 'Endpoint not found.';
    return `${e.status}: ${e.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

const inputCls =
  'w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-muted/80">{hint}</div>}
    </div>
  );
}
