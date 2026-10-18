/**
 * Provider connections admin page (`/admin/provider-connections`,
 * integration.edit in the sidebar).
 *
 * EPIC P §5 highlights, kept:
 *  - Columns: name, provider, cluster, status, discovery.
 *  - Filters: name search (client-side), provider and status.
 *  - The row (or its name) opens the edit drawer, which also holds
 *    "Run discovery now" and the project bindings.
 *  - Delete reads bindings_count and open_requests_count from the 409
 *    envelope and keeps Delete disabled while either is above zero.
 *  - Discovery shows "possibly stale" when a run is still marked running
 *    after twice the interval (see DiscoveryStatus).
 *
 * Agents: holders of agent.list see how many agents serve each
 * connection, linked to `/agents?connection=<id>`; holders of
 * agent.mint can enroll one from the row.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAdminAgents } from '../../api/agents';
import { ApiError } from '../../api/client';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import type { ProviderConnection } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { providerLabel } from '../../lib/providers';
import { useNow } from '../../lib/useNow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { DataTable, type Column } from '../../ui/DataTable';
import { EmptyState } from '../../ui/EmptyState';
import { Input, Select } from '../../ui/Field';
import { PageHeader } from '../../ui/PageHeader';
import { ToneStatus } from '../../ui/Status';
import { EnrollAgentDrawer } from '../agents/EnrollAgentDrawer';
import { CreateConnectionDrawer, EditConnectionDrawer } from './connections/ConnectionDrawers';
import { DeleteConnectionDialog } from './connections/DeleteConnectionDialog';
import { DiscoveryStatus } from './connections/DiscoveryStatus';

export function ProviderConnections() {
  const { hasPermission } = useAuth();
  const list = useProviderConnectionsAdmin();
  const canListAgents = hasPermission('agent.list');
  const canEnroll = hasPermission('agent.mint');
  const agents = useAdminAgents({ enabled: canListAgents });
  const now = useNow(30_000);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProviderConnection | null>(null);
  const [enrollFor, setEnrollFor] = useState<string | null>(null);

  const all = useMemo(() => list.data ?? [], [list.data]);
  const rows = useMemo(
    () =>
      all
        .filter((c) => {
          if (search && !c.name.toLowerCase().includes(search.trim().toLowerCase())) return false;
          if (typeFilter && c.type !== typeFilter) return false;
          if (statusFilter && c.status !== statusFilter) return false;
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [all, search, typeFilter, statusFilter],
  );
  const knownTypes = useMemo(() => [...new Set(all.map((c) => c.type))].sort(), [all]);
  const editing = all.find((c) => c.id === editingId) ?? null;

  // Agents per connection, revoked ones left out.
  const agentCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of agents.data ?? []) {
      if (!a.provider_connection_id || a.status === 'revoked') continue;
      m.set(a.provider_connection_id, (m.get(a.provider_connection_id) ?? 0) + 1);
    }
    return m;
  }, [agents.data]);

  const active = all.filter((c) => c.status === 'active').length;
  const failing = all.filter((c) => c.status === 'active' && c.discover_enabled && c.last_discover_status === 'failure').length;
  const facts = [
    `${all.length} ${all.length === 1 ? 'connection' : 'connections'}`,
    `${active} active`,
    failing ? `${failing} with failed discovery` : '',
  ].filter(Boolean);
  const filtered = !!search || !!typeFilter || !!statusFilter;

  const agentsCell = (c: ProviderConnection) => {
    const n = agentCount.get(c.id) ?? 0;
    return (
      <Link to={`/agents?connection=${c.id}`} className="whitespace-nowrap font-medium text-accent hover:underline" aria-label={`Agents for ${c.name}`}>
        {agents.isLoading ? 'Agents' : n === 0 ? 'No agents' : `${n} ${n === 1 ? 'agent' : 'agents'}`}
      </Link>
    );
  };
  const actions = (c: ProviderConnection) => (
    <span className="inline-flex gap-2">
      {canEnroll && c.status === 'active' && (
        <Button variant="secondary" size="sm" onClick={() => setEnrollFor(c.id)} aria-label={`Enroll an agent for ${c.name}`}>
          Enroll an agent
        </Button>
      )}
      <Button variant="danger" size="sm" onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}…`}>
        Delete…
      </Button>
    </span>
  );

  const columns: Column<ProviderConnection>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <span className="block max-w-[280px]">
          <button type="button" onClick={() => setEditingId(c.id)} className="text-left font-medium text-accent hover:underline">
            {c.name}
          </button>
          {c.description && <span className="block truncate text-caption text-muted" title={c.description}>{c.description}</span>}
        </span>
      ),
    },
    { key: 'type', header: 'Provider', render: (c) => providerLabel(c.type), className: 'whitespace-nowrap' },
    {
      key: 'cluster',
      header: 'Cluster',
      render: (c) => (c.cluster_name ? <span className="font-mono text-mono">{c.cluster_name}</span> : <span className="text-muted">—</span>),
    },
    {
      key: 'status',
      header: 'Status',
      render: (c) => <ToneStatus tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status === 'active' ? 'Active' : 'Disabled'}</ToneStatus>,
    },
    { key: 'discovery', header: 'Discovery', render: (c) => <DiscoveryStatus connection={c} now={now} /> },
  ];
  if (canListAgents) columns.push({ key: 'agents', header: 'Agents', render: agentsCell });
  columns.push({ key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', className: 'whitespace-nowrap', render: actions });

  return (
    <div>
      <PageHeader
        title="Provider connections"
        description={
          list.data
            ? `${facts.join(' · ')}. Connection details only; agents sign in with their own identity.`
            : 'Where agents find the secrets. Connection details only; agents sign in with their own identity.'
        }
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Add connection
          </Button>
        }
      />

      {all.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="min-w-[220px] max-[600px]:w-full">
            <span className="sr-only">Search by name</span>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" className="w-full" />
          </label>
          <label className="min-w-[180px] max-[600px]:w-full">
            <span className="sr-only">Provider</span>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full">
              <option value="">All providers</option>
              {knownTypes.map((t) => (
                <option key={t} value={t}>
                  {providerLabel(t)}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-[150px] max-[600px]:w-full">
            <span className="sr-only">Status</span>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full">
              <option value="">Any status</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
            </Select>
          </label>
          {filtered && (
            <>
              <Button
                variant="quiet"
                onClick={() => {
                  setSearch('');
                  setTypeFilter('');
                  setStatusFilter('');
                }}
              >
                Reset filters
              </Button>
              <span className="text-ui font-normal text-muted" aria-live="polite">
                Showing {rows.length} of {all.length}
              </span>
            </>
          )}
        </div>
      )}

      {list.isLoading && <p className="text-muted">Loading provider connections…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the provider connections."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : 'Network error.'}
        </Banner>
      )}
      {list.data &&
        (all.length === 0 ? (
          <EmptyState
            title="No provider connections yet."
            action={
              <Button variant="secondary" onClick={() => setCreating(true)}>
                Add connection
              </Button>
            }
          >
            A connection tells agents which Vault, AWS Secrets Manager or other store to use. Add one, bind it to projects, then
            enroll an agent for it.
          </EmptyState>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">No connection matches these filters.</p>
        ) : (
          <DataTable
            label="Provider connections"
            columns={columns}
            rows={rows}
            rowKey={(c) => c.id}
            onRowClick={(c) => setEditingId(c.id)}
            minWidth={canListAgents ? 960 : 860}
            stacked={(c) => (
              <div className="flex flex-col gap-1.5">
                <p className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setEditingId(c.id)} className="text-left font-medium text-accent hover:underline">
                    {c.name}
                  </button>
                  <ToneStatus tone={c.status === 'active' ? 'ok' : 'neutral'}>{c.status === 'active' ? 'Active' : 'Disabled'}</ToneStatus>
                </p>
                <p className="text-caption text-muted">
                  {providerLabel(c.type)}
                  {c.cluster_name ? ` · ${c.cluster_name}` : ''}
                </p>
                <div className="text-caption">
                  <span className="text-muted">Discovery: </span>
                  <span className="inline-block align-top">
                    <DiscoveryStatus connection={c} now={now} />
                  </span>
                </div>
                {canListAgents && <p className="text-caption">{agentsCell(c)}</p>}
                <div className="mt-1">{actions(c)}</div>
              </div>
            )}
          />
        ))}

      {creating && <CreateConnectionDrawer onClose={() => setCreating(false)} />}
      {editing && <EditConnectionDrawer connection={editing} onClose={() => setEditingId(null)} />}
      {deleting && <DeleteConnectionDialog connection={deleting} onClose={() => setDeleting(null)} />}
      {enrollFor && <EnrollAgentDrawer initialConnectionId={enrollFor} onClose={() => setEnrollFor(null)} />}
    </div>
  );
}
