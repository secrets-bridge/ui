/**
 * Create form for an ArgoCD endpoint.
 *
 * Create-only by design: the api exposes no `PUT /argocd-endpoints/:id`
 * for the connection / token fields. The only post-create mutation is
 * `PUT /argocd-endpoints/:id/enabled` (toggle on the list row) and
 * `DELETE`. To change the base URL, token, or TLS settings, delete +
 * recreate. This keeps the write-once token posture honest.
 *
 * Token handling: the operator types the plaintext ArgoCD token; the
 * form base64-encodes it client-side before POSTing as `token_b64`.
 * The api envelope-encrypts before persisting. The token field uses
 * `type=password` so on-screen capture is masked, and the value is
 * cleared from form state immediately after successful submission.
 */

import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { ArgoCDEndpointInput } from '../../api/types';
import { ApiError } from '../../api/client';

const schema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  base_url: z
    .string()
    .url('base_url must be a full URL (https://argocd.example.com)')
    .max(500),
  token: z.string().min(1, 'token is required'),
  tls_ca_pem: z.string().optional(),
  tls_server_name: z.string().max(255).optional(),
  environment_id: z
    .string()
    .uuid('environment_id must be a UUID if set')
    .optional()
    .or(z.literal('')),
});

type FormShape = z.infer<typeof schema>;

interface Props {
  onSubmit: (body: ArgoCDEndpointInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
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

export function ArgoCDEndpointForm({ onSubmit, onCancel, submitting, submitError }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const body: ArgoCDEndpointInput = {
      name: data.name,
      base_url: data.base_url,
      token_b64: btoa(data.token),
      tls_ca_pem: data.tls_ca_pem || undefined,
      tls_server_name: data.tls_server_name || undefined,
      environment_id: data.environment_id || undefined,
    };
    await onSubmit(body);
    // Best-effort plaintext hygiene: clear the form (including the
    // token field) after the submit promise settles. Memory still has
    // ephemeral copies until GC, but the form-state shape no longer
    // holds it.
    reset(defaults);
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2">
        The ArgoCD token is set <strong>once</strong>. After create, only the <code>enabled</code> flag is mutable. To rotate the token or change connection settings, delete and recreate.
      </div>

      <Field label="Name" error={errors.name?.message}>
        <input
          type="text"
          {...register('name')}
          className={inputCls}
          placeholder="prod-eu"
        />
      </Field>

      <Field label="Base URL" error={errors.base_url?.message}>
        <input
          type="url"
          {...register('base_url')}
          className={inputCls}
          placeholder="https://argocd.example.com"
        />
      </Field>

      <Field
        label="ArgoCD account token"
        error={errors.token?.message}
        hint="Plaintext token; base64-encoded before POST. Envelope-encrypted at the api before storage."
      >
        <input
          type="password"
          autoComplete="new-password"
          {...register('token')}
          className={inputCls}
        />
      </Field>

      <Field
        label="TLS CA bundle (PEM)"
        error={errors.tls_ca_pem?.message}
        hint="Optional. Paste the PEM block when the ArgoCD instance uses a private CA."
      >
        <textarea {...register('tls_ca_pem')} rows={4} className={inputCls + ' font-mono'} placeholder="-----BEGIN CERTIFICATE-----" />
      </Field>

      <Field
        label="TLS server name (SNI override)"
        error={errors.tls_server_name?.message}
        hint="Optional. Only needed if the cert's CN/SAN doesn't match the host in base_url."
      >
        <input type="text" {...register('tls_server_name')} className={inputCls} />
      </Field>

      <Field
        label="Environment ID"
        error={errors.environment_id?.message}
        hint="Optional UUID — narrows this endpoint to a single environment row when set."
      >
        <input type="text" {...register('environment_id')} className={inputCls} placeholder="(empty = all environments)" />
      </Field>

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
          {submitting ? 'Saving…' : 'Create endpoint'}
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
