/**
 * EPIC Q (api#99) Slice Q3 — per-env Provider Connections card.
 *
 * Lives on /projects/:id/env/:env_id (mounted from ProjectEnv).
 * Renders the bindings effective for THIS env (env-specific +
 * project-wide inherited, badged) and a + Bind CTA gated by the
 * `canBindProviderConnectionOnEnv` capability helper.
 *
 * Locked §5 decisions implemented here:
 *
 *   Q13 — Project-wide bindings rendered with [project-wide] badge,
 *         Unbind DISABLED with tooltip ("Project-wide bindings are
 *         managed by the platform team")
 *   Q14 — Empty-state CTA copy split:
 *           pure integration.bind → "Ask your platform team..."
 *           integration.edit + integration.bind → above + Manage link
 *   Q15 — Capability helper drives endpoint selection (NOT generic
 *         hasPermission override). Admin → admin URLs; scoped → project-
 *         anchored URLs.
 *
 * Prod-env behavior matches §3:
 *   - integration.bind only → CTA hidden, "managed by platform" message
 *   - integration.edit → CTA enabled, hits admin endpoint
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  useBindToProject,
  useBindableConnections,
  useProjectBindings,
  useUnbindFromProject,
} from '../api/projectProviderConnectionBindings';
import {
  extractProviderConnectionErrorCode,
  providerConnectionErrorMessage,
  useDeleteBinding as useAdminUnbind,
  useCreateBinding as useAdminBind,
} from '../api/providerConnections';
import type {
  MyEnvironment,
  MyProject,
  ProjectProviderConnectionBinding,
} from '../api/types';
import {
  canBindProviderConnectionOnEnv,
  canUnbindBinding,
} from '../auth/capabilities';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { StatusPill } from '../ui/StatusPill';

interface Props {
  project: MyProject;
  env: MyEnvironment;
}

export function ProviderConnectionsCard({ project, env }: Props) {
  const { identity } = useAuth();
  const perms = identity?.permissions ?? [];
  const capability = canBindProviderConnectionOnEnv(perms, env);
  const bindings = useProjectBindings(project.id, env.id);
  const [pickerOpen, setPickerOpen] = useState(false);

  const rows = bindings.data ?? [];
  const showCTA = capability.allowed;

  // Sort: env-specific first, then project-wide inherited.
  const sorted = [...rows].sort((a, b) => {
    if (a.environment_id === null && b.environment_id !== null) return 1;
    if (a.environment_id !== null && b.environment_id === null) return -1;
    return (a.connection_name ?? '').localeCompare(b.connection_name ?? '');
  });

  return (
    <Card>
      <CardHeader>
        <h3 className="text-text font-semibold">Provider connections</h3>
        <div className="flex items-center gap-2">
          <span className="text-muted text-xs">
            {rows.length} {rows.length === 1 ? 'binding' : 'bindings'}
          </span>
          {showCTA && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              + Bind
            </Button>
          )}
        </div>
      </CardHeader>
      <CardBody className="space-y-2">
        {bindings.isLoading && (
          <p className="text-muted text-sm">Loading bindings…</p>
        )}
        {!bindings.isLoading && rows.length === 0 && (
          <EmptyState capability={capability} env={env} perms={perms} />
        )}
        {sorted.map((b) => (
          <BindingRow
            key={b.id}
            binding={b}
            projectID={project.id}
            envID={env.id}
          />
        ))}
        {env.kind === 'prod' && capability.via !== 'integration.edit' && (
          <p className="text-muted text-xs pt-1 italic">
            Production provider bindings are managed by the platform team.
          </p>
        )}
      </CardBody>

      {pickerOpen && (
        <BinderPickerDrawer
          project={project}
          env={env}
          capability={capability}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </Card>
  );
}

// --- rows ----------------------------------------------------------

function BindingRow({
  binding: b,
  projectID,
  envID,
}: {
  binding: ProjectProviderConnectionBinding;
  projectID: string;
  envID: string;
}) {
  const { identity } = useAuth();
  const perms = identity?.permissions ?? [];
  const unbindCap = canUnbindBinding(perms, b);
  const scopedUnbind = useUnbindFromProject(projectID);
  const adminUnbind = useAdminUnbind(b.provider_connection_id);
  const isProjectWide = b.environment_id === null;
  const isThisEnv = b.environment_id === envID;
  const [err, setErr] = useState<string | null>(null);

  const busy = scopedUnbind.isPending || adminUnbind.isPending;

  const onUnbind = async () => {
    setErr(null);
    try {
      if (unbindCap.via === 'integration.edit') {
        await adminUnbind.mutateAsync(b.id);
      } else if (unbindCap.via === 'integration.bind') {
        await scopedUnbind.mutateAsync({ bindingID: b.id, envID });
      }
    } catch (e) {
      setErr(stringifyApiErr(e));
    }
  };

  let unbindLabel = 'Unbind';
  let unbindTitle: string | undefined;
  let unbindDisabled = busy;
  if (!unbindCap.allowed) {
    unbindDisabled = true;
    unbindTitle = isProjectWide
      ? 'Project-wide bindings are managed by the platform team.'
      : unbindCap.reason === 'prod_managed_by_platform'
        ? 'Production provider bindings are managed by the platform team.'
        : undefined;
  }

  return (
    <div className="bg-bg/40 border border-border/60 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-text text-sm">
            {b.connection_name ?? b.provider_connection_id.slice(0, 8)}
          </span>
          <span className="text-muted text-xs">
            {b.connection_type ?? '—'}
          </span>
          {isProjectWide && (
            <StatusPill variant="neutral" tone="outline">
              project-wide
            </StatusPill>
          )}
          {!isProjectWide && !isThisEnv && (
            // Defensive — the api filters to this env + project-wide
            // so this should never render; if it does we surface the
            // env name so operators can spot the bug.
            <StatusPill variant="warning" tone="outline">
              {b.environment_name ?? 'other env'}
            </StatusPill>
          )}
          {b.environment_kind && b.environment_kind !== 'non_prod' && (
            <StatusPill variant="error" tone="outline">
              {b.environment_kind}
            </StatusPill>
          )}
        </div>
        {err && (
          <div className="text-red-300 text-xs mt-1">{err}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {unbindCap.allowed || !!unbindTitle ? (
          <button
            onClick={() => void onUnbind()}
            disabled={unbindDisabled}
            title={unbindTitle}
            className={
              unbindDisabled
                ? 'text-muted/50 cursor-not-allowed text-xs'
                : 'text-red-300 hover:text-red-200 text-xs'
            }
          >
            {busy ? 'Unbinding…' : unbindLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// --- empty state --------------------------------------------------

function EmptyState({
  capability,
  env,
  perms,
}: {
  capability: ReturnType<typeof canBindProviderConnectionOnEnv>;
  env: MyEnvironment;
  perms: readonly string[];
}) {
  if (capability.allowed) {
    return (
      <p className="text-muted text-sm">
        No provider connections bound to this environment yet. Click
        <span className="text-text mx-1">+ Bind</span>
        to add one.
      </p>
    );
  }
  if (env.kind === 'prod' && !perms.includes('integration.edit')) {
    return (
      <p className="text-muted text-sm">
        Production provider bindings are managed by the platform team.
      </p>
    );
  }
  if (perms.includes('integration.bind')) {
    return (
      <p className="text-muted text-sm">
        No provider connections bound to this environment yet. Ask your
        platform team to enable one for self-service binding.
      </p>
    );
  }
  return (
    <p className="text-muted text-sm">
      No provider connections bound to this environment yet.
    </p>
  );
}

// --- picker drawer ------------------------------------------------

function BinderPickerDrawer({
  project,
  env,
  capability,
  onClose,
}: {
  project: MyProject;
  env: MyEnvironment;
  capability: ReturnType<typeof canBindProviderConnectionOnEnv>;
  onClose: () => void;
}) {
  const { identity } = useAuth();
  const perms = identity?.permissions ?? [];
  const bindable = useBindableConnections(project.id, env.id, {
    enabled: capability.allowed,
  });
  const scopedBind = useBindToProject(project.id);

  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  // The admin path's URL is keyed by the connection_id picked in the
  // drawer. Re-instantiating useCreateBinding per render is fine —
  // TanStack key isolates each call's cache slot. A placeholder
  // connection id keeps the URL well-formed before a selection lands;
  // the mutation never fires until the operator clicks Bind.
  const adminBind = useAdminBind(selected || '__pending__');

  const onSubmit = async () => {
    setError(null);
    if (!selected) return;
    try {
      if (capability.via === 'integration.edit') {
        await adminBind.mutateAsync({
          project_id: project.id,
          environment_id: env.id,
        });
      } else {
        await scopedBind.mutateAsync({
          provider_connection_id: selected,
          environment_id: env.id,
        });
      }
      onClose();
    } catch (e) {
      setError(stringifyApiErr(e));
    }
  };

  const rows = bindable.data ?? [];
  const busy = scopedBind.isPending || adminBind.isPending;

  return (
    <div className="fixed inset-0 z-40 flex">
      <button
        className="flex-1 bg-bg/80 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <aside className="w-[560px] max-w-full h-full bg-surface border-l border-border overflow-y-auto p-6 space-y-5">
        <div>
          <h2 className="text-text text-xl font-bold tracking-tight">
            Bind a provider connection
          </h2>
          <p className="text-muted text-sm mt-1">
            Pick a connection to bind to{' '}
            <span className="text-text">{project.name}</span> ·{' '}
            <span className="text-text">{env.name}</span>{' '}
            <span className="text-muted text-xs">({env.kind})</span>.
          </p>
        </div>

        {bindable.isLoading && (
          <p className="text-muted text-sm">Loading bindable connections…</p>
        )}

        {bindable.isError && (
          <p className="text-red-300 text-sm">
            {bindable.error instanceof ApiError
              ? (providerConnectionErrorMessage(
                  extractProviderConnectionErrorCode(bindable.error),
                ) ?? `${bindable.error.status} · ${bindable.error.message}`)
              : 'Failed to load.'}
          </p>
        )}

        {!bindable.isLoading && rows.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-bg/40 px-3 py-3 text-sm text-muted space-y-1">
            <div className="text-text font-medium">
              No provider connections available for self-service binding.
            </div>
            {perms.includes('integration.edit') ? (
              <div>
                <Link
                  to="/admin/provider-connections"
                  className="text-accent hover:text-accent-bright underline"
                >
                  Manage at /admin/provider-connections
                </Link>
              </div>
            ) : (
              <div>
                Ask your platform team to enable one for self-service binding.
              </div>
            )}
          </div>
        )}

        {rows.length > 0 && (
          <div className="space-y-1.5">
            {rows.map((r) => (
              <label
                key={r.id}
                className={
                  'flex items-center gap-3 border rounded-lg px-3 py-2 cursor-pointer ' +
                  (selected === r.id
                    ? 'border-accent bg-accent/10'
                    : 'border-border hover:border-border/80')
                }
              >
                <input
                  type="radio"
                  name="bindable-pick"
                  value={r.id}
                  checked={selected === r.id}
                  onChange={() => setSelected(r.id)}
                />
                <div className="min-w-0">
                  <div className="font-mono text-text text-sm">{r.name}</div>
                  <div className="text-muted text-xs">{r.type}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => void onSubmit()}
            disabled={!selected || busy || rows.length === 0}
          >
            {busy ? 'Binding…' : 'Bind to this environment'}
          </Button>
        </div>
      </aside>
    </div>
  );
}

// --- helpers -------------------------------------------------------

function stringifyApiErr(err: unknown): string {
  if (err instanceof ApiError) {
    const code = extractProviderConnectionErrorCode(err);
    return (
      providerConnectionErrorMessage(code) ??
      `${err.status} · ${err.message}`
    );
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
