/**
 * Bind an advertised Argo CD target to a secret scope in a project
 * environment (POST /admin/gateway-bindings, gateway.bind, fresh second
 * factor). Release 1 binds Argo CD targets only.
 *
 * The secret scope is one of:
 *   - a catalog secret bound to the project (secret_id), or
 *   - a provider connection and a secret path (provider_connection_id and
 *     secret_ref).
 * A change executed in that scope and environment starts an observation
 * task for this Gateway. The api checks every reference again.
 */

import { useState } from 'react';

import { ApiError } from '../../../api/client';
import { type CreateBindingInput, type Gateway, type GatewayConnector, useCreateBinding } from '../../../api/gateways';
import { useProviderConnectionsAdmin } from '../../../api/providerConnections';
import { useEnvironments, useEnvironmentsForProject, useProjects, useProjectSecrets } from '../../../api/tenancy';
import { providerLabel } from '../../../lib/providers';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Drawer } from '../../../ui/Drawer';
import { Field, Input, Select } from '../../../ui/Field';
import { useToast } from '../../../ui/toastContext';

const DEADLINES = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 1800, label: '30 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 7200, label: '2 hours' },
  { seconds: 21600, label: '6 hours' },
];

const BIND_ERRORS: Record<string, string> = {
  binding_exists: 'An equal binding already exists.',
  secret_scope_required: 'Choose a catalog secret, or a provider connection and a secret path.',
  environment_not_in_project: 'That environment is not in the chosen project.',
  environment_outside_gateway: "This Gateway is pinned to another environment.",
  secret_not_in_project: 'That secret is not bound to the project.',
  connector_not_approved: 'Approve the connector first.',
  connector_kind_not_supported: 'Only Argo CD connectors can be bound in this release.',
  target_not_advertised: 'The Gateway no longer advertises that target.',
  target_stale: 'The Gateway no longer advertises that target.',
  target_id_invalid: 'That target id is not valid.',
  gateway_revoked: 'This Gateway is revoked.',
  observation_timeout_out_of_range: 'The deadline must be between 1 minute and 24 hours.',
  provider_connection_not_found: 'That provider connection no longer exists.',
  environment_not_found: 'That environment no longer exists.',
};

export function BindingDrawer({ gateway, connector, onClose }: { gateway: Gateway; connector: GatewayConnector; onClose: () => void }) {
  const create = useCreateBinding();
  const toast = useToast();
  const projects = useProjects();
  const allEnvs = useEnvironments();
  const pinned = gateway.environment_id ? (allEnvs.data ?? []).find((e) => e.id === gateway.environment_id) : undefined;

  const [projectTyped, setProjectId] = useState('');
  const projectId = pinned?.project_id ?? projectTyped;
  const envs = useEnvironmentsForProject(projectId || undefined);
  const [envTyped, setEnvId] = useState('');
  const envId = gateway.environment_id ?? envTyped;
  const targets = (connector.targets ?? []).filter((t) => !t.stale);
  const [targetId, setTargetId] = useState(targets.length === 1 ? targets[0].target_id : '');
  const [scope, setScope] = useState<'secret' | 'connection'>('secret');
  const secrets = useProjectSecrets(scope === 'secret' && projectId ? projectId : undefined);
  const connections = useProviderConnectionsAdmin();
  const [secretId, setSecretId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [deadline, setDeadline] = useState(1800);
  const [tried, setTried] = useState(false);

  const secretOptions = (secrets.data ?? []).filter((b) => !b.environment_id || b.environment_id === envId);

  const errors: Record<string, string> = {};
  if (!projectId) errors.project = 'Choose a project.';
  if (!envId) errors.env = 'Choose an environment.';
  if (!targetId) errors.target = 'Choose an advertised target.';
  if (scope === 'secret' && !secretId) errors.secret = 'Choose a secret bound to the project.';
  if (scope === 'connection') {
    if (!connectionId) errors.connection = 'Choose a provider connection.';
    if (!secretRef.trim() || secretRef.includes('://') || !/^[A-Za-z0-9/_+=.@-]{1,512}$/.test(secretRef))
      errors.ref = 'Enter the secret path: letters, digits and / _ + = . @ - only.';
  }
  const show = (k: string) => (tried ? errors[k] : undefined);

  const submit = async () => {
    setTried(true);
    const first = ['project', 'env', 'target', 'secret', 'connection', 'ref'].find((k) => errors[k]);
    if (first) {
      document.getElementById(`gb-${first}`)?.focus();
      return;
    }
    const body: CreateBindingInput = {
      gateway_id: gateway.id,
      project_id: projectId,
      environment_id: envId,
      argocd_connector_id: connector.id,
      argocd_target_id: targetId,
      observation_timeout_seconds: deadline,
      ...(scope === 'secret' ? { secret_id: secretId } : { provider_connection_id: connectionId, secret_ref: secretRef }),
    };
    try {
      await create.mutateAsync(body);
      toast(`Bound ${targetId} to the environment.`);
      onClose();
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Bind a target"
      subtitle={`Gateway ${gateway.name} · Argo CD connector ${connector.connector_id}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-binding" variant="primary" disabled={create.isPending} aria-busy={create.isPending}>
            {create.isPending ? 'Binding…' : 'Create binding'}
          </Button>
        </>
      }
    >
      <form
        id="create-binding"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <Field id="gb-target" label="Argo CD target" hint="An application the Gateway advertises." error={show('target')}>
          {(p) => (
            <Select {...p} value={targetId} onChange={(e) => setTargetId(e.target.value)} data-autofocus>
              <option value="">Choose a target</option>
              {targets.map((t) => (
                <option key={t.target_id} value={t.target_id}>
                  {t.target_id}
                  {t.name ? ` (${t.namespace ? `${t.namespace}/` : ''}${t.name})` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {gateway.environment_id ? (
          <p className="text-ui font-normal text-muted">
            This Gateway is pinned to{' '}
            <span className="text-ink">
              {pinned ? `${(projects.data ?? []).find((p) => p.id === pinned.project_id)?.name ?? 'its project'} · ${pinned.name}` : 'one environment'}
            </span>
            .
          </p>
        ) : (
          <>
            <Field id="gb-project" label="Project" error={show('project')}>
              {(p) => (
                <Select
                  {...p}
                  value={projectTyped}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setEnvId('');
                    setSecretId('');
                  }}
                >
                  <option value="">{projects.isLoading ? 'Loading projects…' : 'Choose a project'}</option>
                  {[...(projects.data ?? [])]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((pr) => (
                      <option key={pr.id} value={pr.id}>
                        {pr.name}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            <Field id="gb-env" label="Environment" error={show('env')}>
              {(p) => (
                <Select {...p} value={envTyped} onChange={(e) => setEnvId(e.target.value)} disabled={!projectId}>
                  <option value="">{projectId ? 'Choose an environment' : 'Choose a project first'}</option>
                  {(envs.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 text-label font-medium text-ink">Secret scope</legend>
          <label className="flex items-center gap-2 text-ui font-normal">
            <input type="radio" name="gb-scope" checked={scope === 'secret'} onChange={() => setScope('secret')} />
            A catalog secret bound to the project
          </label>
          <label className="flex items-center gap-2 text-ui font-normal">
            <input type="radio" name="gb-scope" checked={scope === 'connection'} onChange={() => setScope('connection')} />
            A provider connection and a secret path
          </label>
        </fieldset>

        {scope === 'secret' ? (
          <Field id="gb-secret" label="Secret" hint="Only secrets bound to the project for this environment are listed." error={show('secret')}>
            {(p) => (
              <Select {...p} value={secretId} onChange={(e) => setSecretId(e.target.value)} disabled={!projectId}>
                <option value="">{!projectId ? 'Choose a project first' : secrets.isLoading ? 'Loading secrets…' : 'Choose a secret'}</option>
                {secretOptions.map((b) => (
                  <option key={b.secret_id} value={b.secret_id}>
                    {b.secret ? `${b.secret.secret_ref} · ${b.secret.cluster_name}` : b.secret_id}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <>
            <Field id="gb-connection" label="Provider connection" error={show('connection')}>
              {(p) => (
                <Select {...p} value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
                  <option value="">{connections.isLoading ? 'Loading connections…' : 'Choose a connection'}</option>
                  {[...(connections.data ?? [])]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} · {providerLabel(c.type)}
                      </option>
                    ))}
                </Select>
              )}
            </Field>
            {connections.isError && (
              <Banner tone="error" title="Couldn't load the provider connections.">
                {connections.error instanceof ApiError ? `${connections.error.status}: ${connections.error.message}` : 'Network error.'}
              </Banner>
            )}
            <Field id="gb-ref" label="Secret path" hint="The path in the provider, as requests name it." error={show('ref')}>
              {(p) => <Input {...p} value={secretRef} onChange={(e) => setSecretRef(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} placeholder="team-alpha/uat/db" />}
            </Field>
          </>
        )}

        <Field id="gb-deadline" label="Observation deadline" hint="How long a task waits for evidence before it closes as timed out.">
          {(p) => (
            <Select {...p} value={deadline} onChange={(e) => setDeadline(Number(e.target.value))}>
              {DEADLINES.map((d) => (
                <option key={d.seconds} value={d.seconds}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {create.isError && (
          <Banner tone="error" title="No binding was created.">
            {create.error instanceof ApiError
              ? `${create.error.status}: ${BIND_ERRORS[create.error.message] ?? create.error.message}`
              : 'Network error. Try again.'}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
