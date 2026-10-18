/**
 * Add GitOps app mappings in bulk from ArgoCD discovery, in a drawer
 * opened from an endpoint row on the Integrations page.
 *
 * Calls `GET /argocd-endpoints/:id/discovered-apps[?project=…]`, groups
 * the apps by destination namespace and lets the operator:
 *   - filter by ArgoCD project (applied when "Find apps" is pressed, so
 *     typing doesn't query ArgoCD on every keystroke);
 *   - pick apps one by one or per namespace;
 *   - choose ONE binding for the batch: a provider connection, or a
 *     legacy secret mapping id;
 *   - create one mapping per picked app, with progress.
 *
 * One shared binding instead of per-row: in a typical deployment a
 * team's apps all bind to the same provider connection. Run the drawer
 * again for another binding.
 *
 * Each mapping still goes through `POST /api/v1/gitops-app-mappings`, so
 * the api's "exactly one of secret_mapping_id or provider_connection_id"
 * check and the audit trail apply. Discovery bypasses nothing.
 */

import { useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import { useCreateGitOpsAppMapping, useDiscoveredApps } from '../../api/integrations';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import type { ArgoCDEndpoint, DiscoveredApp, GitOpsAppMappingInput } from '../../api/types';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { Field, Input, Select } from '../../ui/Field';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';

interface Props {
  endpoint: ArgoCDEndpoint;
  onClose: () => void;
  onDone: () => void;
}

interface BulkState {
  running: boolean;
  done: number;
  failed: number;
  errors: string[];
}

export function DiscoverAppsPanel({ endpoint, onClose, onDone }: Props) {
  const toast = useToast();
  const connections = useProviderConnectionsAdmin();
  const [projectText, setProjectText] = useState('');
  const [project, setProject] = useState('');
  const [active, setActive] = useState(false);
  const [connectionId, setConnectionId] = useState('');
  const [secretMappingId, setSecretMappingId] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tried, setTried] = useState(false);
  const [bulk, setBulk] = useState<BulkState>({ running: false, done: 0, failed: 0, errors: [] });

  const discover = useDiscoveredApps(endpoint.id, project, { enabled: active });
  const createOne = useCreateGitOpsAppMapping();
  const apps = useMemo(() => discover.data ?? [], [discover.data]);
  const groups = useMemo(() => groupByDestination(apps), [apps]);
  // Only apps in the current result count; a pick from an earlier
  // search with another project filter doesn't.
  const picked = apps.filter((a) => checked.has(rowKey(a)));
  const allChecked = apps.length > 0 && picked.length === apps.length;

  const legacy = secretMappingId.trim();
  let bindingError: string | undefined;
  if (!connectionId && !legacy) bindingError = 'Choose a provider connection, or enter a legacy secret mapping id.';
  else if (connectionId && legacy) bindingError = 'Use the provider connection or the legacy id, not both.';
  else if (legacy && !isUUID(legacy)) bindingError = 'A secret mapping id is a UUID.';

  const toggle = (keys: string[]) =>
    setChecked((prev) => {
      const next = new Set(prev);
      const allOn = keys.every((k) => next.has(k));
      for (const k of keys) {
        if (allOn) next.delete(k);
        else next.add(k);
      }
      return next;
    });

  const find = () => {
    setProject(projectText.trim());
    setActive(true);
    setChecked(new Set());
    setBulk({ running: false, done: 0, failed: 0, errors: [] });
  };

  const submitBulk = async () => {
    setTried(true);
    if (bindingError) {
      document.getElementById('discover-connection')?.focus();
      return;
    }
    if (picked.length === 0) return;
    setBulk({ running: true, done: 0, failed: 0, errors: [] });
    let done = 0;
    let failed = 0;
    const errors: string[] = [];
    for (const app of picked) {
      const body: GitOpsAppMappingInput = {
        argocd_endpoint_id: endpoint.id,
        application_name: app.name,
        application_namespace: app.namespace || undefined,
        project_name: app.project || undefined,
        cluster_name: app.destination_cluster || undefined,
        secret_mapping_id: legacy || undefined,
        provider_connection_id: connectionId || undefined,
      };
      try {
        await createOne.mutateAsync(body);
        done++;
      } catch (e) {
        failed++;
        errors.push(e instanceof ApiError ? `${app.name}: ${e.status} ${e.message}` : `${app.name}: ${String(e)}`);
      }
      setBulk({ running: true, done, failed, errors: [...errors] });
    }
    setBulk({ running: false, done, failed, errors });
    if (failed === 0) {
      toast(`Created ${done} ${done === 1 ? 'mapping' : 'mappings'}.`);
      onDone();
    }
  };

  return (
    <Drawer
      wide
      title={`Find apps in ${endpoint.name}`}
      subtitle="Creates a GitOps mapping for each app you pick. The binding you choose applies to all of them."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={bulk.running}>
            Close
          </Button>
          <Button variant="primary" onClick={() => void submitBulk()} disabled={bulk.running || picked.length === 0} aria-busy={bulk.running}>
            {bulk.running ? 'Creating…' : `Create ${picked.length} ${picked.length === 1 ? 'mapping' : 'mappings'}`}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-[18px]">
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
          className="flex flex-col gap-1.5"
        >
          <label htmlFor="discover-project" className="text-body font-semibold text-ink">
            ArgoCD project (optional)
          </label>
          <div className="flex gap-2">
            <Input
              id="discover-project"
              aria-describedby="discover-project-hint"
              value={projectText}
              onChange={(e) => setProjectText(e.target.value)}
              placeholder="tenant-a-uat"
              className="min-w-0 flex-1 font-mono"
              autoComplete="off"
              spellCheck={false}
              data-autofocus
            />
            <Button type="submit" variant="secondary" disabled={discover.isFetching} aria-busy={discover.isFetching}>
              {discover.isFetching ? 'Finding…' : 'Find apps'}
            </Button>
          </div>
          <p id="discover-project-hint" className="text-caption text-muted">
            Empty finds every app the endpoint's token can see.
          </p>
        </form>

        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-body font-semibold text-ink">Binding for the batch</legend>
          <Field id="discover-connection" label="Provider connection" error={tried ? bindingError : undefined}>
            {(p) => (
              <Select {...p} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                <option value="">{connections.isLoading ? 'Loading connections…' : 'Choose a connection'}</option>
                {(connections.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {providerLabel(c.type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <details className="rounded-md border border-border px-3.5 py-2.5">
            <summary className="cursor-pointer select-none text-ui font-medium text-ink">Use a legacy secret mapping instead</summary>
            <div className="mt-3">
              <Field id="discover-secret-mapping" label="Secret mapping id" hint="Leave the provider connection empty when you use this.">
                {(p) => (
                  <Input
                    {...p}
                    value={secretMappingId}
                    onChange={(e) => setSecretMappingId(e.target.value)}
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="font-mono"
                    autoComplete="off"
                    spellCheck={false}
                  />
                )}
              </Field>
            </div>
          </details>
        </fieldset>

        {discover.isError && (
          <Banner tone="error" title="Couldn't list the apps.">
            {discoverErrorText(discover.error)}
          </Banner>
        )}

        {active && discover.data && apps.length === 0 && !discover.isFetching && (
          <Banner title="No apps found.">
            The endpoint's token can't see any app{project ? ` in project ${project}` : ''}. Check its ArgoCD role allows getting
            applications.
          </Banner>
        )}

        {apps.length > 0 && (
          <section aria-labelledby="discover-apps" className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="discover-apps" className="text-body font-semibold text-ink">
                {apps.length} {apps.length === 1 ? 'app' : 'apps'} in {groups.length} {groups.length === 1 ? 'namespace' : 'namespaces'}
                <span className="ml-2 font-normal text-muted">{picked.length} picked</span>
              </h3>
              <Button variant="quiet" size="sm" onClick={() => setChecked(allChecked ? new Set() : new Set(apps.map(rowKey)))}>
                {allChecked ? 'Pick none' : 'Pick all'}
              </Button>
            </div>
            <div className="max-h-[420px] overflow-auto rounded-md border border-border">
              {groups.map((g) => {
                const keys = g.apps.map(rowKey);
                const on = keys.every((k) => checked.has(k));
                const partial = !on && keys.some((k) => checked.has(k));
                return (
                  <div key={g.namespace} className="border-t border-rule first:border-t-0">
                    <label className="flex cursor-pointer items-center gap-2.5 bg-sunken px-3 py-2 text-ui">
                      <input
                        type="checkbox"
                        checked={on}
                        ref={(el) => {
                          if (el) el.indeterminate = partial;
                        }}
                        onChange={() => toggle(keys)}
                        className="h-4 w-4 accent-accent"
                      />
                      <span className="font-mono text-mono font-medium text-ink">{g.namespace || '(no destination namespace)'}</span>
                      <span className="text-caption text-muted">
                        {g.apps.length} {g.apps.length === 1 ? 'app' : 'apps'}
                      </span>
                    </label>
                    <ul className="m-0 list-none p-0">
                      {g.apps.map((a) => {
                        const k = rowKey(a);
                        return (
                          <li key={k}>
                            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 pl-8 text-ui font-normal hover:bg-sunken max-md:min-h-(--control-touch)">
                              <input type="checkbox" checked={checked.has(k)} onChange={() => toggle([k])} className="h-4 w-4 accent-accent" />
                              <span className="min-w-0 flex-1 truncate font-mono text-mono">{a.name}</span>
                              {a.project && <span className="text-caption text-muted">{a.project}</span>}
                              {a.sync_status && <ToneStatus tone={a.sync_status === 'Synced' ? 'ok' : 'warn'}>{a.sync_status}</ToneStatus>}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div aria-live="polite">
          {bulk.running && (
            <p className="text-ui font-normal text-muted">
              Creating mappings: {bulk.done + bulk.failed} of {picked.length}
              {bulk.failed ? `, ${bulk.failed} failed` : ''}.
            </p>
          )}
          {!bulk.running && bulk.failed > 0 && (
            <Banner tone="error" title={`${bulk.done} created, ${bulk.failed} failed.`}>
              <ul className="m-0 list-disc pl-5">
                {bulk.errors.slice(0, 5).map((e, i) => (
                  <li key={i} className="font-mono text-mono-small">
                    {e}
                  </li>
                ))}
                {bulk.errors.length > 5 && <li>and {bulk.errors.length - 5} more</li>}
              </ul>
            </Banner>
          )}
        </div>
      </div>
    </Drawer>
  );
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
    .map(([namespace, list]) => ({ namespace, apps: [...list].sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => a.namespace.localeCompare(b.namespace));
}

function isUUID(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function discoverErrorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 503) return 'The endpoint is disabled, or ArgoCD did not answer.';
    if (e.status === 404) return 'The endpoint no longer exists.';
    return `${e.status}: ${e.message}`;
  }
  return e instanceof Error ? e.message : String(e);
}
