/**
 * Provider connections admin page. Mirrors the Workflows / Policies
 * pattern (PageHeader + Card-wrapped table + shared Drawer +
 * ConfirmModal). Sidebar entry gated by `hasPermission('integration.edit')`.
 *
 * EPIC P §5 lock highlights:
 *  - List columns: Name | Type | Cluster | Status | Discover
 *  - Filters: search (substring on name, client-side) + type + status
 *  - Per-row click opens the edit drawer; overflow menu hosts `Discover now`
 *  - Delete confirm modal reads bindings_count + open_requests_count
 *    from the 409 envelope; "Delete anyway" disabled when counts > 0
 *  - Discover column derives "possibly stale" client-side:
 *      last_discover_status === 'running' &&
 *      last_discover_started_at + 2 * interval_seconds * 1000 < now
 */

import { useMemo, useState } from 'react';

import { ApiError } from '../../api/client';
import {
  extractProviderConnectionErrorCode,
  providerConnectionErrorMessage,
  useBindings,
  useCreateBinding,
  useCreateProviderConnection,
  useDeleteBinding,
  useDeleteProviderConnection,
  useProviderConnection,
  useProviderConnectionsAdmin,
  useUpdateProviderConnection,
} from '../../api/providerConnections';
import { useEnvironmentsForProject, useProjects } from '../../api/tenancy';
import type {
  ConnectionInUseBody,
  ProviderConnection,
  ProviderConnectionInput,
} from '../../api/types';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { Drawer } from '../../ui/Drawer';
import { PageHeader } from '../../ui/PageHeader';
import { StatusPill } from '../../ui/StatusPill';
import { ProviderConnectionForm } from './ProviderConnectionForm';

export function ProviderConnections() {
  const list = useProviderConnectionsAdmin();
  const create = useCreateProviderConnection();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<ProviderConnection | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ProviderConnection | null>(
    null,
  );

  const rows = useMemo(() => {
    const all = list.data ?? [];
    return all.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (typeFilter && c.type !== typeFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      return true;
    });
  }, [list.data, search, typeFilter, statusFilter]);

  const knownTypes = useMemo(() => {
    const s = new Set<string>();
    for (const c of list.data ?? []) s.add(c.type);
    return [...s].sort();
  }, [list.data]);

  return (
    <div>
      <PageHeader
        title="Provider connections"
        description="Connection metadata to external secret stores (Vault, AWS Secrets Manager, …). Credentials never live here — the agent uses its own workload identity."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            + New connection
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 w-56"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm"
        >
          <option value="">All types</option>
          {knownTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
        </select>
      </div>

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">
            Failed to load provider connections
          </div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && rows.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          {(list.data.length === 0 && 'No provider connections defined yet.') ||
            'No connections match the current filters.'}
        </Card>
      )}

      {rows.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Cluster</Th>
                <Th>Status</Th>
                <Th>Discover</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <ConnectionRow
                  key={c.id}
                  connection={c}
                  onEdit={() => {
                    setCreating(false);
                    setEditing(c);
                  }}
                  onDelete={() => setConfirmDelete(c)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating && (
        <Drawer title="New provider connection" onClose={() => setCreating(false)}>
          <ProviderConnectionForm
            submitting={create.isPending}
            submitError={create.error}
            onSubmit={async (body: ProviderConnectionInput) => {
              await create.mutateAsync(body);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </Drawer>
      )}

      {editing && (
        <EditDrawer connection={editing} onClose={() => setEditing(null)} />
      )}

      {confirmDelete && (
        <DeleteConfirmModal
          connection={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onDone={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// --- row -----------------------------------------------------------

function ConnectionRow({
  connection: c,
  onEdit,
  onDelete,
}: {
  connection: ProviderConnection;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top">
      <Td>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onEdit}
            className="font-mono text-accent hover:text-accent-bright text-sm text-left"
          >
            {c.name}
          </button>
        </div>
        {c.description && (
          <div className="text-muted text-xs mt-1 line-clamp-2">{c.description}</div>
        )}
      </Td>
      <Td className="text-muted font-mono text-xs">{c.type}</Td>
      <Td className="text-muted font-mono text-xs">{c.cluster_name ?? '—'}</Td>
      <Td>
        {c.status === 'active' ? (
          <StatusPill variant="success" tone="outline">
            active
          </StatusPill>
        ) : (
          <StatusPill variant="error" tone="outline">
            disabled
          </StatusPill>
        )}
      </Td>
      <Td>
        <DiscoverCell connection={c} />
      </Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onEdit}
            className="text-accent hover:text-accent-bright text-sm font-medium"
          >
            Edit
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

function DiscoverCell({ connection: c }: { connection: ProviderConnection }) {
  if (c.status === 'disabled') {
    return <span className="text-muted text-xs">Connection disabled</span>;
  }
  if (!c.discover_enabled) {
    return <span className="text-muted text-xs">Discovery off</span>;
  }
  const status = c.last_discover_status;
  // Possibly-stale derivation per §5: running for > 2× interval since
  // started_at without a transition.
  if (status === 'running' && c.last_discover_started_at) {
    const started = Date.parse(c.last_discover_started_at);
    const limitMs = 2 * (c.discover_interval_seconds ?? 0) * 1000;
    if (limitMs > 0 && started + limitMs < Date.now()) {
      return (
        <div className="flex flex-col">
          <StatusPill variant="warning" tone="outline">
            possibly stale
          </StatusPill>
          <span
            className="text-[10px] text-muted mt-0.5"
            title="The current discover job has been running longer than 2× the configured interval. The worker sweeper will reconcile it; the connection is safe to use."
          >
            running &gt; 2× interval
          </span>
        </div>
      );
    }
  }
  if (status === 'running') {
    return (
      <div className="flex flex-col">
        <StatusPill variant="pending" tone="outline">
          running
        </StatusPill>
        <span className="text-[10px] text-muted mt-0.5">
          {c.last_discover_started_at ? relativeAgo(c.last_discover_started_at) + ' elapsed' : ''}
        </span>
      </div>
    );
  }
  if (status === 'success') {
    return (
      <div className="flex flex-col">
        <StatusPill variant="success" tone="outline">
          success
        </StatusPill>
        {c.last_discover_at && (
          <span className="text-[10px] text-muted mt-0.5">
            {relativeAgo(c.last_discover_at)}
          </span>
        )}
      </div>
    );
  }
  if (status === 'failure') {
    return (
      <div className="flex flex-col">
        <StatusPill variant="error" tone="outline">
          failure
        </StatusPill>
        <span
          className="text-[10px] text-muted mt-0.5 truncate max-w-[14ch]"
          title={c.last_discover_error ?? ''}
        >
          {c.last_discover_at ? relativeAgo(c.last_discover_at) : 'recently'}
        </span>
      </div>
    );
  }
  return <span className="text-muted text-xs">—</span>;
}

// --- edit drawer (includes bindings sub-panel) ---------------------

function EditDrawer({
  connection,
  onClose,
}: {
  connection: ProviderConnection;
  onClose: () => void;
}) {
  // Re-fetch the single row so the drawer sees fresh discovery status.
  const fresh = useProviderConnection(connection.id);
  const view = fresh.data ?? connection;
  const update = useUpdateProviderConnection(connection.id);

  return (
    <Drawer title={`Edit ${view.name}`} onClose={onClose}>
      <div className="space-y-6">
        <ProviderConnectionForm
          initial={view}
          submitting={update.isPending}
          submitError={update.error}
          onSubmit={async (body) => {
            await update.mutateAsync(body);
            onClose();
          }}
          onCancel={onClose}
        />
        <BindingsPanel connectionID={connection.id} />
      </div>
    </Drawer>
  );
}

function BindingsPanel({ connectionID }: { connectionID: string }) {
  const bindings = useBindings(connectionID);
  const projects = useProjects();
  const create = useCreateBinding(connectionID);
  const del = useDeleteBinding(connectionID);

  const [projectID, setProjectID] = useState('');
  const [envID, setEnvID] = useState('');
  const envs = useEnvironmentsForProject(projectID || undefined);

  const [bindError, setBindError] = useState<string | null>(null);

  const onBind = async () => {
    setBindError(null);
    if (!projectID) return;
    try {
      await create.mutateAsync({
        project_id: projectID,
        environment_id: envID || null,
      });
      setProjectID('');
      setEnvID('');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? providerConnectionErrorMessage(
              extractProviderConnectionErrorCode(err),
            ) ?? `${err.status} · ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setBindError(msg);
    }
  };

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <h3 className="text-text font-semibold text-sm uppercase tracking-wider">
        Bindings
      </h3>
      <p className="text-muted text-xs">
        A connection becomes consumable by a developer dropdown when at
        least one binding covers their (project, environment). An empty
        <code className="text-muted/80 mx-1">environment</code> binds every
        environment in the project.
      </p>

      {bindings.isLoading && <div className="text-muted text-xs">Loading bindings…</div>}
      {bindings.data && bindings.data.length === 0 && (
        <div className="text-muted text-xs">No bindings yet.</div>
      )}
      {bindings.data && bindings.data.length > 0 && (
        <ul className="space-y-1">
          {bindings.data.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between text-xs border border-border/40 rounded-lg px-3 py-1.5"
            >
              <div>
                <span className="font-mono text-accent">
                  {b.project_name ?? b.project_id}
                </span>
                <span className="text-muted mx-1">/</span>
                <span className="font-mono text-text">
                  {b.environment_name ?? (b.environment_id ?? 'all envs')}
                </span>
              </div>
              <button
                onClick={() => void del.mutateAsync(b.id)}
                className="text-red-300 hover:text-red-200"
                disabled={del.isPending}
              >
                Unbind
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
            Project
          </label>
          <select
            value={projectID}
            onChange={(e) => {
              setProjectID(e.target.value);
              setEnvID('');
            }}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm"
          >
            <option value="">Pick a project…</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
            Environment
          </label>
          <select
            value={envID}
            onChange={(e) => setEnvID(e.target.value)}
            disabled={!projectID}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm disabled:opacity-50"
          >
            <option value="">All envs in project</option>
            {(envs.data ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.type})
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          size="md"
          type="button"
          onClick={() => void onBind()}
          disabled={!projectID || create.isPending}
        >
          {create.isPending ? 'Binding…' : '+ Bind'}
        </Button>
      </div>

      {bindError && (
        <div className="text-red-300 text-xs">{bindError}</div>
      )}
    </section>
  );
}

// --- delete confirm with 409 counts --------------------------------

function DeleteConfirmModal({
  connection,
  onCancel,
  onDone,
}: {
  connection: ProviderConnection;
  onCancel: () => void;
  onDone: () => void;
}) {
  const del = useDeleteProviderConnection();
  const [counts, setCounts] = useState<{ b: number; r: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const inUse = counts !== null && (counts.b > 0 || counts.r > 0);

  const tryDelete = async () => {
    setErr(null);
    try {
      await del.mutateAsync(connection.id);
      onDone();
    } catch (e) {
      if (e instanceof ApiError) {
        const code = extractProviderConnectionErrorCode(e);
        if (code === 'connection_in_use' && e.body && typeof e.body === 'object') {
          const body = e.body as ConnectionInUseBody;
          setCounts({
            b: body.bindings_count ?? 0,
            r: body.open_requests_count ?? 0,
          });
          setErr(providerConnectionErrorMessage(code) ?? e.message);
          return;
        }
        setErr(
          providerConnectionErrorMessage(extractProviderConnectionErrorCode(e)) ??
            `${e.status} · ${e.message}`,
        );
      } else if (e instanceof Error) {
        setErr(e.message);
      } else {
        setErr(String(e));
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg/80 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-xl p-6 max-w-md w-full space-y-4">
        <h3 className="text-text text-lg font-bold">
          Delete provider connection &ldquo;{connection.name}&rdquo;?
        </h3>
        <p className="text-muted text-sm">
          This cannot be undone. Existing bindings + open requests block the
          delete; the api refuses with a count.
        </p>
        {counts && (
          <div className="text-xs text-yellow-200 bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2">
            In use: <span className="font-mono">{counts.b}</span> binding{counts.b === 1 ? '' : 's'},
            {' '}
            <span className="font-mono">{counts.r}</span> open request{counts.r === 1 ? '' : 's'}.
            Unbind / close them first.
          </div>
        )}
        {err && !counts && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => void tryDelete()}
            disabled={del.isPending || inUse}
            title={inUse ? 'Counts must be zero before delete.' : undefined}
          >
            {del.isPending ? 'Deleting…' : 'Delete anyway'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- bits ----------------------------------------------------------

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

function relativeAgo(iso: string): string {
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return '';
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
