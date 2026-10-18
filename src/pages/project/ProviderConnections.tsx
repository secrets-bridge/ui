/**
 * Provider connections on an environment page (EPIC Q, api#99): the
 * connections whose agents serve this environment, both the ones bound
 * to it and the project-wide ones it inherits.
 *
 * Who can change them (`src/auth/capabilities.ts`):
 *   - integration.edit: bind and unbind anywhere, through the admin
 *     endpoints.
 *   - integration.bind: bind and unbind on non-production environments,
 *     through the project endpoints, and only connections enabled for
 *     self-service.
 *   - Project-wide and production bindings are managed by the platform
 *     team; scoped binders see why the action is missing.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
import {
  useBindToProject,
  useBindableConnections,
  useProjectBindings,
  useUnbindFromProject,
} from '../../api/projectProviderConnectionBindings';
import {
  extractProviderConnectionErrorCode,
  providerConnectionErrorMessage,
  useDeleteBinding as useAdminUnbind,
  useCreateBinding as useAdminBind,
} from '../../api/providerConnections';
import type { MyEnvironment, MyProject, ProjectProviderConnectionBinding } from '../../api/types';
import { canBindProviderConnectionOnEnv, canUnbindBinding } from '../../auth/capabilities';
import { useAuth } from '../../auth/AuthContext';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EnvTag } from '../../ui/EnvTag';
import { useToast } from '../../ui/toastContext';

interface Props {
  project: MyProject;
  env: MyEnvironment;
}

export function ProviderConnections({ project, env }: Props) {
  const { identity } = useAuth();
  const perms = identity?.permissions ?? [];
  const capability = canBindProviderConnectionOnEnv(perms, env);
  const bindings = useProjectBindings(project.id, env.id);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [unbinding, setUnbinding] = useState<ProjectProviderConnectionBinding | null>(null);

  // Bound to this environment first, then the inherited project-wide ones.
  const rows = [...(bindings.data ?? [])].sort((a, b) => {
    if ((a.environment_id === null) !== (b.environment_id === null)) return a.environment_id === null ? 1 : -1;
    return (a.connection_name ?? '').localeCompare(b.connection_name ?? '');
  });
  const anyUnbindable = rows.some((b) => canUnbindBinding(perms, b).allowed);

  const columns: Column<ProjectProviderConnectionBinding>[] = [
    {
      key: 'name',
      header: 'Connection',
      render: (b) => <span className="font-medium text-ink">{b.connection_name ?? b.provider_connection_id.slice(0, 8)}</span>,
    },
    { key: 'type', header: 'Provider', render: (b) => providerLabel(b.connection_type) },
    {
      key: 'scope',
      header: 'Applies to',
      render: (b) =>
        b.environment_id === null ? (
          <span className="text-muted">Whole project</span>
        ) : b.environment_id === env.id ? (
          'This environment'
        ) : (
          // The api filters to this environment and project-wide rows; name
          // any other environment so the mismatch is visible.
          <EnvTag kind={b.environment_kind}>{b.environment_name ?? 'another environment'}</EnvTag>
        ),
    },
  ];
  if (anyUnbindable) {
    columns.push({
      key: 'actions',
      header: 'Actions',
      hiddenHeader: true,
      align: 'right',
      render: (b) =>
        canUnbindBinding(perms, b).allowed ? (
          <Button variant="secondary" size="sm" onClick={() => setUnbinding(b)}>
            Unbind…
          </Button>
        ) : (
          <span className="text-caption text-muted">Managed by the platform team</span>
        ),
    });
  }

  return (
    <section aria-labelledby="pc-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="pc-heading" className="text-block-heading text-ink">
            Provider connections
            <span className="ml-2 font-mono text-mono-small font-normal text-muted">{rows.length}</span>
          </h2>
          <p className="mt-0.5 text-caption text-muted">The agents behind these connections run the approved reads and changes.</p>
        </div>
        {capability.allowed && (
          <Button variant="secondary" onClick={() => setPickerOpen(true)}>
            Bind a connection
          </Button>
        )}
      </div>

      {bindings.isLoading && <p className="text-muted">Loading connections…</p>}
      {bindings.isError && (
        <Banner tone="error" title="Couldn't load the provider connections.">
          {errorText(bindings.error)}
        </Banner>
      )}
      {bindings.data &&
        (rows.length > 0 ? (
          <DataTable
            label="Provider connections"
            columns={columns}
            rows={rows}
            rowKey={(b) => b.id}
            minWidth={520}
            stacked={(b) => (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-ink">{b.connection_name ?? b.provider_connection_id.slice(0, 8)}</p>
                <p className="text-caption text-muted">
                  {providerLabel(b.connection_type)} · {b.environment_id === null ? 'Whole project' : b.environment_id === env.id ? 'This environment' : (b.environment_name ?? 'another environment')}
                </p>
                {anyUnbindable && <div className="mt-1">{columns[columns.length - 1].render(b)}</div>}
              </div>
            )}
          />
        ) : (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">
            {emptyText(capability, env, perms)}
          </p>
        ))}
      {rows.length > 0 && env.kind === 'prod' && capability.via !== 'integration.edit' && (
        <p className="mt-2 text-caption text-muted">Production connections are managed by the platform team.</p>
      )}

      {pickerOpen && <BindDrawer project={project} env={env} capability={capability} onClose={() => setPickerOpen(false)} />}
      {unbinding && <UnbindConfirm binding={unbinding} project={project} env={env} onClose={() => setUnbinding(null)} />}
    </section>
  );
}

function emptyText(capability: ReturnType<typeof canBindProviderConnectionOnEnv>, env: MyEnvironment, perms: readonly string[]): string {
  if (capability.allowed) return 'No provider connection serves this environment yet. Bind one so approved requests can run.';
  if (env.kind === 'prod' && !perms.includes('integration.edit')) return 'Production connections are managed by the platform team.';
  if (perms.includes('integration.bind')) {
    return 'No provider connection serves this environment yet. Ask the platform team to enable one for self-service binding.';
  }
  return 'No provider connection serves this environment yet.';
}

function UnbindConfirm({
  binding,
  project,
  env,
  onClose,
}: {
  binding: ProjectProviderConnectionBinding;
  project: MyProject;
  env: MyEnvironment;
  onClose: () => void;
}) {
  const { identity } = useAuth();
  const toast = useToast();
  const via = canUnbindBinding(identity?.permissions ?? [], binding).via;
  const scoped = useUnbindFromProject(project.id);
  const admin = useAdminUnbind(binding.provider_connection_id);
  const m = via === 'integration.edit' ? admin : scoped;
  const name = binding.connection_name ?? 'this connection';
  const where = binding.environment_id === null ? `the whole ${project.name} project` : `${project.name} · ${env.name}`;

  return (
    <ConfirmModal
      title={`Unbind ${name}?`}
      body={`Approved requests in ${where} will no longer run through this connection's agent. Requests already running are not stopped.`}
      confirmText="Unbind"
      danger
      loading={m.isPending}
      error={m.error ?? undefined}
      onCancel={onClose}
      onConfirm={async () => {
        try {
          if (via === 'integration.edit') await admin.mutateAsync(binding.id);
          else await scoped.mutateAsync({ bindingID: binding.id, envID: env.id });
          toast(`Unbound ${name}.`);
          onClose();
        } catch {
          // Shown in the dialog.
        }
      }}
    />
  );
}

function BindDrawer({
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
  const toast = useToast();
  const perms = identity?.permissions ?? [];
  const bindable = useBindableConnections(project.id, env.id, { enabled: capability.allowed });
  const scopedBind = useBindToProject(project.id);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  // The admin endpoint is keyed by the chosen connection. The placeholder
  // keeps the hook's URL well formed until one is picked; it never fires
  // before then.
  const adminBind = useAdminBind(selected || '__pending__');

  const rows = bindable.data ?? [];
  const busy = scopedBind.isPending || adminBind.isPending;
  const chosen = rows.find((r) => r.id === selected);

  const submit = async () => {
    setTried(true);
    setError(null);
    if (!chosen) {
      document.getElementById('bind-choices')?.focus();
      return;
    }
    try {
      if (capability.via === 'integration.edit') {
        await adminBind.mutateAsync({ project_id: project.id, environment_id: env.id });
      } else {
        await scopedBind.mutateAsync({ provider_connection_id: chosen.id, environment_id: env.id });
      }
      toast(`Bound ${chosen.name} to ${env.name}.`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Drawer
      title="Bind a provider connection"
      subtitle={
        <>
          {project.name} <EnvTag kind={env.kind}>{env.name}</EnvTag>
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={busy || rows.length === 0} aria-busy={busy}>
            {busy ? 'Binding…' : 'Bind to this environment'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {bindable.isLoading && <p className="text-muted">Loading connections…</p>}
        {bindable.isError && (
          <Banner tone="error" title="Couldn't load the connections.">
            {errorText(bindable.error)}
          </Banner>
        )}
        {bindable.data && rows.length === 0 && (
          <Banner title="No connection is open for self-service binding.">
            {perms.includes('integration.edit') ? (
              <>
                Enable one, or bind it from{' '}
                <Link to="/admin/provider-connections" className="font-medium text-accent hover:underline">
                  Provider connections
                </Link>
                .
              </>
            ) : (
              'Ask the platform team to enable one for self-service binding.'
            )}
          </Banner>
        )}
        {rows.length > 0 && (
          <fieldset
            id="bind-choices"
            tabIndex={-1}
            className="flex flex-col gap-1.5"
            aria-describedby={tried && !chosen ? 'bind-choices-error' : undefined}
          >
            <legend className="mb-1.5 text-body font-semibold text-ink">Connection</legend>
            {rows.map((r, i) => (
              <label
                key={r.id}
                className={
                  'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 max-md:min-h-(--control-touch) ' +
                  (selected === r.id ? 'border-accent bg-accent-soft' : 'border-border hover:bg-sunken')
                }
              >
                <input
                  type="radio"
                  name="bind-pick"
                  value={r.id}
                  checked={selected === r.id}
                  onChange={() => setSelected(r.id)}
                  className="accent-accent"
                  data-autofocus={i === 0 ? true : undefined}
                />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{r.name}</span>
                  <span className="block text-caption text-muted">{providerLabel(r.type)}</span>
                </span>
              </label>
            ))}
            {tried && !chosen && (
              <p id="bind-choices-error" className="text-caption font-medium text-bad">
                Choose a connection.
              </p>
            )}
          </fieldset>
        )}
        {error && (
          <Banner tone="error" title="Not bound.">
            {error}
          </Banner>
        )}
      </div>
    </Drawer>
  );
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    return providerConnectionErrorMessage(extractProviderConnectionErrorCode(err)) ?? `${err.status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
