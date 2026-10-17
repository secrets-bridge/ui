/**
 * Create form for an ArgoCD endpoint.
 *
 * Create-only by design: the api has no `PUT /argocd-endpoints/:id`
 * for the connection or token fields. After create, only the enabled
 * flag changes (`PUT .../enabled`), or the endpoint is deleted. To
 * change the URL, token or TLS settings, delete and recreate. This
 * keeps the write-once token honest.
 *
 * Token handling: the operator types the plaintext token; the form
 * encodes it as UTF-8 base64 (`token_b64`) just before the POST, and
 * the api envelope-encrypts it. The field is a password input, the
 * form is reset after a successful create, the encoded copy is blanked
 * in place, and the create mutation is a sensitive one (UI-N-02).
 *
 * The form renders no buttons; the drawer footer submits it through
 * `form={formId}`.
 */

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { z } from 'zod';

import { ApiError } from '../../api/client';
import type { ArgoCDEndpointInput } from '../../api/types';
import { encodeSecret } from '../../lib/decodeSecret';
import { Banner } from '../../ui/Banner';
import { Field, Input, Textarea } from '../../ui/Field';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120, 'Use at most 120 characters.'),
  base_url: z.url('Enter the full URL, for example https://argocd.example.com.').max(500, 'Use at most 500 characters.'),
  token: z.string().min(1, 'Paste the ArgoCD account token.'),
  tls_ca_pem: z.string().optional(),
  tls_server_name: z.string().max(255, 'Use at most 255 characters.').optional(),
  environment_id: z.guid('An environment id is a UUID. Leave it empty for every environment.').optional().or(z.literal('')),
});

type FormShape = z.infer<typeof schema>;

interface Props {
  formId: string;
  onSubmit: (body: ArgoCDEndpointInput) => Promise<unknown>;
  submitError?: unknown;
}

const defaults: FormShape = {
  name: '',
  base_url: '',
  token: '',
  tls_ca_pem: '',
  tls_server_name: '',
  environment_id: '',
};

export function ArgoCDEndpointForm({ formId, onSubmit, submitError }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormShape>({ resolver: zodResolver(schema), defaultValues: defaults });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const body: ArgoCDEndpointInput = {
      name: data.name.trim(),
      base_url: data.base_url,
      token_b64: encodeSecret(data.token),
      tls_ca_pem: data.tls_ca_pem || undefined,
      tls_server_name: data.tls_server_name || undefined,
      environment_id: data.environment_id || undefined,
    };
    try {
      await onSubmit(body);
      // Clear the form, token included, after a successful create. On a
      // failure the typed token stays so the operator can retry.
      reset(defaults);
    } finally {
      // `body` is the object the mutation held as its variables; blank
      // the encoded token in place either way (UI-N-02).
      body.token_b64 = '';
    }
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
      <Banner title="The token is set once.">
        After you create the endpoint you can only turn it on or off, or delete it. To rotate the token or change the address,
        delete it and add it again.
      </Banner>

      <Field id="argo-name" label="Name" error={errors.name?.message}>
        {(p) => <Input {...p} {...register('name')} placeholder="prod-eu" autoComplete="off" data-autofocus />}
      </Field>
      <Field id="argo-url" label="Base URL" error={errors.base_url?.message}>
        {(p) => <Input {...p} type="url" {...register('base_url')} placeholder="https://argocd.example.com" className="font-mono" autoComplete="off" spellCheck={false} />}
      </Field>
      <Field
        id="argo-token"
        label="ArgoCD account token"
        hint="Read-only access to applications is enough. Encrypted by the api before it is stored, and never shown again."
        error={errors.token?.message}
      >
        {(p) => <Input {...p} type="password" autoComplete="new-password" spellCheck={false} {...register('token')} className="font-mono" />}
      </Field>
      <Field
        id="argo-ca"
        label="TLS CA bundle (optional)"
        hint="Paste the PEM block when ArgoCD uses a private certificate authority."
        error={errors.tls_ca_pem?.message}
      >
        {(p) => <Textarea {...p} {...register('tls_ca_pem')} rows={4} className="font-mono text-mono" placeholder="-----BEGIN CERTIFICATE-----" spellCheck={false} />}
      </Field>
      <Field
        id="argo-sni"
        label="TLS server name (optional)"
        hint="Only when the certificate's name doesn't match the host in the base URL."
        error={errors.tls_server_name?.message}
      >
        {(p) => <Input {...p} {...register('tls_server_name')} className="font-mono" autoComplete="off" spellCheck={false} />}
      </Field>
      <Field
        id="argo-env"
        label="Environment id (optional)"
        hint="Limits this endpoint to one environment. Leave empty for every environment."
        error={errors.environment_id?.message}
      >
        {(p) => <Input {...p} {...register('environment_id')} className="font-mono" autoComplete="off" spellCheck={false} />}
      </Field>

      {submitError != null && (
        <Banner tone="error" title="Not created.">
          {submitError instanceof ApiError ? `${submitError.status}: ${submitError.message}` : submitError instanceof Error ? submitError.message : String(submitError)}
        </Banner>
      )}
    </form>
  );
}
