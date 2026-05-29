/**
 * Create form for a GitOps app mapping.
 *
 * Create-only (api has no update endpoint). To change a mapping,
 * delete + recreate. Mappings bind one ArgoCD application to the
 * platform's notion of "this workload consumes secret X" so the
 * worker's gitops-poller knows which app to query after a request
 * transitions to `executed`.
 *
 * Endpoint dropdown is hydrated from `useArgoCDEndpoints()` (the
 * Integrations page's own list query — cache shared, no extra fetch).
 * Disabled endpoints are still selectable but flagged in the label
 * so operators see them.
 */

import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { GitOpsAppMappingInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { useArgoCDEndpoints } from '../../api/integrations';

const schema = z
  .object({
    argocd_endpoint_id: z.string().uuid('pick an endpoint'),
    application_name: z.string().min(1, 'application_name is required').max(255),
    application_namespace: z.string().max(255).optional(),
    project_name: z.string().max(255).optional(),
    cluster_name: z.string().max(255).optional(),
    // The api accepts EITHER secret_mapping_id OR provider_connection_id
    // (not both, not neither). secret_mappings is a legacy long-lived
    // source↔dest sync config; provider_connections is the newer model.
    // Neither has a real admin UI yet, so operators paste a UUID from
    // the database for now — friction documented in the field hints.
    secret_mapping_id: z.string().uuid().optional().or(z.literal('')),
    provider_connection_id: z.string().uuid().optional().or(z.literal('')),
  })
  .refine(
    (d) =>
      Boolean(d.secret_mapping_id) !== Boolean(d.provider_connection_id),
    {
      message: 'set exactly one of secret_mapping_id or provider_connection_id',
      path: ['secret_mapping_id'],
    },
  );

type FormShape = z.infer<typeof schema>;

interface Props {
  onSubmit: (body: GitOpsAppMappingInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
}

const defaults: FormShape = {
  argocd_endpoint_id: '',
  application_name: '',
  application_namespace: '',
  project_name: '',
  cluster_name: '',
  secret_mapping_id: '',
  provider_connection_id: '',
};

export function GitOpsAppMappingForm({ onSubmit, onCancel, submitting, submitError }: Props) {
  const endpoints = useArgoCDEndpoints();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const body: GitOpsAppMappingInput = {
      argocd_endpoint_id: data.argocd_endpoint_id,
      application_name: data.application_name,
      application_namespace: data.application_namespace || undefined,
      project_name: data.project_name || undefined,
      cluster_name: data.cluster_name || undefined,
      secret_mapping_id: data.secret_mapping_id || undefined,
      provider_connection_id: data.provider_connection_id || undefined,
    };
    await onSubmit(body);
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <Field label="ArgoCD endpoint" error={errors.argocd_endpoint_id?.message}>
        <select {...register('argocd_endpoint_id')} className={inputCls}>
          <option value="">— pick an endpoint —</option>
          {endpoints.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
              {!e.enabled ? ' [disabled]' : ''} ({e.base_url})
            </option>
          ))}
        </select>
        {endpoints.isError && (
          <div className="text-xs text-red-400">failed to load endpoints</div>
        )}
        {endpoints.data && endpoints.data.length === 0 && !endpoints.isLoading && (
          <div className="text-xs text-yellow-300">No endpoints registered yet — create one in the section above first.</div>
        )}
      </Field>

      <Field label="Application name" error={errors.application_name?.message}>
        <input type="text" {...register('application_name')} className={inputCls} placeholder="billing-api" />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Application namespace" error={errors.application_namespace?.message} hint="argocd namespace; default `argocd`">
          <input type="text" {...register('application_namespace')} className={inputCls} placeholder="argocd" />
        </Field>
        <Field label="Project" error={errors.project_name?.message}>
          <input type="text" {...register('project_name')} className={inputCls} placeholder="default" />
        </Field>
      </div>

      <Field label="Cluster name" error={errors.cluster_name?.message} hint="Optional — for display in the observation panel.">
        <input type="text" {...register('cluster_name')} className={inputCls} placeholder="prod-eu" />
      </Field>

      <fieldset className="border border-border rounded p-3 space-y-3">
        <legend className="text-xs text-muted px-1">Binding — set exactly one</legend>
        <div className="text-[11px] text-muted/80">
          Until provider-connections admin lands, paste a UUID from <code>secret_mappings.id</code> or <code>provider_connections.id</code> via psql. The api rejects the create if neither (or both) is set.
        </div>

        <Field label="secret_mapping_id (UUID)" error={errors.secret_mapping_id?.message}>
          <input type="text" {...register('secret_mapping_id')} className={inputCls} placeholder="00000000-0000-0000-0000-000000000000" />
        </Field>

        <Field label="provider_connection_id (UUID)" error={errors.provider_connection_id?.message}>
          <input type="text" {...register('provider_connection_id')} className={inputCls} placeholder="00000000-0000-0000-0000-000000000000" />
        </Field>
      </fieldset>

      {submitError instanceof ApiError && (
        <div className="text-xs text-red-300 bg-red-400/10 border border-red-400/30 rounded px-3 py-2">
          {submitError.status}: {submitError.message}
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-border">
        <button
          type="submit"
          disabled={submitting}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Create mapping'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-muted hover:text-text px-3 py-2 rounded border border-border"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const inputCls =
  'w-full bg-bg border border-border rounded px-3 py-2 text-text text-sm focus:outline-none focus:border-accent';

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted">{label}</label>
      {children}
      {hint && !error && <div className="text-[11px] text-muted/80">{hint}</div>}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}
