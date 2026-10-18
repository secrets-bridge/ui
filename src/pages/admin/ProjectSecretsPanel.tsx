/**
 * Project secrets (admin, Projects → a project → Secrets tab, ui#26).
 *
 * Which discovered catalog secrets members of a project can request,
 * and for each one the keys and operations allowed. The api refuses any
 * request outside a binding (api#43 Slice C). Bind, edit and unbind:
 *
 *   GET    /api/v1/projects/:id/secrets             list
 *   POST   /api/v1/projects/:id/secrets             bind
 *   PUT    /api/v1/projects/:id/secrets/:secret_id  update
 *   DELETE /api/v1/projects/:id/secrets/:secret_id  unbind
 *
 * `allowed_keys` null means every key; an empty list is never sent.
 * A binding may be scoped to one environment (`environment_id`, api#201);
 * the table shows which one, or "Whole project". Bind and Edit both pick
 * the environment explicitly and always send `environment_id` (null for
 * the whole project), so Edit never changes the scope by omission
 * (ui#143, api#249). The request flow offers a binding in its own
 * environment, and a whole-project binding in every environment.
 */

import { useMemo, useState } from 'react';
import { useForm, useWatch, type UseFormRegisterReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import { useSecrets, type Secret } from '../../api/secrets';
import {
  useBindProjectSecret,
  useEnvironmentsForProject,
  useProjectSecrets,
  useUnbindProjectSecret,
  useUpdateProjectSecret,
} from '../../api/tenancy';
import type {
  Environment,
  Project,
  ProjectSecretBinding,
  ProjectSecretBindingInput,
  ProjectSecretBindingUpdate,
} from '../../api/types';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { DataTable, type Column } from '../../ui/DataTable';
import { Drawer } from '../../ui/Drawer';
import { EmptyState } from '../../ui/EmptyState';
import { EnvTag } from '../../ui/EnvTag';
import { Field, Input, Select } from '../../ui/Field';
import { Keys } from '../../ui/Keys';
import { useToast } from '../../ui/toastContext';

const OPS = ['read', 'patch', 'discover'] as const;
const OP_LABEL: Record<string, string> = { read: 'Read', patch: 'Change', discover: 'Discover' };

const refOf = (b: ProjectSecretBinding) => b.secret?.secret_ref ?? b.secret_id;

/** Select value for a whole-project binding; '' is "not chosen yet". */
const WHOLE_PROJECT = 'project';
const envChoice = z.string().min(1, 'Choose an environment, or the whole project.');
const toEnvironmentId = (choice: string) => (choice === WHOLE_PROJECT ? null : choice);

/** Environments of the project, for the Bind and Edit pickers. */
interface EnvOptions {
  list: Environment[];
  isLoading: boolean;
  error: unknown;
}

function splitKeys(csv: string): string[] {
  return csv
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
}

function errorText(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export function ProjectSecretsPanel({ project }: { project: Project }) {
  const bindings = useProjectSecrets(project.id);
  const envs = useEnvironmentsForProject(project.id);
  const unbind = useUnbindProjectSecret(project.id);
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectSecretBinding | null>(null);
  const [confirmUnbind, setConfirmUnbind] = useState<ProjectSecretBinding | null>(null);

  const envById = useMemo(() => new Map((envs.data ?? []).map((e) => [e.id, e])), [envs.data]);
  const envOptions = useMemo<EnvOptions>(
    () => ({
      list: [...(envs.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
      isLoading: envs.isLoading,
      error: envs.error,
    }),
    [envs.data, envs.isLoading, envs.error],
  );
  const rows = [...(bindings.data ?? [])].sort((a, b) => refOf(a).localeCompare(refOf(b)));

  const scope = (b: ProjectSecretBinding) => {
    if (!b.environment_id) return <span className="text-muted">Whole project</span>;
    const env = envById.get(b.environment_id);
    return env ? <EnvTag kind={env.kind}>{env.name}</EnvTag> : <span className="font-mono text-mono text-muted">{b.environment_id.slice(0, 8)}</span>;
  };
  const actions = (b: ProjectSecretBinding) => (
    <span className="inline-flex gap-2">
      <Button variant="secondary" size="sm" onClick={() => setEditing(b)} aria-label={`Edit binding for ${refOf(b)}`}>
        Edit
      </Button>
      <Button variant="danger" size="sm" onClick={() => setConfirmUnbind(b)} aria-label={`Unbind ${refOf(b)}`}>
        Unbind…
      </Button>
    </span>
  );

  const columns: Column<ProjectSecretBinding>[] = [
    {
      key: 'ref',
      header: 'Path',
      render: (b) => (
        <button type="button" onClick={() => setEditing(b)} className="break-all text-left font-mono text-mono text-accent hover:underline">
          {refOf(b)}
        </button>
      ),
      className: 'max-w-[320px]',
    },
    { key: 'env', header: 'Environment', render: scope, className: 'whitespace-nowrap' },
    {
      key: 'provider',
      header: 'Provider',
      render: (b) =>
        b.secret ? (
          <span>
            {providerLabel(b.secret.provider_type)}
            {b.secret.cluster_name && <span className="block font-mono text-mono-small text-muted">{b.secret.cluster_name}</span>}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: 'keys', header: 'Keys', render: (b) => <Keys keys={b.allowed_keys ?? []} />, className: 'max-w-[220px]' },
    { key: 'ops', header: 'Allows', render: (b) => b.allowed_ops.map((o) => OP_LABEL[o] ?? o).join(', '), className: 'whitespace-nowrap' },
    { key: 'actions', header: 'Actions', hiddenHeader: true, align: 'right', render: actions, className: 'whitespace-nowrap' },
  ];

  return (
    <section aria-labelledby="ps-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="ps-heading" className="text-block-heading text-ink">
            Bound secrets
            {bindings.data && <span className="ml-2 font-mono text-mono-small font-normal text-muted">{rows.length}</span>}
          </h2>
          <p className="mt-0.5 max-w-3xl text-caption text-muted">
            Members of {project.name} can request only these secrets, and only the keys and operations each binding allows.
          </p>
        </div>
        <Button variant="primary" onClick={() => setAdding(true)}>
          Bind a secret
        </Button>
      </div>

      {bindings.isLoading && <p className="text-muted">Loading bound secrets…</p>}
      {bindings.isError && (
        <Banner
          tone="error"
          title="Couldn't load the bound secrets."
          action={
            <Button variant="secondary" size="sm" onClick={() => void bindings.refetch()}>
              Try again
            </Button>
          }
        >
          {errorText(bindings.error)}
        </Banner>
      )}
      {bindings.data &&
        (rows.length === 0 ? (
          <EmptyState
            title={`No secrets are bound to ${project.name}.`}
            action={
              <Button variant="secondary" onClick={() => setAdding(true)}>
                Bind a secret
              </Button>
            }
          >
            Members can't request anything here until you bind a discovered secret.
          </EmptyState>
        ) : (
          <DataTable
            label={`Secrets bound to ${project.name}`}
            columns={columns}
            rows={rows}
            rowKey={(b) => `${b.project_id}:${b.secret_id}`}
            onRowClick={setEditing}
            minWidth={820}
            stacked={(b) => (
              <div className="flex flex-col gap-1.5">
                <button type="button" onClick={() => setEditing(b)} className="break-all text-left font-mono text-mono text-accent hover:underline">
                  {refOf(b)}
                </button>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted">
                  {scope(b)}
                  <span>· {b.allowed_ops.map((o) => OP_LABEL[o] ?? o).join(', ')}</span>
                  {b.secret && <span>· {providerLabel(b.secret.provider_type)}</span>}
                </p>
                <Keys keys={b.allowed_keys ?? []} variant="chips" />
                <div className="mt-1">{actions(b)}</div>
              </div>
            )}
          />
        ))}

      {adding && (
        <BindDrawer
          project={project}
          existingSecretIds={new Set(rows.map((b) => b.secret_id))}
          envs={envOptions}
          onDone={(ref) => {
            setAdding(false);
            toast(`Bound ${ref} to ${project.name}.`);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {editing && (
        <EditDrawer
          project={project}
          binding={editing}
          envs={envOptions}
          onDone={() => {
            toast(`Saved the binding for ${refOf(editing)}.`);
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmUnbind && (
        <ConfirmModal
          title={`Unbind ${refOf(confirmUnbind)}?`}
          body={`Members of ${project.name} can no longer request it. Requests already made stay in the audit log.`}
          confirmText="Unbind"
          danger
          loading={unbind.isPending}
          error={unbind.error}
          onConfirm={async () => {
            try {
              await unbind.mutateAsync({ secretId: confirmUnbind.secret_id });
              toast(`Unbound ${refOf(confirmUnbind)}.`);
              setConfirmUnbind(null);
            } catch {
              // Shown in the dialog.
            }
          }}
          onCancel={() => {
            unbind.reset();
            setConfirmUnbind(null);
          }}
        />
      )}
    </section>
  );
}

// --- bind ------------------------------------------------------------

const keyRule = (v: { allow_all_keys: boolean; allowed_keys_csv: string }) => v.allow_all_keys || splitKeys(v.allowed_keys_csv).length > 0;
const keyRuleError = { message: 'List at least one key, or allow every key.', path: ['allowed_keys_csv'] };

const bindSchema = z
  .object({
    secret_id: z.guid('Choose a secret from the catalog.'),
    environment: envChoice,
    allow_all_keys: z.boolean(),
    allowed_keys_csv: z.string(),
    allowed_ops: z.array(z.enum(OPS), { error: 'Allow at least one operation.' }).min(1, 'Allow at least one operation.'),
  })
  .refine(keyRule, keyRuleError);

type BindFormValues = z.infer<typeof bindSchema>;

function BindDrawer({
  project,
  existingSecretIds,
  envs,
  onDone,
  onCancel,
}: {
  project: Project;
  existingSecretIds: Set<string>;
  envs: EnvOptions;
  onDone: (ref: string) => void;
  onCancel: () => void;
}) {
  const catalog = useSecrets({ limit: 500 });
  const bind = useBindProjectSecret(project.id);

  const candidates = useMemo<Secret[]>(
    () => (catalog.data?.items ?? []).filter((s) => !existingSecretIds.has(s.id)).sort((a, b) => a.secret_ref.localeCompare(b.secret_ref)),
    [catalog.data, existingSecretIds],
  );

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<BindFormValues>({
    resolver: zodResolver(bindSchema),
    defaultValues: { secret_id: '', environment: '', allow_all_keys: true, allowed_keys_csv: '', allowed_ops: ['read'] },
  });
  const allowAll = useWatch({ control, name: 'allow_all_keys' });

  const onSubmit = async (v: BindFormValues) => {
    const body: ProjectSecretBindingInput = {
      secret_id: v.secret_id,
      environment_id: toEnvironmentId(v.environment),
      allowed_ops: v.allowed_ops,
      allowed_keys: v.allow_all_keys ? null : splitKeys(v.allowed_keys_csv),
    };
    try {
      await bind.mutateAsync(body);
      onDone(candidates.find((s) => s.id === v.secret_id)?.secret_ref ?? 'the secret');
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Bind a secret"
      subtitle={`Let members of ${project.name} request a discovered secret.`}
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="bind-secret" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Binding…' : 'Bind secret'}
          </Button>
        </>
      }
    >
      <form id="bind-secret" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
        <Field
          id="bind-secret-id"
          label="Secret"
          hint={
            catalog.isLoading
              ? 'Loading the catalog…'
              : catalog.data && candidates.length === 0
                ? 'Every discovered secret is already bound to this project.'
                : 'Secrets found by discovery. Paths only.'
          }
          error={errors.secret_id?.message}
        >
          {(p) => (
            <Select {...p} {...register('secret_id')} className="font-mono" data-autofocus>
              <option value="">Choose a secret</option>
              {candidates.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.secret_ref} · {s.cluster_name} · {providerLabel(s.provider_type)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <EnvironmentField
          id="bind-environment"
          project={project}
          envs={envs}
          register={register('environment')}
          error={errors.environment?.message}
        />

        <KeyPolicyFields
          idPrefix="bind"
          registerAllowAll={register('allow_all_keys')}
          registerKeysCsv={register('allowed_keys_csv')}
          keysError={errors.allowed_keys_csv?.message}
          allowAll={allowAll}
        />

        <OpsField idPrefix="bind" register={register('allowed_ops')} error={errors.allowed_ops?.message} />

        {bind.isError && (
          <Banner tone="error" title="Not bound.">
            {errorText(bind.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

// --- edit ------------------------------------------------------------

const editSchema = z
  .object({
    environment: envChoice,
    allow_all_keys: z.boolean(),
    allowed_keys_csv: z.string(),
    allowed_ops: z.array(z.enum(OPS), { error: 'Allow at least one operation.' }).min(1, 'Allow at least one operation.'),
  })
  .refine(keyRule, keyRuleError);

type EditFormValues = z.infer<typeof editSchema>;

function EditDrawer({
  project,
  binding,
  envs,
  onDone,
  onCancel,
}: {
  project: Project;
  binding: ProjectSecretBinding;
  envs: EnvOptions;
  onDone: () => void;
  onCancel: () => void;
}) {
  const update = useUpdateProjectSecret(project.id);

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      // The binding's current scope, sent back unchanged unless edited.
      environment: binding.environment_id || WHOLE_PROJECT,
      // `== null` covers an absent field as well as an explicit null;
      // both mean "every key".
      allow_all_keys: binding.allowed_keys == null,
      allowed_keys_csv: (binding.allowed_keys ?? []).join(', '),
      allowed_ops: binding.allowed_ops.filter((o): o is (typeof OPS)[number] => (OPS as readonly string[]).includes(o)),
    },
  });
  const allowAll = useWatch({ control, name: 'allow_all_keys' });

  const onSubmit = async (v: EditFormValues) => {
    const body: ProjectSecretBindingUpdate = {
      environment_id: toEnvironmentId(v.environment),
      allowed_ops: v.allowed_ops,
      allowed_keys: v.allow_all_keys ? null : splitKeys(v.allowed_keys_csv),
    };
    try {
      await update.mutateAsync({ secretId: binding.secret_id, body });
      onDone();
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <Drawer
      title="Edit binding"
      subtitle={
        <>
          <span className="break-all font-mono text-mono">{refOf(binding)}</span> · {project.name}
        </>
      }
      onClose={onCancel}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" form="edit-binding" variant="primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Saving…' : 'Save binding'}
          </Button>
        </>
      }
    >
      <form id="edit-binding" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
        <EnvironmentField
          id="edit-environment"
          project={project}
          envs={envs}
          currentId={binding.environment_id ?? undefined}
          register={register('environment')}
          error={errors.environment?.message}
        />
        <KeyPolicyFields
          idPrefix="edit"
          registerAllowAll={register('allow_all_keys')}
          registerKeysCsv={register('allowed_keys_csv')}
          keysError={errors.allowed_keys_csv?.message}
          allowAll={allowAll}
          autoFocus
        />
        <OpsField idPrefix="edit" register={register('allowed_ops')} error={errors.allowed_ops?.message} />
        {update.isError && (
          <Banner tone="error" title="Not saved.">
            {errorText(update.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

// --- shared fields ---------------------------------------------------

function EnvironmentField({
  id,
  project,
  envs,
  currentId,
  register,
  error,
}: {
  id: string;
  project: Project;
  envs: EnvOptions;
  /** The binding's stored environment, kept as an option even if the list doesn't have it. */
  currentId?: string;
  register: UseFormRegisterReturn;
  error?: string;
}) {
  const missingCurrent = currentId && !envs.list.some((e) => e.id === currentId);
  const hint = envs.isLoading
    ? 'Loading the environments…'
    : envs.error
      ? `Couldn't load the environments. ${errorText(envs.error)}`
      : envs.list.length === 0
        ? `${project.name} has no environments yet. A whole-project binding applies to any you add.`
        : 'Requests in this environment can use the secret. Whole project applies to every environment of the project, prod included.';
  return (
    <Field id={id} label="Environment" hint={hint} error={error}>
      {(p) =>
        // Mount the registered select only once the list is in, so the
        // default (the binding's current environment) lands on a real
        // option instead of being dropped while the options swap.
        envs.isLoading ? (
          <Select {...p} disabled value="" onChange={() => undefined}>
            <option value="">Loading…</option>
          </Select>
        ) : (
          <Select {...p} {...register}>
            <option value="">Choose an environment</option>
            {envs.list.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {e.kind === 'prod' ? ' · prod' : ''}
              </option>
            ))}
            {missingCurrent && <option value={currentId}>{currentId.slice(0, 8)} (current)</option>}
            <option value={WHOLE_PROJECT}>Whole project</option>
          </Select>
        )
      }
    </Field>
  );
}

function KeyPolicyFields({
  idPrefix,
  registerAllowAll,
  registerKeysCsv,
  keysError,
  allowAll,
  autoFocus,
}: {
  idPrefix: string;
  registerAllowAll: UseFormRegisterReturn;
  registerKeysCsv: UseFormRegisterReturn;
  keysError?: string;
  allowAll: boolean;
  autoFocus?: boolean;
}) {
  const errId = `${idPrefix}-keys-error`;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 p-0 text-body font-semibold text-ink">Keys</legend>
      <label className="flex items-center gap-2.5 text-ui font-normal">
        <input type="checkbox" {...registerAllowAll} className="m-0 h-4 w-4 accent-accent" data-autofocus={autoFocus ? true : undefined} />
        Allow every key in this secret
      </label>
      {!allowAll && (
        <Input
          {...registerKeysCsv}
          id={`${idPrefix}-keys`}
          aria-label="Allowed keys, separated by commas"
          aria-invalid={keysError ? true : undefined}
          aria-describedby={keysError ? errId : undefined}
          placeholder="DB_HOST, DB_PORT, DB_PASSWORD"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
      )}
      <p className="text-caption text-muted">Requests for any other key are refused.</p>
      {keysError && (
        <p id={errId} className="text-caption font-medium text-bad">
          {keysError}
        </p>
      )}
    </fieldset>
  );
}

function OpsField({ idPrefix, register, error }: { idPrefix: string; register: UseFormRegisterReturn; error?: string }) {
  const errId = `${idPrefix}-ops-error`;
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5" aria-describedby={error ? errId : undefined}>
      <legend className="mb-1.5 p-0 text-body font-semibold text-ink">Allowed operations</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {OPS.map((op) => (
          <label key={op} className="flex items-center gap-2.5 text-ui font-normal max-md:min-h-(--control-touch)">
            <input type="checkbox" value={op} {...register} className="m-0 h-4 w-4 accent-accent" />
            {OP_LABEL[op]}
            <span className="font-mono text-mono-small text-muted">{op}</span>
          </label>
        ))}
      </div>
      <p className="text-caption text-muted">The request types members can submit for this secret.</p>
      {error && (
        <p id={errId} className="text-caption font-medium text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}
