/**
 * Create / edit form for a Policy. Rendered as a slide-out drawer
 * from the Policies list page.
 *
 * Selector dimensions (per BRD §17 / `policy_rules.selector`):
 *   - project_id          exact match
 *   - environment         exact match
 *   - provider_type       exact match (vault / aws-sm / gcp-sm / ...)
 *   - secret_ref_prefix   prefix match (e.g. "billing/")
 *
 * Empty selector keys are omitted from the submitted body so the
 * api treats them as wildcards (per its server-side semantics).
 *
 * Workflow_id is picked from a dropdown of all workflows so operators
 * never have to remember a UUID. The list comes via `useWorkflows()`
 * — same query key as the Workflows admin page, so navigating between
 * them doesn't refetch.
 */

import { useEffect } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Policy, PolicyInput } from '../../api/types';
import { ApiError } from '../../api/client';
import { useWorkflows } from '../../api/workflows';

const schema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  workflow_id: z.string().uuid('pick a workflow'),
  priority: z.coerce.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  sel_project_id: z.string().max(120).optional(),
  sel_environment: z.string().max(120).optional(),
  sel_provider_type: z.string().max(60).optional(),
  sel_secret_ref_prefix: z.string().max(255).optional(),
});

type FormShape = z.infer<typeof schema>;

interface Props {
  initial?: Policy;
  onSubmit: (body: PolicyInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
}

const defaults: FormShape = {
  name: '',
  workflow_id: '',
  priority: 100,
  enabled: true,
  sel_project_id: '',
  sel_environment: '',
  sel_provider_type: '',
  sel_secret_ref_prefix: '',
};

export function PolicyForm({ initial, onSubmit, onCancel, submitting, submitError }: Props) {
  const workflows = useWorkflows();

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
        workflow_id: initial.workflow_id,
        priority: initial.priority,
        enabled: initial.enabled,
        sel_project_id: initial.selector?.project_id ?? '',
        sel_environment: initial.selector?.environment ?? '',
        sel_provider_type: initial.selector?.provider_type ?? '',
        sel_secret_ref_prefix: initial.selector?.secret_ref_prefix ?? '',
      });
    } else {
      reset(defaults);
    }
  }, [initial, reset]);

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const selector: Record<string, string> = {};
    if (data.sel_project_id) selector.project_id = data.sel_project_id;
    if (data.sel_environment) selector.environment = data.sel_environment;
    if (data.sel_provider_type) selector.provider_type = data.sel_provider_type;
    if (data.sel_secret_ref_prefix) selector.secret_ref_prefix = data.sel_secret_ref_prefix;

    const body: PolicyInput = {
      name: data.name,
      workflow_id: data.workflow_id,
      priority: data.priority,
      enabled: data.enabled,
      selector,
    };
    await onSubmit(body);
  };

  return (
    <form onSubmit={handleSubmit(onValid)} className="space-y-4">
      {initial?.is_system && (
        <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2">
          This is a <strong>system seed</strong> policy — editable but cannot be deleted.
        </div>
      )}

      <Field label="Name" error={errors.name?.message}>
        <input
          type="text"
          {...register('name')}
          className={inputCls}
          placeholder="billing-prod-needs-two-approvers"
        />
      </Field>

      <Field label="Workflow" error={errors.workflow_id?.message}>
        <select {...register('workflow_id')} className={inputCls}>
          <option value="">— pick a workflow —</option>
          {workflows.data?.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.is_default ? ' (default)' : ''}
              {!w.enabled ? ' [disabled]' : ''}
            </option>
          ))}
        </select>
        {workflows.isError && (
          <div className="text-xs text-red-400">failed to load workflows</div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Priority" error={errors.priority?.message} hint="higher wins on overlap (seed = 0; operator default = 100)">
          <input type="number" {...register('priority')} className={inputCls} min={0} />
        </Field>
        <Field label="Enabled">
          <Toggle label="rule is active" {...register('enabled')} />
        </Field>
      </div>

      <fieldset className="border border-border rounded p-3 space-y-3">
        <legend className="text-xs text-muted px-1">
          Selector — keys present must match the request scope; empty = wildcard
        </legend>

        <Field label="project_id (exact)">
          <input type="text" {...register('sel_project_id')} className={inputCls} placeholder="billing" />
        </Field>

        <Field label="environment (exact)">
          <input type="text" {...register('sel_environment')} className={inputCls} placeholder="prod" />
        </Field>

        <Field label="provider_type (exact)">
          <input type="text" {...register('sel_provider_type')} className={inputCls} placeholder="vault | aws-sm | gcp-sm" />
        </Field>

        <Field label="secret_ref_prefix (prefix)">
          <input type="text" {...register('sel_secret_ref_prefix')} className={inputCls} placeholder="billing/" />
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
