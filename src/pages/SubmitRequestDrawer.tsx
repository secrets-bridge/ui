/**
 * Submit-request drawer — the form behind the `+ New request` CTA on
 * the Requests list. Carries both flow variants:
 *
 *   - **Read**  — request to VIEW one or more keys. The agent fetches
 *     and wraps them after approval; the dev reveals via the
 *     single-shot modal on the request detail page.
 *   - **Patch** — request to UPDATE one or more keys. The dev types
 *     the NEW values here; after approval the agent writes them to
 *     the provider.
 *
 * Hard rules (UI-side):
 *   - Patch value inputs are `type="password"` so they don't render
 *     in the DOM as plaintext + `autoComplete="new-password"` so the
 *     browser never offers to save them.
 *   - `key_values` is cleared from local component state immediately
 *     after the submit promise settles (success OR failure). Real
 *     plaintext hygiene also needs the React unmount cleanup we do
 *     when the drawer closes.
 *   - The form NEVER displays the typed value back — no preview
 *     section, no review-before-submit step.
 *   - Provider config is operator-pickable per provider type today
 *     (e.g. `kvMount: "secret"` for Vault, `region: "us-east-1"` for
 *     AWS SM). The UI just exposes a single common knob per provider
 *     to keep the form readable; advanced operators can still curl.
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm, useFieldArray, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import {
  useSubmitPatchRequest,
  useSubmitReadRequest,
} from '../api/requests';
import {
  useEnvironments,
  useMyProjects,
  useProjectSecrets,
} from '../api/tenancy';
import type { PatchRequestInput, ProjectSecretBinding, ReadRequestInput } from '../api/types';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { StatusPill } from '../ui/StatusPill';

type FlowType = 'read' | 'patch';

const PROVIDER_TYPES = [
  { value: 'vault', label: 'HashiCorp Vault' },
  { value: 'aws-sm', label: 'AWS Secrets Manager' },
  { value: 'gcp-sm', label: 'GCP Secret Manager' },
  { value: 'azure-kv', label: 'Azure Key Vault' },
] as const;

const PROVIDER_CONFIG_HINT: Record<string, string> = {
  vault: 'kvMount — leave blank for the KV v2 default `secret`',
  'aws-sm': 'region (e.g. `us-east-1`) — required',
  'gcp-sm': 'project (e.g. `my-gcp-project`) — required',
  'azure-kv': 'vault_name (the Azure Key Vault name) — required',
};

const schema = z.object({
  type: z.enum(['read', 'patch']),
  target_provider_type: z.string().min(1, 'provider required'),
  provider_config_value: z.string().max(255).optional(),
  target_secret_ref: z
    .string()
    .min(1, 'secret reference required')
    .max(500),
  project_id: z.string().optional(),
  environment: z.string().max(120).optional(),
  justification: z
    .string()
    .min(1, 'justification required')
    .max(1000),
  // Both arrays share the same field array under the hood; the type
  // toggle controls which one's contents are used at submit.
  keys: z
    .array(
      z.object({
        key: z.string(),
        value: z.string(),
      }),
    )
    .min(1, 'at least one key'),
});

type FormShape = z.infer<typeof schema>;

interface Props {
  requesterId: string;
  onClose: () => void;
  onCreated: (newId: string) => void;
}

export function SubmitRequestDrawer({
  requesterId,
  onClose,
  onCreated,
}: Props) {
  const projects = useMyProjects();
  const envs = useEnvironments();
  const submitRead = useSubmitReadRequest();
  const submitPatch = useSubmitPatchRequest();
  const { hasPermission } = useAuth();

  // Mode toggle. Default 'bound': the form drives provider type +
  // secret_ref from the caller's project_secrets bindings. 'free-form'
  // is the admin escape hatch for the onboarding case (no bindings
  // exist yet) or when the caller holds the perm globally. Admins
  // (team.edit holders) start on free-form by default since they're
  // usually the ones creating the first request against a new ref.
  const [mode, setMode] = useState<'bound' | 'free-form'>(
    hasPermission('team.edit') ? 'free-form' : 'bound',
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: 'read',
      target_provider_type: 'vault',
      provider_config_value: '',
      target_secret_ref: '',
      project_id: '',
      environment: '',
      justification: '',
      keys: [{ key: '', value: '' }],
    },
  });

  const flowType = watch('type') as FlowType;
  const providerType = watch('target_provider_type');
  const projectId = watch('project_id');
  const targetRef = watch('target_secret_ref');

  // When a project is picked, fetch its bindings so we can show
  // which keys are allowed on the target secret_ref. Submit-time gate
  // (api#43 Slice C) is the source of truth — this is just a hint so
  // the user doesn't get a surprise 403.
  const bindings = useProjectSecrets(projectId || undefined);
  const matchedBinding = bindings.data?.find(
    (b) =>
      b.secret?.secret_ref === targetRef.trim() &&
      b.secret?.provider_type === providerType,
  );

  // Bound-mode state: which binding the user picked from the dropdown.
  // Identified by secret_id within the project. When the user picks
  // one, we setValue() into the existing form fields so the rest of
  // the form (provider config + keys + submit body) keeps working
  // unchanged — bound mode is a UX overlay, not a parallel form path.
  const [boundSecretId, setBoundSecretId] = useState<string>('');
  const boundBinding: ProjectSecretBinding | undefined = useMemo(
    () => bindings.data?.find((b) => b.secret_id === boundSecretId),
    [bindings.data, boundSecretId],
  );

  // Apply the bound selection to the form fields. provider config is
  // tricky because the api stores it on the secret row (cluster_name,
  // labels) but not as a renderable config string; we don't try to
  // reconstruct it here. The agent's resolver chain picks up the right
  // config from chart values, so leaving provider_config_value empty is
  // safe — the bound flow doesn't need it on the wire.
  useEffect(() => {
    if (mode !== 'bound' || !boundBinding?.secret) return;
    setValue('target_provider_type', boundBinding.secret.provider_type);
    setValue('target_secret_ref', boundBinding.secret.secret_ref);
  }, [mode, boundBinding, setValue]);

  // Clear bound selection when project changes (the new project may
  // not have the same secret bound) or when the user flips to
  // free-form (so it doesn't silently re-apply on flip-back).
  useEffect(() => {
    setBoundSecretId('');
  }, [projectId, mode]);

  // When in bound mode, force the flow type to the first allowed op
  // on the picked binding so the form can't submit an op the api will
  // refuse at the gate. Falls back to 'read' when no binding picked.
  useEffect(() => {
    if (mode !== 'bound' || !boundBinding) return;
    const ops = boundBinding.allowed_ops ?? [];
    if (ops.length === 0) return;
    if (!ops.includes(flowType)) {
      // 'read' or 'patch' — pick whichever is in the binding.
      const next = (ops.includes('read') ? 'read' : 'patch') as FlowType;
      setValue('type', next);
    }
    // intentionally watching flowType so a user-driven flip away from
    // the allowed set immediately gets corrected; not adding the form
    // value as a setter dependency loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, boundBinding, flowType]);

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'keys',
  });

  // Best-effort plaintext hygiene: on drawer close, dump every typed
  // value from the form state. React Hook Form's reset clears its own
  // store; the field-array nodes also re-render with empty inputs.
  useEffect(() => {
    return () => reset();
  }, [reset]);

  const envNames = (() => {
    const set = new Set<string>();
    envs.data?.forEach((e) => set.add(e.name));
    return Array.from(set).sort();
  })();

  const onValid: SubmitHandler<FormShape> = async (data) => {
    // When the operator leaves the config blank, fall back to a
    // per-provider sensible default (matches the placeholder text).
    // Vault: `kvMount=secret` — KV v2 default. Other providers stay
    // unset so the agent fails loud rather than guessing a wrong
    // region / project.
    const rawConfig =
      data.provider_config_value?.trim() ||
      defaultProviderConfigValue(data.target_provider_type);
    const providerConfig: Record<string, string> | undefined = rawConfig
      ? buildProviderConfig(data.target_provider_type, rawConfig)
      : undefined;

    try {
      if (data.type === 'read') {
        const keys = data.keys.map((k) => k.key.trim()).filter(Boolean);
        const body: ReadRequestInput = {
          requester_id: requesterId,
          project_id: data.project_id || undefined,
          environment: data.environment || undefined,
          target_provider_type: data.target_provider_type,
          target_provider_config: providerConfig,
          target_secret_ref: data.target_secret_ref.trim(),
          target_keys: keys.length > 0 ? keys : undefined,
          justification: data.justification.trim(),
        };
        const created = await submitRead.mutateAsync(body);
        onCreated(created.id);
      } else {
        const key_values: Record<string, string> = {};
        for (const row of data.keys) {
          const k = row.key.trim();
          if (!k) continue;
          key_values[k] = row.value;
        }
        if (Object.keys(key_values).length === 0) {
          // Zod already enforces min(1) but guard the empty-after-trim case.
          return;
        }
        const body: PatchRequestInput = {
          requester_id: requesterId,
          project_id: data.project_id || undefined,
          environment: data.environment || undefined,
          target_provider_type: data.target_provider_type,
          target_provider_config: providerConfig,
          target_secret_ref: data.target_secret_ref.trim(),
          key_values,
          justification: data.justification.trim(),
        };
        try {
          const created = await submitPatch.mutateAsync(body);
          onCreated(created.id);
        } finally {
          // Drop the plaintext from local refs ASAP. The body object
          // goes out of scope after this catch, but explicitly clearing
          // makes intent obvious in review.
          for (const k of Object.keys(key_values)) {
            key_values[k] = '';
          }
        }
      }
    } catch {
      // Surface via the inline error block — RHF errors already
      // displayed on field-level issues; the mutation .error displays
      // below.
    }
  };

  const pending = submitRead.isPending || submitPatch.isPending;
  const apiError = (submitRead.error ?? submitPatch.error) as unknown;

  return (
    <Drawer
      wide
      title="New request"
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="submit-request-form"
            variant="primary"
            size="md"
            disabled={pending}
          >
            {pending ? 'Submitting…' : 'Submit'}
          </Button>
        </>
      }
    >
      <form
        id="submit-request-form"
        onSubmit={handleSubmit(onValid)}
        className="space-y-5"
      >
        {/* Type toggle */}
        <div>
          <label className="block text-xs text-muted font-medium uppercase tracking-wider mb-2">
            Type
          </label>
          <div className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border p-0.5">
            <FlowOption
              value="read"
              current={flowType}
              register={register('type')}
            >
              Read
            </FlowOption>
            <FlowOption
              value="patch"
              current={flowType}
              register={register('type')}
            >
              Patch
            </FlowOption>
          </div>
          <p className="text-[11px] text-muted/80 mt-2">
            {flowType === 'read'
              ? 'Request to VIEW key(s). The agent fetches and wraps them after approval; reveal via the single-shot modal on the request detail page.'
              : 'Request to UPDATE key(s). Type the new value(s) below — they are sent over TLS and wrapped server-side before they touch Postgres. The agent writes them after approval.'}
          </p>
        </div>

        {/* Target — bound vs free-form switcher */}
        <Section
          title="Target"
          aside={
            <div className="flex gap-1">
              <ModeChip
                on={mode === 'bound'}
                onClick={() => setMode('bound')}
                label="From my bindings"
              />
              <ModeChip
                on={mode === 'free-form'}
                onClick={() => setMode('free-form')}
                label="Free-form"
              />
            </div>
          }
        >
          {mode === 'bound' ? (
            <BoundTargetFields
              projects={projects.data ?? []}
              bindings={bindings.data ?? []}
              projectId={projectId ?? ''}
              registerProject={register('project_id')}
              boundSecretId={boundSecretId}
              onBoundSecretIdChange={setBoundSecretId}
            />
          ) : (
            <>
              <Field label="Provider type" error={errors.target_provider_type?.message}>
                <select {...register('target_provider_type')} className={inputCls}>
                  {PROVIDER_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Provider config"
                hint={PROVIDER_CONFIG_HINT[providerType] ?? 'optional knob'}
                error={errors.provider_config_value?.message}
              >
                <input
                  type="text"
                  {...register('provider_config_value')}
                  className={inputCls + ' font-mono'}
                  placeholder={providerType === 'vault' ? 'secret' : ''}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              <Field
                label="Secret reference"
                error={errors.target_secret_ref?.message}
                hint="The path or name the provider uses (no leading slash). E.g. `prod/db/password` for Vault or `prod/payments/stripe` for AWS SM."
              >
                <input
                  type="text"
                  {...register('target_secret_ref')}
                  className={inputCls + ' font-mono'}
                  placeholder="prod/db/password"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Project (optional)">
                  <select {...register('project_id')} className={inputCls}>
                    <option value="">(any)</option>
                    {projects.data
                      ?.filter((p) => p.status === 'active')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field label="Environment (optional)">
                  <input
                    list="submit-env-options"
                    {...register('environment')}
                    className={inputCls}
                    placeholder="uat"
                    autoComplete="off"
                  />
                  <datalist id="submit-env-options">
                    {envNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </Field>
              </div>
            </>
          )}

          {/* Pinned details under either mode */}
          {mode === 'bound' && boundBinding?.secret && (
            <div className="bg-bg/40 border border-border/60 rounded-lg p-3 space-y-1 text-[11px]">
              <div className="text-muted">
                Provider: <span className="text-accent font-mono">{boundBinding.secret.provider_type}</span>
                {' · '}
                Cluster: <span className="text-accent font-mono">{boundBinding.secret.cluster_name}</span>
              </div>
              <div className="text-muted">
                Ref: <span className="text-text font-mono break-all">{boundBinding.secret.secret_ref}</span>
              </div>
              <div className="text-muted">
                Allowed ops:{' '}
                {(boundBinding.allowed_ops ?? []).map((op) => (
                  <span key={op} className="font-mono text-accent mr-2">{op}</span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Keys */}
        <Section
          title="Keys"
          aside={
            flowType === 'patch' && (
              <StatusPill variant="warning" tone="outline">
                value-bearing
              </StatusPill>
            )
          }
        >
          {errors.keys && (
            <div className="text-xs text-red-300 mb-2">
              {errors.keys.message ?? 'at least one key'}
            </div>
          )}
          <ul className="space-y-2">
            {fields.map((row, i) => (
              <li
                key={row.id}
                className={
                  flowType === 'patch'
                    ? 'grid grid-cols-[1fr_1.4fr_auto] gap-2 items-start'
                    : 'grid grid-cols-[1fr_auto] gap-2 items-start'
                }
              >
                <input
                  type="text"
                  {...register(`keys.${i}.key`)}
                  className={inputCls + ' font-mono'}
                  placeholder={i === 0 ? 'DB_PASSWORD' : 'KEY_NAME'}
                  autoComplete="off"
                  spellCheck={false}
                />
                {flowType === 'patch' && (
                  <input
                    type="password"
                    {...register(`keys.${i}.value`)}
                    className={inputCls + ' font-mono'}
                    placeholder="new value (sent over TLS, wrapped server-side)"
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                )}
                <button
                  type="button"
                  onClick={() => remove(i)}
                  disabled={fields.length === 1}
                  className={
                    fields.length === 1
                      ? 'text-muted/30 cursor-not-allowed text-sm font-medium px-2 self-center'
                      : 'text-red-300 hover:text-red-200 text-sm font-medium px-2 self-center'
                  }
                  title={
                    fields.length === 1 ? 'At least one key required' : 'Remove'
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => append({ key: '', value: '' })}
            >
              + Add key
            </Button>
          </div>
          {flowType === 'read' && (
            <p className="text-[11px] text-muted/80 mt-2">
              Leave the list with one empty key to request the full bundle
              instead of specific keys.
            </p>
          )}

          {matchedBinding && matchedBinding.allowed_keys !== null && (
            <div className="mt-3 p-3 rounded-lg border border-accent/30 bg-accent/5">
              <div className="text-[11px] text-accent uppercase tracking-wider font-medium mb-1.5">
                Your keys for this secret
              </div>
              <div className="flex flex-wrap gap-1">
                {matchedBinding.allowed_keys.map((k) => (
                  <StatusPill key={k} variant="accent" tone="outline">
                    {k}
                  </StatusPill>
                ))}
              </div>
              <p className="text-[11px] text-muted/80 mt-2">
                The binding for this project limits you to these keys. Submit
                will return <span className="font-mono">out_of_scope_key</span>{' '}
                if you ask for anything else.
              </p>
            </div>
          )}
          {matchedBinding && matchedBinding.allowed_keys === null && (
            <p className="text-[11px] text-muted/80 mt-2">
              The binding for this project allows every key the secret carries.
            </p>
          )}
          {projectId && targetRef.trim() && !matchedBinding && !bindings.isLoading && (
            <div className="mt-3 p-3 rounded-lg border border-yellow-500/30 bg-yellow-500/5 text-yellow-200 text-[11px]">
              No binding for this secret in the selected project. Submit will
              return <span className="font-mono">out_of_scope_project</span>;
              ask an admin to bind the secret first.
            </div>
          )}
        </Section>

        {/* Justification */}
        <Section title="Justification">
          <textarea
            rows={3}
            {...register('justification')}
            className={inputCls}
            placeholder="What are you doing with this? Incident #, ticket, runbook link…"
          />
          {errors.justification && (
            <div className="text-xs text-red-300 mt-1">
              {errors.justification.message}
            </div>
          )}
        </Section>

        {apiError instanceof ApiError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
            {apiError.status}: {apiError.message}
          </div>
        )}
      </form>
    </Drawer>
  );
}

// --- shared bits ----------------------------------------------------

function FlowOption({
  value,
  current,
  register,
  children,
}: {
  value: FlowType;
  current: FlowType;
  register: ReturnType<ReturnType<typeof useForm<FormShape>>['register']>;
  children: React.ReactNode;
}) {
  const on = value === current;
  return (
    <label
      className={
        'px-4 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ' +
        (on
          ? 'bg-accent/20 text-accent-bright'
          : 'text-muted hover:text-text')
      }
    >
      <input
        type="radio"
        value={value}
        {...register}
        className="sr-only"
      />
      {children}
    </label>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border border-border/60 rounded-lg p-4 space-y-3">
      <legend className="text-[11px] text-muted uppercase tracking-wider px-1 font-medium flex items-center gap-2">
        {title}
        {aside}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && !error && (
        <div className="text-[11px] text-muted/80">{hint}</div>
      )}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
}

function ModeChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'px-2.5 py-1 text-[11px] rounded-full transition-colors ' +
        (on
          ? 'bg-accent/15 text-accent border border-accent/40'
          : 'bg-bg/40 text-muted border border-border hover:text-text')
      }
    >
      {label}
    </button>
  );
}

function BoundTargetFields({
  projects,
  bindings,
  projectId,
  registerProject,
  boundSecretId,
  onBoundSecretIdChange,
}: {
  projects: { id: string; name: string; status: 'active' | 'archived' }[];
  bindings: ProjectSecretBinding[];
  projectId: string;
  registerProject: ReturnType<ReturnType<typeof useForm<FormShape>>['register']>;
  boundSecretId: string;
  onBoundSecretIdChange: (id: string) => void;
}) {
  return (
    <>
      <Field
        label="Project"
        hint="Limited to the projects your role scope covers. If you don't see one you should have, ask an admin to grant it on /admin/assignments."
      >
        <select {...registerProject} className={inputCls}>
          <option value="">— pick a project —</option>
          {projects
            .filter((p) => p.status === 'active')
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </Field>

      {projectId && (
        <Field
          label="Bound secret"
          hint={
            bindings.length === 0
              ? 'This project has no secret bindings yet. Switch to free-form mode (an admin can bind one via /admin/projects → Secrets tab).'
              : 'Picking a binding auto-fills provider type + ref. Flow type below is gated to the binding’s allowed ops.'
          }
        >
          <select
            value={boundSecretId}
            onChange={(e) => onBoundSecretIdChange(e.target.value)}
            className={inputCls + ' font-mono'}
            disabled={bindings.length === 0}
          >
            <option value="">— pick a bound secret —</option>
            {bindings.map((b) => (
              <option key={b.secret_id} value={b.secret_id}>
                {b.secret?.secret_ref ?? b.secret_id}
                {b.secret?.provider_type ? ` (${b.secret.provider_type})` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}
    </>
  );
}

const inputCls =
  'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';

function defaultProviderConfigValue(providerType: string): string {
  // Vault's KV v2 default mount is `secret` — empty form input means
  // "use the default" rather than "send no config".
  if (providerType === 'vault') return 'secret';
  return '';
}

function buildProviderConfig(
  providerType: string,
  value: string,
): Record<string, string> {
  switch (providerType) {
    case 'vault':
      return { kvMount: value };
    case 'aws-sm':
      return { region: value };
    case 'gcp-sm':
      return { project: value };
    case 'azure-kv':
      return { vault_name: value };
    default:
      // Unknown provider — round-trip as a generic "config" entry so
      // it's at least visible to operators who curl.
      return { config: value };
  }
}
