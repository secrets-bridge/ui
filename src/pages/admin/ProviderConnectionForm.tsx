/**
 * Create / Edit drawer for a Provider Connection. EPIC P §5 lock:
 *
 *   - type IMMUTABLE post-create; the edit form disables the select.
 *   - name editable.
 *   - per-type scope block re-renders on type change; "Never paste
 *     tokens or credentials here" notice is ALWAYS visible above.
 *   - discovery panel: enable toggle, interval (60–86400), discover-now
 *     CTA (only when status=active + cluster_name set).
 *   - status: active / disabled radio.
 *
 * 19 stable error codes from §6.A are mapped via
 * `providerConnectionErrorMessage`. Inline red banner; never alert().
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import {
  extractProviderConnectionErrorCode,
  providerConnectionErrorMessage,
  useDiscoverNow,
} from '../../api/providerConnections';
import type {
  ProviderConnection,
  ProviderConnectionInput,
} from '../../api/types';
import { Button } from '../../ui/Button';

/** Known provider type → human label + scope key shape (advisory only). */
const PROVIDER_TYPES = [
  { value: 'vault', label: 'HashiCorp Vault' },
  { value: 'aws-sm', label: 'AWS Secrets Manager' },
  { value: 'azure-kv', label: 'Azure Key Vault' },
  { value: 'gcp-sm', label: 'GCP Secret Manager' },
  { value: 'k8s', label: 'Kubernetes Secret' },
] as const;

const SCOPE_HINTS: Record<string, string[]> = {
  vault: ['address', 'kvMount', 'kvPrefix (optional)', 'namespace (optional)'],
  'aws-sm': ['region', 'roleArn (optional)', 'endpoint (optional)'],
  'azure-kv': ['vaultName', 'tenantId', 'clientId'],
  'gcp-sm': ['projectId', 'serviceAccount (optional)'],
  k8s: ['namespace (optional)'],
};

const inputSchema = z.object({
  name: z.string().min(1, 'Required').max(120, 'Too long'),
  type: z.string().min(1, 'Required'),
  cluster_name: z.string().max(120).optional().or(z.literal('')),
  description: z.string().max(500, 'Max 500 characters').optional().or(z.literal('')),
  status: z.enum(['active', 'disabled']),
  scope_json: z
    .string()
    .min(1, 'Required')
    .refine((s) => {
      try {
        const v = JSON.parse(s);
        return v && typeof v === 'object' && !Array.isArray(v);
      } catch {
        return false;
      }
    }, 'Must be a JSON object'),
  auth_method: z.string().max(60).optional().or(z.literal('')),
  discover_enabled: z.boolean(),
  discover_interval_seconds: z
    .number({ invalid_type_error: 'Must be a number' })
    .int()
    .min(60, 'Min 60 seconds')
    .max(86400, 'Max 86400 seconds'),
});

type FormShape = z.infer<typeof inputSchema>;

interface Props {
  initial?: ProviderConnection;
  submitting: boolean;
  submitError: unknown;
  onSubmit: (input: ProviderConnectionInput) => Promise<void>;
  onCancel: () => void;
}

export function ProviderConnectionForm({
  initial,
  submitting,
  submitError,
  onSubmit,
  onCancel,
}: Props) {
  const editing = !!initial;
  const {
    register,
    control,
    handleSubmit,
    watch,
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
      auth_method: initial?.auth_method ?? '',
      discover_enabled: initial?.discover_enabled ?? false,
      discover_interval_seconds: initial?.discover_interval_seconds ?? 3600,
    },
  });
  const type = watch('type');

  const stableErr =
    submitError instanceof ApiError
      ? providerConnectionErrorMessage(
          extractProviderConnectionErrorCode(submitError),
        ) ?? `${submitError.status} · ${submitError.message}`
      : submitError instanceof Error
        ? submitError.message
        : undefined;

  const submit = handleSubmit(async (form) => {
    const scope = JSON.parse(form.scope_json) as Record<string, unknown>;
    const body: ProviderConnectionInput = {
      name: form.name.trim(),
      type: form.type,
      cluster_name: form.cluster_name?.trim() || undefined,
      description: form.description?.trim() || undefined,
      status: form.status,
      scope,
      auth_method: form.auth_method?.trim() || undefined,
      discover_enabled: form.discover_enabled,
      discover_interval_seconds: form.discover_interval_seconds,
    };
    await onSubmit(body);
  });

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-3 py-2 text-xs text-yellow-200">
        <span className="font-semibold">Never paste tokens, access keys,
          passwords, or other credentials</span> in the scope below. The agent
        authenticates with its own workload identity. Credential-shaped keys
        and secret-shaped values are refused server-side.
      </div>

      <Section title="Connection">
        <Field label="Name" hint={errors.name?.message}>
          <input
            type="text"
            {...register('name')}
            placeholder="vault-prod-eu"
            className={inputCls(errors.name)}
          />
        </Field>
        <Field label="Type" hint={errors.type?.message}>
          <select
            {...register('type')}
            disabled={editing}
            title={editing ? 'Type is immutable after creation.' : undefined}
            className={selectCls(errors.type) + (editing ? ' opacity-60 cursor-not-allowed' : '')}
          >
            {PROVIDER_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Cluster name" hint={errors.cluster_name?.message ?? 'Required when discovery is enabled.'}>
          <input
            type="text"
            {...register('cluster_name')}
            placeholder="prod-eu"
            className={inputCls(errors.cluster_name)}
          />
        </Field>
        <Field label="Description" hint={errors.description?.message ?? 'Max 500 characters.'}>
          <textarea
            rows={2}
            {...register('description')}
            className={inputCls(errors.description)}
          />
        </Field>
      </Section>

      <Section title="Scope (metadata only)">
        <p className="text-muted text-xs">
          {SCOPE_HINTS[type]
            ? `Expected keys for ${type}: ${SCOPE_HINTS[type].join(', ')}`
            : 'JSON object. Provider-specific connection metadata.'}
        </p>
        <Field label="Scope JSON" hint={errors.scope_json?.message}>
          <textarea
            rows={8}
            {...register('scope_json')}
            className={inputCls(errors.scope_json) + ' font-mono text-xs'}
            spellCheck={false}
          />
        </Field>
        <Field label="Auth method" hint={errors.auth_method?.message ?? 'Optional provider-specific hint (e.g. kubernetes).'}>
          <input
            type="text"
            {...register('auth_method')}
            className={inputCls(errors.auth_method)}
          />
        </Field>
      </Section>

      <Section title="Discovery">
        <Field label="Enable discovery" hint="Periodic discover jobs are scheduled when enabled + cluster name is set.">
          <Controller
            name="discover_enabled"
            control={control}
            render={({ field }) => (
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                />
                <span className="text-text">Enabled</span>
              </label>
            )}
          />
        </Field>
        <Field
          label="Interval (seconds)"
          hint={errors.discover_interval_seconds?.message ?? 'Between 60 and 86400.'}
        >
          <input
            type="number"
            min={60}
            max={86400}
            {...register('discover_interval_seconds', { valueAsNumber: true })}
            className={inputCls(errors.discover_interval_seconds)}
          />
        </Field>
      </Section>

      <Section title="Status">
        <div className="flex items-center gap-4 text-sm">
          {(['active', 'disabled'] as const).map((s) => (
            <label key={s} className="inline-flex items-center gap-2">
              <input type="radio" value={s} {...register('status')} />
              <span className="text-text capitalize">{s}</span>
            </label>
          ))}
        </div>
      </Section>

      {initial && initial.status === 'active' && initial.cluster_name && (
        <DiscoverNowPanel connection={initial} />
      )}

      {stableErr && (
        <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 text-sm text-red-200">
          {stableErr}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
        <Button variant="secondary" size="md" onClick={onCancel} type="button">
          Cancel
        </Button>
        <Button variant="primary" size="md" type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : editing ? 'Save changes' : 'Create connection'}
        </Button>
      </div>
    </form>
  );
}

function DiscoverNowPanel({ connection }: { connection: ProviderConnection }) {
  const discover = useDiscoverNow(connection.id);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(
    null,
  );
  const onClick = async () => {
    setToast(null);
    try {
      await discover.mutateAsync();
      setToast({ kind: 'ok', msg: 'Discover job enqueued.' });
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? providerConnectionErrorMessage(
              extractProviderConnectionErrorCode(err),
            ) ?? `${err.status} · ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      setToast({ kind: 'err', msg });
    }
  };
  return (
    <Section title="Run discovery">
      <div className="flex items-center gap-3 flex-wrap">
        <Button
          variant="secondary"
          size="md"
          type="button"
          onClick={() => void onClick()}
          disabled={discover.isPending}
        >
          {discover.isPending ? 'Enqueuing…' : 'Discover now'}
        </Button>
        {toast && (
          <span
            className={
              toast.kind === 'ok' ? 'text-green-300 text-xs' : 'text-red-300 text-xs'
            }
          >
            {toast.msg}
          </span>
        )}
      </div>
    </Section>
  );
}

// --- input helpers -------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-text font-semibold text-sm uppercase tracking-wider">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
          {label}
        </label>
        {hint && <span className="text-[11px] text-muted">{hint}</span>}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function inputCls(err: unknown): string {
  const base =
    'w-full bg-bg border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:ring-1';
  return err
    ? `${base} border-red-500/50 focus:border-red-400 focus:ring-red-400/40`
    : `${base} border-border focus:border-accent focus:ring-accent/40`;
}

function selectCls(err: unknown): string {
  return inputCls(err);
}
