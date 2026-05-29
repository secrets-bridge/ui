/**
 * Create / edit form for a Workflow. Rendered as a slide-out drawer
 * from the Workflows list page.
 *
 * Validation via Zod: forces sane TTLs (positive) and a name. The
 * server rejects bad input too — this is for fast feedback.
 *
 * `is_system` workflows are editable (per the api side semantics);
 * only name + description + behavior fields are locked into a
 * "system seed" warning so an operator doesn't accidentally rename
 * the default.
 */

import { useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Workflow, WorkflowInput } from '../../api/types';
import { ApiError } from '../../api/client';

const schema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  description: z.string().max(500).optional(),
  min_approvers: z.coerce.number().int().min(0).max(20),
  wrap_ttl_created_seconds: z.coerce.number().int().positive(),
  wrap_ttl_approved_seconds: z.coerce.number().int().positive(),
  wrap_ttl_claimed_seconds: z.coerce.number().int().positive(),
  request_ttl_seconds: z.coerce.number().int().positive(),
  require_justification: z.boolean(),
  allow_self_approval: z.boolean(),
  notification_channels_csv: z.string().optional(),
  enabled: z.boolean(),
});

type FormShape = z.infer<typeof schema>;

interface Props {
  initial?: Workflow;
  onSubmit: (body: WorkflowInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
}

const defaults: FormShape = {
  name: '',
  description: '',
  min_approvers: 1,
  wrap_ttl_created_seconds: 7 * 24 * 3600,
  wrap_ttl_approved_seconds: 3600,
  wrap_ttl_claimed_seconds: 300,
  request_ttl_seconds: 7 * 24 * 3600,
  require_justification: true,
  allow_self_approval: false,
  notification_channels_csv: '',
  enabled: true,
};

export function WorkflowForm({ initial, onSubmit, onCancel, submitting, submitError }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (initial) {
      reset({
        name: initial.name,
        description: initial.description ?? '',
        min_approvers: initial.min_approvers,
        wrap_ttl_created_seconds: initial.wrap_ttl_created_seconds,
        wrap_ttl_approved_seconds: initial.wrap_ttl_approved_seconds,
        wrap_ttl_claimed_seconds: initial.wrap_ttl_claimed_seconds,
        request_ttl_seconds: initial.request_ttl_seconds,
        require_justification: initial.require_justification,
        allow_self_approval: initial.allow_self_approval,
        notification_channels_csv: (initial.notification_channels ?? []).join(', '),
        enabled: initial.enabled,
      });
    } else {
      reset(defaults);
    }
  }, [initial, reset]);

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const channels =
      data.notification_channels_csv
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    const body: WorkflowInput = {
      name: data.name,
      description: data.description || undefined,
      min_approvers: data.min_approvers,
      wrap_ttl_created_seconds: data.wrap_ttl_created_seconds,
      wrap_ttl_approved_seconds: data.wrap_ttl_approved_seconds,
      wrap_ttl_claimed_seconds: data.wrap_ttl_claimed_seconds,
      request_ttl_seconds: data.request_ttl_seconds,
      require_justification: data.require_justification,
      allow_self_approval: data.allow_self_approval,
      notification_channels: channels,
      enabled: data.enabled,
    };
    await onSubmit(body);
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      {initial?.is_system && (
        <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2">
          This is a <strong>system seed</strong> workflow — editable but cannot be deleted.
        </div>
      )}

      <Field label="Name" error={errors.name?.message}>
        <input type="text" {...register('name')} className={inputCls} placeholder="standard" />
      </Field>

      <Field label="Description" error={errors.description?.message}>
        <input type="text" {...register('description')} className={inputCls} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Min approvers" error={errors.min_approvers?.message}>
          <input type="number" {...register('min_approvers')} className={inputCls} min={0} />
        </Field>
        <Field label="Notification channels (comma-separated)">
          <input type="text" {...register('notification_channels_csv')} className={inputCls} placeholder="slack, email" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Wrap TTL created (s)" error={errors.wrap_ttl_created_seconds?.message}>
          <input type="number" {...register('wrap_ttl_created_seconds')} className={inputCls} />
        </Field>
        <Field label="Wrap TTL approved (s)" error={errors.wrap_ttl_approved_seconds?.message}>
          <input type="number" {...register('wrap_ttl_approved_seconds')} className={inputCls} />
        </Field>
        <Field label="Wrap TTL claimed (s)" error={errors.wrap_ttl_claimed_seconds?.message}>
          <input type="number" {...register('wrap_ttl_claimed_seconds')} className={inputCls} />
        </Field>
        <Field label="Request TTL (s)" error={errors.request_ttl_seconds?.message}>
          <input type="number" {...register('request_ttl_seconds')} className={inputCls} />
        </Field>
      </div>

      <div className="space-y-2">
        <Toggle label="Require justification" {...register('require_justification')} />
        <Toggle label="Allow self-approval" {...register('allow_self_approval')} />
        <Toggle label="Enabled" {...register('enabled')} />
      </div>

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
          {submitting ? 'Saving…' : initial ? 'Save' : 'Create'}
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
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted">{label}</label>
      {children}
      {error && <div className="text-xs text-red-400">{error}</div>}
    </div>
  );
}

// react-hook-form register() returns `name` on the props; the input has to
// forward it. For a checkbox we just delegate to a regular input.
type ToggleProps = {
  label: string;
  name: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: React.FocusEvent<HTMLInputElement>) => void;
  ref?: React.Ref<HTMLInputElement>;
};
function Toggle({ label, ...rest }: ToggleProps) {
  return (
    <label className="flex items-center gap-2 text-sm text-text cursor-pointer">
      <input type="checkbox" {...rest} className="h-4 w-4 accent-accent" />
      {label}
    </label>
  );
}
