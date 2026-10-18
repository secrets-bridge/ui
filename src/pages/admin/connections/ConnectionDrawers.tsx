/**
 * Drawers for one provider connection: add, and edit (with "Run
 * discovery now" and the project bindings below the form).
 *
 * A connection is offered in a developer's dropdown when at least one
 * binding covers their project and environment; a binding without an
 * environment covers every environment in the project.
 */

import { useId, useState } from 'react';

import { ApiError } from '../../../api/client';
import {
  extractProviderConnectionErrorCode,
  providerConnectionErrorMessage,
  useBindings,
  useCreateBinding,
  useCreateProviderConnection,
  useDeleteBinding,
  useDiscoverNow,
  useProviderConnection,
  useUpdateProviderConnection,
} from '../../../api/providerConnections';
import { useEnvironmentsForProject, useProjects } from '../../../api/tenancy';
import type { ProviderConnection, ProviderConnectionBinding, ProviderConnectionInput } from '../../../api/types';
import { providerLabel } from '../../../lib/providers';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { ConfirmModal } from '../../../ui/ConfirmModal';
import { Drawer } from '../../../ui/Drawer';
import { EnvTag } from '../../../ui/EnvTag';
import { Field, Select } from '../../../ui/Field';
import { useToast } from '../../../ui/toastContext';
import { ProviderConnectionForm } from '../ProviderConnectionForm';

function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    return providerConnectionErrorMessage(extractProviderConnectionErrorCode(err)) ?? `${err.status}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export function CreateConnectionDrawer({ onClose }: { onClose: () => void }) {
  const create = useCreateProviderConnection();
  const toast = useToast();
  const formId = useId();
  return (
    <Drawer
      title="Add a provider connection"
      subtitle="Where an agent finds the secrets. Connection details only, never credentials."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={create.isPending} aria-busy={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add connection'}
          </Button>
        </>
      }
    >
      <ProviderConnectionForm
        formId={formId}
        submitError={create.error}
        onSubmit={async (body: ProviderConnectionInput) => {
          await create.mutateAsync(body);
          toast(`Added ${body.name}.`);
          onClose();
        }}
      />
    </Drawer>
  );
}

export function EditConnectionDrawer({ connection, onClose }: { connection: ProviderConnection; onClose: () => void }) {
  // Re-fetch the single row so the drawer sees fresh discovery status.
  const fresh = useProviderConnection(connection.id);
  const view = fresh.data ?? connection;
  const update = useUpdateProviderConnection(connection.id);
  const toast = useToast();
  const formId = useId();

  return (
    <Drawer
      title={view.name}
      subtitle={`${providerLabel(view.type)} connection`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" disabled={update.isPending} aria-busy={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <ProviderConnectionForm
          formId={formId}
          initial={view}
          submitError={update.error}
          onSubmit={async (body) => {
            await update.mutateAsync(body);
            toast(`Saved ${body.name}.`);
            onClose();
          }}
        />
        <DiscoverNow connection={view} />
        <BindingsPanel connectionID={connection.id} />
      </div>
    </Drawer>
  );
}

function DiscoverNow({ connection }: { connection: ProviderConnection }) {
  const discover = useDiscoverNow(connection.id);
  const toast = useToast();
  const ready = connection.status === 'active' && !!connection.cluster_name;
  return (
    <section aria-labelledby="pc-discover-now" className="flex flex-col gap-2 border-t border-rule pt-5">
      <h3 id="pc-discover-now" className="text-body font-semibold text-ink">
        Run discovery now
      </h3>
      <p className="text-caption text-muted">
        {ready
          ? 'Queues one discovery job for this connection, outside the schedule.'
          : 'Needs an active connection with a cluster name. Save those first.'}
      </p>
      <div>
        <Button
          type="button"
          variant="secondary"
          disabled={!ready || discover.isPending}
          aria-busy={discover.isPending}
          onClick={async () => {
            try {
              await discover.mutateAsync();
              toast(`Discovery queued for ${connection.name}.`);
            } catch {
              // Shown below.
            }
          }}
        >
          {discover.isPending ? 'Queuing…' : 'Run discovery now'}
        </Button>
      </div>
      {discover.isError && (
        <Banner tone="error" title="Not queued.">
          {errorText(discover.error)}
        </Banner>
      )}
    </section>
  );
}

function BindingsPanel({ connectionID }: { connectionID: string }) {
  const bindings = useBindings(connectionID);
  const projects = useProjects();
  const create = useCreateBinding(connectionID);
  const del = useDeleteBinding(connectionID);
  const toast = useToast();

  const [projectID, setProjectID] = useState('');
  const [envID, setEnvID] = useState('');
  const [tried, setTried] = useState(false);
  const [unbinding, setUnbinding] = useState<ProviderConnectionBinding | null>(null);
  const envs = useEnvironmentsForProject(projectID || undefined);
  const projectName = (id: string) => (projects.data ?? []).find((p) => p.id === id)?.name;

  const onBind = async () => {
    setTried(true);
    if (!projectID) {
      document.getElementById('pc-bind-project')?.focus();
      return;
    }
    try {
      await create.mutateAsync({ project_id: projectID, environment_id: envID || null });
      const env = (envs.data ?? []).find((e) => e.id === envID)?.name;
      toast(`Bound to ${projectName(projectID) ?? 'the project'}${env ? ` · ${env}` : ''}.`);
      setProjectID('');
      setEnvID('');
      setTried(false);
    } catch {
      // Shown below.
    }
  };

  const rows = bindings.data ?? [];

  return (
    <section aria-labelledby="pc-bindings" className="flex flex-col gap-3 border-t border-rule pt-5">
      <div>
        <h3 id="pc-bindings" className="text-body font-semibold text-ink">
          Bindings
          <span className="ml-2 font-mono text-mono-small font-normal text-muted">{rows.length}</span>
        </h3>
        <p className="mt-0.5 text-caption text-muted">
          Developers see this connection only in the projects and environments it is bound to. Leave the environment empty to
          bind the whole project.
        </p>
      </div>

      {bindings.isLoading && <p className="text-muted">Loading bindings…</p>}
      {bindings.isError && (
        <Banner tone="error" title="Couldn't load the bindings.">
          {errorText(bindings.error)}
        </Banner>
      )}
      {bindings.data &&
        (rows.length === 0 ? (
          <p className="text-muted">Not bound to any project yet.</p>
        ) : (
          <ul className="m-0 list-none rounded-md border border-border p-0">
            {rows.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 border-t border-rule px-3 py-2 text-ui font-normal first:border-t-0">
                <span className="min-w-0">
                  <span className="font-medium text-ink">{b.project_name ?? projectName(b.project_id) ?? 'Unknown project'}</span>
                  <span className="text-muted"> · {b.environment_id ? <BindingEnvName binding={b} /> : 'whole project'}</span>
                </span>
                <Button variant="secondary" size="sm" onClick={() => setUnbinding(b)}>
                  Unbind…
                </Button>
              </li>
            ))}
          </ul>
        ))}

      <div className="grid grid-cols-1 items-end gap-2.5 min-[600px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <Field id="pc-bind-project" label="Project" error={tried && !projectID ? 'Choose a project.' : undefined}>
          {(p) => (
            <Select
              {...p}
              value={projectID}
              onChange={(e) => {
                setProjectID(e.target.value);
                setEnvID('');
              }}
            >
              <option value="">Choose a project</option>
              {(projects.data ?? []).map((pr) => (
                <option key={pr.id} value={pr.id}>
                  {pr.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="pc-bind-env" label="Environment">
          {(p) => (
            <Select {...p} value={envID} onChange={(e) => setEnvID(e.target.value)} disabled={!projectID}>
              <option value="">Whole project</option>
              {(envs.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {(e.kind ?? e.type) === 'prod' ? ' (production)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void onBind()}
          disabled={create.isPending}
          aria-busy={create.isPending}
          className={tried && !projectID ? 'min-[600px]:mb-[26px]' : ''}
        >
          {create.isPending ? 'Binding…' : 'Bind'}
        </Button>
      </div>
      {create.isError && (
        <Banner tone="error" title="Not bound.">
          {errorText(create.error)}
        </Banner>
      )}

      {unbinding && (
        <ConfirmModal
          title={`Unbind from ${unbinding.project_name ?? projectName(unbinding.project_id) ?? 'this project'}?`}
          body={`Developers in ${unbinding.environment_id ? 'that environment' : 'every environment of the project'} stop seeing this connection, and approved requests there no longer run through its agents. Requests already running are not stopped.`}
          confirmText="Unbind"
          danger
          loading={del.isPending}
          error={del.error ?? undefined}
          onCancel={() => {
            del.reset();
            setUnbinding(null);
          }}
          onConfirm={async () => {
            try {
              await del.mutateAsync(unbinding.id);
              toast('Unbound.');
              setUnbinding(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </section>
  );
}

/**
 * The binding list may come without environment names; look the name up
 * in the project's environments (one cached query per project).
 */
function BindingEnvName({ binding }: { binding: ProviderConnectionBinding }) {
  const envs = useEnvironmentsForProject(binding.environment_name ? undefined : binding.project_id);
  if (binding.environment_name) return <>{binding.environment_name}</>;
  const env = envs.data?.find((e) => e.id === binding.environment_id);
  if (!env) return <>{envs.isLoading ? '…' : 'an environment'}</>;
  return <EnvTag kind={env.kind ?? (env.type === 'prod' ? 'prod' : 'non_prod')}>{env.name}</EnvTag>;
}
