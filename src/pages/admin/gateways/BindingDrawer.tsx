/**
 * Bind an Argo CD target to a secret scope in a project environment
 * (POST /admin/gateway-bindings, gateway.bind, fresh second factor).
 * Release 1 binds Argo CD targets only. It opens two ways: from a
 * connector in the Gateway drawer, choosing one of its advertised static
 * targets, or from the target catalog, with the target and project
 * already chosen.
 *
 * The secret scope is one of:
 *   - a catalog secret bound to the project (secret_id), or
 *   - a provider connection and a secret path (provider_connection_id and
 *     secret_ref).
 * A change executed in that scope and environment starts an observation
 * task for this Gateway. The api checks every reference again.
 *
 * Without a global gateway.bind, production and other environments
 * aren't offered, because the api refuses them for a team-scoped caller
 * (production_binding_platform_only). A team-scoped caller binds a
 * catalog secret only: listing provider connections is global.
 */

import { useState } from 'react';

import { ApiError } from '../../../api/client';
import { missingFactorText } from '../../../api/mfaErrors';
import { type CatalogItem, type CreateBindingInput, type Gateway, type GatewayConnector, useCreateBinding } from '../../../api/gateways';
import { useProviderConnectionsAdmin } from '../../../api/providerConnections';
import { useEnvironments, useEnvironmentsForProject, useProjects, useProjectSecrets } from '../../../api/tenancy';
import type { Environment } from '../../../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { providerLabel } from '../../../lib/providers';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Drawer } from '../../../ui/Drawer';
import { Field, Input, Select } from '../../../ui/Field';
import { useToast } from '../../../ui/toastContext';
import { TargetIdentity } from '../../gateways/TargetIdentity';

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
  target_not_found: 'That target is no longer available to your team.',
  target_missing: 'The Application is gone from Argo CD.',
  target_identity_changed: 'The Application was recreated. A platform admin has to re-confirm it first.',
  target_team_mismatch: "That target's AppProject doesn't map to this project's team.",
  production_binding_platform_only: 'Only a platform admin can bind into a production environment.',
  gateway_bound_target_limit: 'This Gateway has reached its limit of bound targets.',
};

/** The environments a caller without a global gateway.bind can bind into. */
const teamBindable = (e: Environment) => ['dev', 'staging', 'uat'].includes(e.type) && e.kind === 'non_prod';

export type BindingSource =
  | { kind: 'connector'; gateway: Gateway; connector: GatewayConnector }
  | { kind: 'catalog'; item: CatalogItem; projectId: string };

export function BindingDrawer({ source, onClose }: { source: BindingSource; onClose: () => void }) {
  const { hasGlobalPermission } = useAuth();
  const globalBind = hasGlobalPermission('gateway.bind');
  const canUseConnections = hasGlobalPermission('integration.edit');
  const create = useCreateBinding();
  const toast = useToast();
  const projects = useProjects();
  const allEnvs = useEnvironments();
  const gateway = source.kind === 'connector' ? source.gateway : undefined;
  const connector = source.kind === 'connector' ? source.connector : undefined;
  const item = source.kind === 'catalog' ? source.item : undefined;
  const pinnedId = gateway?.environment_id;
  const pinned = pinnedId ? (allEnvs.data ?? []).find((e) => e.id === pinnedId) : undefined;

  const [projectTyped, setProjectId] = useState('');
  const projectId = item ? (source as { projectId: string }).projectId : (pinned?.project_id ?? projectTyped);
  const envs = useEnvironmentsForProject(projectId || undefined);
  const envOptions = (envs.data ?? []).filter((e) => globalBind || teamBindable(e));
  const hiddenEnvs = (envs.data ?? []).length - envOptions.length;
  const [envTyped, setEnvId] = useState('');
  const envId = pinnedId ?? envTyped;
  const targets = (connector?.targets ?? []).filter((t) => !t.stale);
  const [targetTyped, setTargetId] = useState(targets.length === 1 ? targets[0].target_id : '');
  const targetId = item?.target_id ?? targetTyped;
  const [scope, setScope] = useState<'secret' | 'connection'>('secret');
  const secrets = useProjectSecrets(scope === 'secret' && projectId ? projectId : undefined);
  const connections = useProviderConnectionsAdmin(canUseConnections);
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
      gateway_id: item?.gateway_id ?? gateway!.id,
      project_id: projectId,
      environment_id: envId,
      argocd_connector_id: item?.connector_uuid ?? connector!.id,
      argocd_target_id: targetId,
      observation_timeout_seconds: deadline,
      ...(scope === 'secret' ? { secret_id: secretId } : { provider_connection_id: connectionId, secret_ref: secretRef }),
    };
    try {
      await create.mutateAsync(body);
      toast(`Bound ${item?.name ?? targetId} to the environment.`);
      onClose();
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Bind a target"
      subtitle={gateway ? `Gateway ${gateway.name} · Argo CD connector ${connector!.connector_id}` : `Argo CD connector ${item!.connector_id}`}
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
        {item ? (
          <div className="flex flex-col gap-2">
            <p className="text-label font-medium text-ink">Argo CD target</p>
            <TargetIdentity targetId={item.target_id} name={item.name} appProject={item.app_project} namespace={item.namespace} isStatic={item.source === 'static'} />
            {item.look_alike && (
              <Banner tone="note" title="Another target has this name.">
                It's in a different AppProject or namespace. Check that this is the one you mean.
              </Banner>
            )}
          </div>
        ) : (
          <Field id="gb-target" label="Argo CD target" hint="An application the Gateway advertises." error={show('target')}>
            {(p) => (
              <Select {...p} value={targetTyped} onChange={(e) => setTargetId(e.target.value)} data-autofocus>
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
        )}

        {pinnedId ? (
          <p className="text-ui font-normal text-muted">
            This Gateway is pinned to{' '}
            <span className="text-ink">
              {pinned ? `${(projects.data ?? []).find((p) => p.id === pinned.project_id)?.name ?? 'its project'} · ${pinned.name}` : 'one environment'}
            </span>
            .
          </p>
        ) : (
          <>
            {item ? (
              <p className="text-ui font-normal text-muted">
                Project <span className="text-ink">{(projects.data ?? []).find((p) => p.id === projectId)?.name ?? 'chosen on the page'}</span>
              </p>
            ) : (
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
            )}
            <Field
              id="gb-env"
              label="Environment"
              hint={hiddenEnvs > 0 ? 'Production and other environments need a platform admin.' : undefined}
              error={show('env')}
            >
              {(p) => (
                <Select {...p} value={envTyped} onChange={(e) => setEnvId(e.target.value)} disabled={!projectId} data-autofocus={item ? true : undefined}>
                  <option value="">{projectId ? 'Choose an environment' : 'Choose a project first'}</option>
                  {envOptions.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </>
        )}

        {canUseConnections && (
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
        )}

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
            {missingFactorText(create.error, 'no binding was created') ??
              (create.error instanceof ApiError
                ? `${create.error.status}: ${BIND_ERRORS[create.error.message] ?? create.error.message}`
                : 'Network error. Try again.')}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
