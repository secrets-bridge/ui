/**
 * Create / edit form for a provider connection (EPIC P §5).
 *
 *   - The provider type can't change after create; the edit form
 *     disables the select.
 *   - The scope block follows the type; the "never paste credentials"
 *     note is always visible above it.
 *   - Discovery: enable switch and interval (60 to 86400 seconds).
 *   - Status: active or disabled.
 *
 * The form renders no buttons: the drawer footer holds them and submits
 * through `form={formId}`. Stable api error codes map through
 * `providerConnectionErrorMessage` into an inline banner; never alert().
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import { authMethodLabel, authMethodsFor, defaultAuthMethodFor } from '../../api/providerAuthMethods';
import { extractProviderConnectionErrorCode, providerConnectionErrorMessage } from '../../api/providerConnections';
import type { ProviderConnection, ProviderConnectionInput } from '../../api/types';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Field, Input, Select, Textarea } from '../../ui/Field';

const PROVIDER_TYPES = ['vault', 'aws-sm', 'azure-kv', 'gcp-sm', 'kubernetes'] as const;

/**
 * Advisory scope-key hints. These MIRROR `scopeShapes` in the api's
 * internal/services/provider_connections.go: required keys first, then
 * optional. The backend rejects unknown keys outright, so a hint that
 * drifts from the validator sends operators straight into a 400. Keys
 * are case-sensitive server-side (projectID, tenantID).
 */
const SCOPE_HINTS: Record<string, string[]> = {
  vault: ['address', 'mount', 'namespace (optional)', 'kvPrefix (optional)'],
  'aws-sm': ['region', 'roleArn (optional)', 'endpoint (optional)'],
  'azure-kv': ['vaultName', 'tenantID (optional)'],
  'gcp-sm': ['projectID', 'endpoint (optional)'],
  kubernetes: ['context', 'namespace (optional)'],
};

const inputSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter a name.').max(120, 'Use at most 120 characters.'),
    type: z.string().min(1, 'Choose a provider.'),
    cluster_name: z.string().max(120, 'Use at most 120 characters.').optional().or(z.literal('')),
    description: z.string().max(500, 'Use at most 500 characters.').optional().or(z.literal('')),
    status: z.enum(['active', 'disabled']),
    scope_json: z
      .string()
      .min(1, 'Enter the scope as a JSON object, for example {}.')
      .refine((s) => {
        try {
          const v = JSON.parse(s);
          return v && typeof v === 'object' && !Array.isArray(v);
        } catch {
          return false;
        }
      }, 'This isn\'t a JSON object. Use {"key": "value"} form.'),
    auth_method: z.string().min(1, 'Choose how the agent authenticates.'),
    discover_enabled: z.boolean(),
    discover_interval_seconds: z
      .number({ error: 'Enter a number of seconds.' })
      .int('Use whole seconds.')
      .min(60, 'Use at least 60 seconds.')
      .max(86400, 'Use at most 86400 seconds (24 hours).'),
  })
  .superRefine((v, ctx) => {
    // Mirror of the backend's validateAuthMethod. Catches the case
    // where the type changed but a stale auth_method survived.
    const allowed = authMethodsFor(v.type);
    if (allowed.length > 0 && !allowed.includes(v.auth_method)) {
      ctx.addIssue({
        code: 'custom',
        path: ['auth_method'],
        message: `Not valid for ${providerLabel(v.type)}. Choose one of: ${allowed.join(', ')}.`,
      });
    }
  });

type FormShape = z.infer<typeof inputSchema>;

interface Props {
  /** Id of the <form>, for the submit button in the drawer footer. */
  formId: string;
  initial?: ProviderConnection;
  submitError: unknown;
  onSubmit: (input: ProviderConnectionInput) => Promise<void>;
}

export function ProviderConnectionForm({ formId, initial, submitError, onSubmit }: Props) {
  const editing = !!initial;
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(inputSchema),
    defaultValues: {
      name: initial?.name ?? '',
      type: initial?.type ?? 'vault',
      cluster_name: initial?.cluster_name ?? '',
      description: initial?.description ?? '',
      status: initial?.status ?? 'active',
      scope_json: JSON.stringify(initial?.scope ?? {}, null, 2),
      auth_method: initial?.auth_method ?? defaultAuthMethodFor(initial?.type ?? 'vault'),
      discover_enabled: initial?.discover_enabled ?? false,
      discover_interval_seconds: initial?.discover_interval_seconds ?? 3600,
    },
  });
  const type = watch('type');

  // Provider type drives which auth methods are legal. Preserve a
  // still-valid selection (so editing does not silently rewrite a
  // saved value) and repair one that the new type rejects.
  useEffect(() => {
    const allowed = authMethodsFor(type);
    if (allowed.length > 0 && !allowed.includes(getValues('auth_method'))) {
      setValue('auth_method', defaultAuthMethodFor(type));
    }
  }, [type, getValues, setValue]);

  const stableErr =
    submitError instanceof ApiError
      ? (providerConnectionErrorMessage(extractProviderConnectionErrorCode(submitError)) ??
        `${submitError.status}: ${submitError.message}`)
      : submitError instanceof Error
        ? submitError.message
        : undefined;

  const submit = handleSubmit(async (form) => {
    const scope = JSON.parse(form.scope_json) as Record<string, unknown>;
    // Send every field the form manages. A cleared cluster name or
    // description goes as "": PUT /provider-connections/:id keeps the
    // stored value for an absent key, so omitting it would not clear it.
    const body: ProviderConnectionInput = {
      name: form.name.trim(),
      type: form.type,
      cluster_name: form.cluster_name?.trim() ?? '',
      description: form.description?.trim() ?? '',
      status: form.status,
      scope,
      auth_method: form.auth_method,
      discover_enabled: form.discover_enabled,
      discover_interval_seconds: form.discover_interval_seconds,
    };
    await onSubmit(body);
  });

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        // A failed save is shown through `submitError`; don't leave an
        // unhandled rejection behind.
        submit(e).catch(() => {});
      }}
      className="flex flex-col gap-[18px]"
    >
      <fieldset className="flex min-w-0 flex-col gap-3.5">
        <legend className="mb-1 text-body font-semibold text-ink">Connection</legend>
        <Field id="pc-name" label="Name" error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="vault-prod-eu" autoComplete="off" data-autofocus />}
        </Field>
        <Field
          id="pc-type"
          label="Provider"
          hint={editing ? "The provider can't change after the connection is created." : undefined}
          error={errors.type?.message}
        >
          {(p) => (
            <Select {...p} {...register('type')} disabled={editing}>
              {PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t === 'kubernetes' ? 'Kubernetes Secret' : providerLabel(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="pc-cluster" label="Cluster name" hint="Needed for discovery. Agents for this connection report the same name." error={errors.cluster_name?.message}>
          {(p) => <Input {...p} {...register('cluster_name')} placeholder="prod-eu" className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field id="pc-description" label="Description (optional)" error={errors.description?.message}>
          {(p) => <Textarea {...p} {...register('description')} rows={2} maxLength={500} />}
        </Field>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3.5">
        <legend className="mb-1 text-body font-semibold text-ink">Scope</legend>
        <Banner title="Never paste tokens, access keys, passwords or other credentials here.">
          The agent signs in with its own workload identity. The api refuses keys and values that look like credentials.
        </Banner>
        <Field
          id="pc-scope"
          label="Scope (JSON)"
          hint={SCOPE_HINTS[type] ? `Keys for ${providerLabel(type)}: ${SCOPE_HINTS[type].join(', ')}.` : 'A JSON object of connection details for this provider.'}
          error={errors.scope_json?.message}
        >
          {(p) => <Textarea {...p} {...register('scope_json')} rows={7} className="font-mono text-mono" spellCheck={false} />}
        </Field>
        {/*
          auth_method is REQUIRED and the allowed values are fixed per
          provider type (`authMethodsByType` in the api). A blank value
          used to produce "auth_method is not allowed for this provider
          type", which misled: the field is required, not disallowed.
        */}
        <Field id="pc-auth" label="How the agent authenticates" error={errors.auth_method?.message}>
          {(p) => (
            <Select {...p} {...register('auth_method')}>
              {authMethodsFor(type).map((m) => (
                <option key={m} value={m}>
                  {authMethodLabel(m)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3.5">
        <legend className="mb-1 text-body font-semibold text-ink">Discovery</legend>
        <label className="flex items-center gap-2.5 text-ui font-normal">
          <input type="checkbox" {...register('discover_enabled')} className="h-4 w-4 accent-accent" />
          Discover secrets on a schedule
        </label>
        <Field
          id="pc-interval"
          label="Every (seconds)"
          hint="Between 60 and 86400. Scheduled discovery runs only when the connection is active and has a cluster name."
          error={errors.discover_interval_seconds?.message}
        >
          {(p) => <Input {...p} type="number" min={60} max={86400} {...register('discover_interval_seconds', { valueAsNumber: true })} className="w-40" />}
        </Field>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-body font-semibold text-ink">Status</legend>
        <div className="flex flex-wrap gap-4 text-ui font-normal">
          <label className="flex items-center gap-2">
            <input type="radio" value="active" {...register('status')} className="accent-accent" />
            Active
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" value="disabled" {...register('status')} className="accent-accent" />
            Disabled
          </label>
        </div>
        <p className="text-caption text-muted">A disabled connection stops scheduled discovery and refuses new agent enrollments.</p>
      </fieldset>

      {stableErr && (
        <Banner tone="error" title="Not saved.">
          {stableErr}
        </Banner>
      )}
    </form>
  );
}
