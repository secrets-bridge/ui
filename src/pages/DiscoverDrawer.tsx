/**
 * Trigger discovery drawer (`Discover` button on /secrets).
 *
 * Wraps POST /api/v1/jobs with a `discover` job_type. The agent picks
 * the job up within ~5s, calls provider.ListMetadata(scope), POSTs
 * results to /agents/:id/secrets/bulk; the CP upserts into the
 * catalog. After ~5s the secrets query auto-invalidates so the user
 * sees the refreshed totals.
 *
 * Form shape mirrors the curl recipe we currently document:
 *
 *   {
 *     "job_type": "discover",
 *     "payload": {
 *       "target_provider_type": "aws-sm",
 *       "target_provider_config": {"region": "eu-central-1"},
 *       "label_selector": {"EnvironmentName": "E-Government-Uat"}
 *     }
 *   }
 *
 * Label selector entries are entered as `key:value`, comma-separated,
 * matching the /secrets filter strip's existing chip convention.
 */

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import {
  type DiscoverJobInput,
  useTriggerDiscovery,
} from '../api/secrets';
import { ApiError } from '../api/client';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';

const PROVIDER_TYPES = [
  { value: 'aws-sm', label: 'AWS Secrets Manager' },
  { value: 'vault', label: 'HashiCorp Vault' },
  { value: 'gcp-sm', label: 'GCP Secret Manager' },
  { value: 'azure-kv', label: 'Azure Key Vault' },
];

const schema = z.object({
  target_provider_type: z.string().min(1, 'pick a provider'),
  region: z.string().optional(),
  vault_address: z.string().optional(),
  vault_kv_mount: z.string().optional(),
  label_selector: z.string().optional(),
});

type Values = z.infer<typeof schema>;

export function DiscoverDrawer({ onClose }: { onClose: () => void }) {
  const trigger = useTriggerDiscovery();
  const [enqueuedId, setEnqueuedId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    setError,
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      target_provider_type: 'aws-sm',
      region: 'eu-central-1',
      vault_address: '',
      vault_kv_mount: 'secret',
      label_selector: '',
    },
  });

  const providerType = watch('target_provider_type');

  const onSubmit = async (v: Values) => {
    const config: Record<string, unknown> = {};
    if (v.region) config.region = v.region.trim();
    if (providerType === 'vault') {
      if (v.vault_address) config.address = v.vault_address.trim();
      if (v.vault_kv_mount) config.kvMount = v.vault_kv_mount.trim();
    }

    let label_selector: Record<string, string> | undefined;
    const csv = (v.label_selector ?? '').trim();
    if (csv) {
      label_selector = {};
      for (const pair of csv.split(',').map((s) => s.trim()).filter(Boolean)) {
        const [k, val] = pair.split(':');
        if (k && val) label_selector[k.trim()] = val.trim();
      }
    }

    const input: DiscoverJobInput = {
      target_provider_type: v.target_provider_type,
      target_provider_config: Object.keys(config).length > 0 ? config : undefined,
      label_selector,
    };
    try {
      const job = await trigger.mutateAsync(input);
      setEnqueuedId(job.id);
    } catch (e) {
      setError('root', {
        message: e instanceof ApiError ? e.message : (e as Error).message,
      });
    }
  };

  if (enqueuedId) {
    return (
      <Drawer title="Discovery queued" onClose={onClose}>
        <div className="space-y-3 text-sm">
          <p className="text-text">
            Job{' '}
            <span className="font-mono text-accent text-xs">{enqueuedId}</span>{' '}
            queued. An agent claims within about 5 seconds, calls the
            provider, and posts results back. The catalog will refresh
            automatically.
          </p>
          <p className="text-muted text-xs">
            If nothing changes within a minute, check that the agent
            pod has the provider's permissions configured (IRSA / Vault
            kubernetes auth).
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer title="Trigger discovery" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-xs text-muted">
          Enqueues a <span className="font-mono">discover</span> job. The
          first agent online that recognises the provider type picks it
          up.
        </p>

        <Field label="Provider type" error={errors.target_provider_type?.message}>
          <select
            {...register('target_provider_type')}
            className={inputCls}
          >
            {PROVIDER_TYPES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        {(providerType === 'aws-sm' || providerType === 'gcp-sm') && (
          <Field
            label="Region"
            hint={
              providerType === 'aws-sm'
                ? 'e.g. eu-central-1, us-east-1.'
                : 'e.g. global, europe-west1.'
            }
          >
            <input
              type="text"
              {...register('region')}
              className={inputCls + ' font-mono'}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        )}

        {providerType === 'vault' && (
          <>
            <Field
              label="Vault address"
              hint="The agent's cluster-internal address, not the public ingress. Leave blank to use the agent's SB_VAULT_ADDR env."
            >
              <input
                type="text"
                {...register('vault_address')}
                className={inputCls + ' font-mono'}
                placeholder="http://vault.vault.svc:8200"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="KV v2 mount" hint='Typically "secret".'>
              <input
                type="text"
                {...register('vault_kv_mount')}
                className={inputCls + ' font-mono'}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </>
        )}

        <Field
          label="Label selector"
          hint="Comma-separated key:value pairs. Maps to provider tags (AWS Tags, Vault custom_metadata). The agent's runtime filter drops anything that doesn't match every k:v."
        >
          <input
            type="text"
            {...register('label_selector')}
            className={inputCls + ' font-mono'}
            placeholder="EnvironmentName:E-Government-Uat, Team:billing"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        {errors.root?.message && (
          <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
            {errors.root.message}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={isSubmitting}>
            {isSubmitting ? 'Queuing…' : 'Trigger discovery'}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

// Local helpers — kept out of src/ui/ because they're trivial and
// only used here.

const inputCls =
  'w-full bg-bg/40 border border-border/60 rounded px-3 py-2 text-sm';

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
      <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {hint && <p className="text-xs text-muted mb-1">{hint}</p>}
      {children}
      {error && <p className="text-xs text-red-300 mt-1">{error}</p>}
    </div>
  );
}
