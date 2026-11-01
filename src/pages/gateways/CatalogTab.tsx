/**
 * The target catalog. Every filter and "load more" run on the server, so
 * a large Argo CD never reaches the browser whole.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import { type CatalogFilter, type CatalogItem, useGatewayCatalog } from '../../api/gateways';
import type { Project } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { TARGET_STATUS_LABEL, TARGET_STATUS_TONE, words } from '../../lib/gatewayStatus';
import { formatExact } from '../../lib/time';
import { useDebounced } from '../../lib/useDebounced';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { Field, Input, Select } from '../../ui/Field';
import { ToneStatus } from '../../ui/Status';
import { BindingDrawer } from '../admin/gateways/BindingDrawer';
import { TargetIdentity } from './TargetIdentity';

// The api's own patterns, for feedback before it answers 400.
const Q_RE = /^[a-z0-9.-]{1,63}$/;
const APP_PROJECT_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
const NAMESPACE_RE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

const LOOK_ALIKE_HINT = 'Another target on this Gateway has the same name in a different AppProject or namespace.';

function Flags({ item }: { item: CatalogItem }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      <ToneStatus tone={TARGET_STATUS_TONE[item.status] ?? 'neutral'}>{words(item.status, TARGET_STATUS_LABEL)}</ToneStatus>
      {item.is_new && <ToneStatus tone="neutral">New</ToneStatus>}
      {item.look_alike && (
        <span title={LOOK_ALIKE_HINT}>
          <ToneStatus tone="warn">Look-alike</ToneStatus>
        </span>
      )}
      {item.binding_count > 0 && <ToneStatus tone="ok">Bound</ToneStatus>}
    </span>
  );
}

interface Props {
  projects: Project[];
  projectsLoaded: boolean;
  projectId: string;
  onProject: (id: string) => void;
  connectorId: string;
  onClearConnector: () => void;
}

export function CatalogTab({ projects, projectsLoaded, projectId, onProject, connectorId, onClearConnector }: Props) {
  const { hasPermission } = useAuth();
  const canBind = hasPermission('gateway.bind');
  const [q, setQ] = useState('');
  const [appProject, setAppProject] = useState('');
  const [namespace, setNamespace] = useState('');
  const [status, setStatus] = useState('');
  const [binding, setBinding] = useState<CatalogItem | null>(null);

  const qErr = q && !Q_RE.test(q) ? 'Lowercase letters, digits, dots and hyphens only.' : undefined;
  const projectErr = appProject && !APP_PROJECT_RE.test(appProject) ? "That isn't an AppProject name." : undefined;
  const namespaceErr = namespace && !NAMESPACE_RE.test(namespace) ? "That isn't a namespace." : undefined;

  const typedQ = useDebounced(qErr ? '' : q);
  const typedProject = useDebounced(projectErr ? '' : appProject);
  const typedNamespace = useDebounced(namespaceErr ? '' : namespace);
  const filter: CatalogFilter = {
    project_id: projectId || undefined,
    connector_uuid: connectorId || undefined,
    q: typedQ || undefined,
    app_project: typedProject || undefined,
    namespace: typedNamespace || undefined,
    status: status || undefined,
  };
  const catalog = useGatewayCatalog(filter);
  const items = (catalog.data?.pages ?? []).flatMap((p) => p.items ?? []);
  const forbidden = catalog.error instanceof ApiError && catalog.error.status === 403;
  const narrowed = !!(filter.q || filter.app_project || filter.namespace || filter.status);

  const bindButton = (t: CatalogItem) =>
    canBind && projectId && t.status === 'present' ? (
      <Button variant="secondary" size="sm" onClick={() => setBinding(t)} aria-label={`Bind ${t.name ?? t.target_id}`}>
        Bind…
      </Button>
    ) : null;

  const columns: Column<CatalogItem>[] = [
    {
      key: 'target',
      header: 'Target',
      render: (t) => <TargetIdentity targetId={t.target_id} name={t.name} appProject={t.app_project} namespace={t.namespace} isStatic={t.source === 'static'} />,
    },
    { key: 'connector', header: 'Connector', render: (t) => <span className="font-mono text-mono-small whitespace-nowrap">{t.connector_id}</span> },
    { key: 'seen', header: 'First seen', render: (t) => formatExact(t.first_seen_at), className: 'whitespace-nowrap' },
    { key: 'flags', header: 'State', render: (t) => <Flags item={t} /> },
    {
      key: 'bind',
      header: 'Action',
      hiddenHeader: true,
      align: 'right',
      render: (t) => bindButton(t),
    },
  ];

  if (forbidden) {
    return (
      <EmptyState title="You can't view Argo CD targets.">
        This needs gateway.bind scoped to a team. A grant scoped to one project doesn't count. Ask an administrator.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Field id="ct-project" label="Project" className="max-lg:col-span-2">
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
        <Field id="ct-q" label="Name contains" error={qErr} className="max-lg:col-span-2">
          {(p) => <Input {...p} value={q} onChange={(e) => setQ(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field id="ct-app-project" label="AppProject" error={projectErr}>
          {(p) => <Input {...p} value={appProject} onChange={(e) => setAppProject(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field id="ct-namespace" label="Namespace" error={namespaceErr}>
          {(p) => <Input {...p} value={namespace} onChange={(e) => setNamespace(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field id="ct-status" label="State" className="max-lg:col-span-2">
          {(p) => (
            <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any</option>
              {Object.entries(TARGET_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {connectorId && (
        <p className="text-ui text-muted">
          Showing one connector.{' '}
          <button type="button" onClick={onClearConnector} className="text-accent hover:underline">
            Show every connector
          </button>
        </p>
      )}
      {canBind && projectsLoaded && projects.length === 0 && (
        <Banner tone="note" title="You can't see any projects to bind into.">
          Binding also needs secret.list or secret.request for your team, so the console can list its projects. Ask an administrator.
        </Banner>
      )}
      {canBind && !projectId && projects.length > 0 && <p className="text-ui text-muted">Choose a project to see what it can bind.</p>}

      {catalog.isError && !forbidden && (
        <Banner tone="error" title="Couldn't load the targets.">
          {catalog.error instanceof ApiError ? `${catalog.error.status}: ${catalog.error.message}` : 'Network error.'}
        </Banner>
      )}
      {catalog.isLoading && <p className="text-muted">Loading targets…</p>}
      {catalog.isSuccess && items.length === 0 && (
        <EmptyState title={narrowed || projectId ? 'No targets match.' : 'No targets yet.'}>
          {narrowed || projectId
            ? 'A project only lists targets whose AppProject maps to its team or a team above it.'
            : 'Targets appear here once a platform admin approves a Gateway connector and maps its AppProjects to teams.'}
        </EmptyState>
      )}
      {items.length > 0 && (
        <DataTable
          label="Argo CD targets"
          columns={columns}
          rows={items}
          rowKey={(t) => `${t.connector_uuid}/${t.target_id}`}
          minWidth={860}
          alignTop
          stacked={(t) => (
            <div className="flex flex-col gap-2">
              <TargetIdentity targetId={t.target_id} name={t.name} appProject={t.app_project} namespace={t.namespace} isStatic={t.source === 'static'} />
              <span className="text-caption text-muted">
                {t.connector_id} · first seen {formatExact(t.first_seen_at)}
              </span>
              <Flags item={t} />
              {bindButton(t) && <div>{bindButton(t)}</div>}
            </div>
          )}
        />
      )}
      {catalog.hasNextPage && (
        <div>
          <Button variant="secondary" onClick={() => void catalog.fetchNextPage()} disabled={catalog.isFetchingNextPage} aria-busy={catalog.isFetchingNextPage}>
            {catalog.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
      {binding && <BindingDrawer source={{ kind: 'catalog', item: binding, projectId }} onClose={() => setBinding(null)} />}
    </div>
  );
}
