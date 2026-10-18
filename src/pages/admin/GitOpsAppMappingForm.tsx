/**
 * Create form for a GitOps app mapping.
 *
 * Create-only (the api has no update endpoint): to change a mapping,
 * delete and recreate it. A mapping ties one ArgoCD application to the
 * workload that consumes a secret, so the worker's gitops poller knows
 * which app to ask about after a request is executed.
 *
 * The api takes exactly one of `provider_connection_id` (the current
 * model) or `secret_mapping_id` (the legacy long-lived sync config). The
 * provider connection is picked from the admin list; the legacy id has
 * no admin page, so it stays a UUID field under "Use a legacy secret
 * mapping instead".
 *
 * Endpoints come from `useArgoCDEndpoints()` (shared cache with the
 * Integrations page). Disabled endpoints stay selectable and say so.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import { useArgoCDEndpoints } from '../../api/integrations';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import type { GitOpsAppMappingInput } from '../../api/types';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Field, Input, Select } from '../../ui/Field';

const schema = z
  .object({
    argocd_endpoint_id: z.guid('Choose an ArgoCD endpoint.'),
    application_name: z.string().trim().min(1, 'Enter the ArgoCD application name.').max(255, 'Use at most 255 characters.'),
    application_namespace: z.string().max(255, 'Use at most 255 characters.').optional(),
    project_name: z.string().max(255, 'Use at most 255 characters.').optional(),
    cluster_name: z.string().max(255, 'Use at most 255 characters.').optional(),
    secret_mapping_id: z.guid('A secret mapping id is a UUID.').optional().or(z.literal('')),
    provider_connection_id: z.guid('Choose a provider connection.').optional().or(z.literal('')),
  })
  .refine((d) => Boolean(d.secret_mapping_id) !== Boolean(d.provider_connection_id), {
    message: 'Choose a provider connection, or enter a legacy secret mapping id. Not both.',
    path: ['provider_connection_id'],
  });

type FormShape = z.infer<typeof schema>;

interface Props {
  formId: string;
  onSubmit: (body: GitOpsAppMappingInput) => Promise<unknown>;
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

export function GitOpsAppMappingForm({ formId, onSubmit, submitError }: Props) {
  const endpoints = useArgoCDEndpoints();
  const connections = useProviderConnectionsAdmin();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormShape>({ resolver: zodResolver(schema), defaultValues: defaults });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const body: GitOpsAppMappingInput = {
      argocd_endpoint_id: data.argocd_endpoint_id,
      application_name: data.application_name.trim(),
      application_namespace: data.application_namespace || undefined,
      project_name: data.project_name || undefined,
      cluster_name: data.cluster_name || undefined,
      secret_mapping_id: data.secret_mapping_id || undefined,
      provider_connection_id: data.provider_connection_id || undefined,
    };
    await onSubmit(body);
  };

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        // A failed create shows through `submitError`.
        handleSubmit(onValid)(e).catch(() => {});
      }}
      className="flex flex-col gap-[18px]"
    >
      <Field
        id="map-endpoint"
        label="ArgoCD endpoint"
        hint={
          endpoints.isError
            ? "Couldn't load the endpoints."
            : endpoints.data && endpoints.data.length === 0
              ? 'No endpoint yet. Add one in the section above first.'
              : undefined
        }
        error={errors.argocd_endpoint_id?.message}
      >
        {(p) => (
          <Select {...p} {...register('argocd_endpoint_id')} data-autofocus>
            <option value="">{endpoints.isLoading ? 'Loading endpoints…' : 'Choose an endpoint'}</option>
            {endpoints.data?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
                {!e.enabled ? ' (disabled)' : ''} · {e.base_url}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="map-app" label="Application name" error={errors.application_name?.message}>
        {(p) => <Input {...p} {...register('application_name')} placeholder="billing-api" className="font-mono" autoComplete="off" spellCheck={false} />}
      </Field>

      <div className="grid grid-cols-1 gap-3.5 min-[600px]:grid-cols-2">
        <Field id="map-ns" label="Application namespace (optional)" hint="Where the Application object lives; usually argocd." error={errors.application_namespace?.message}>
          {(p) => <Input {...p} {...register('application_namespace')} placeholder="argocd" className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field id="map-project" label="ArgoCD project (optional)" error={errors.project_name?.message}>
          {(p) => <Input {...p} {...register('project_name')} placeholder="default" className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
      </div>

      <Field id="map-cluster" label="Cluster name (optional)" hint="Shown next to the sync status on the request page." error={errors.cluster_name?.message}>
        {(p) => <Input {...p} {...register('cluster_name')} placeholder="prod-eu" className="font-mono" autoComplete="off" spellCheck={false} />}
      </Field>

      <Field
        id="map-connection"
        label="Provider connection"
        hint="The connection whose secrets this application consumes."
        error={errors.provider_connection_id?.message}
      >
        {(p) => (
          <Select {...p} {...register('provider_connection_id')}>
            <option value="">{connections.isLoading ? 'Loading connections…' : 'Choose a connection'}</option>
            {(connections.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {providerLabel(c.type)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <details className="rounded-md border border-border px-3.5 py-2.5">
        <summary className="cursor-pointer select-none text-ui font-medium text-ink">Use a legacy secret mapping instead</summary>
        <div className="mt-3">
          <Field
            id="map-secret-mapping"
            label="Secret mapping id"
            hint="Only for the older sync configuration, which has no page here. Leave the provider connection empty when you use this."
            error={errors.secret_mapping_id?.message}
          >
            {(p) => <Input {...p} {...register('secret_mapping_id')} placeholder="00000000-0000-0000-0000-000000000000" className="font-mono" autoComplete="off" spellCheck={false} />}
          </Field>
        </div>
      </details>

      {submitError != null && (
        <Banner tone="error" title="Not created.">
          {submitError instanceof ApiError ? `${submitError.status}: ${submitError.message}` : submitError instanceof Error ? submitError.message : String(submitError)}
        </Banner>
      )}
    </form>
  );
}
