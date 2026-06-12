/**
 * Create / edit form for a Policy. Rendered as a slide-out drawer
 * from the Policies list page.
 *
 * Selector dimensions (per BRD §17 / `policy_rules.selector`):
 *   - project_id          exact match
 *   - environment         exact match
 *   - provider_type       exact match — picked from the backend-owned
 *                         enum (api#139). Blank = wildcard (field omitted).
 *   - secret_ref_prefix   prefix match (e.g. "billing/")
 *
 * Empty selector keys are omitted from the submitted body so the
 * api treats them as wildcards (per its server-side semantics). The
 * `provider_type` dropdown's blank option MUST omit the key — never
 * submit `provider_type: ""` (the server rejects it as
 * provider_type_invalid).
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
import {
  POLICY_SELECTOR_PROVIDER_TYPES,
  POLICY_SELECTOR_OPERATIONS,
} from '../../api/policySelectorEnums';
import { useTeams } from '../../api/teams';
import { useWorkflows } from '../../api/workflows';
import { usePlatformReservedPriority } from '../../api/platformSettings';

const schema = z.object({
  name: z.string().min(1, 'name is required').max(120),
  workflow_id: z.string().uuid('pick a workflow'),
  priority: z.coerce.number().int().min(0).max(10_000),
  enabled: z.boolean(),
  // R-follow-up #3 (api#127) — anchor picker. Mutually exclusive at
  // the server side; the form enforces "exactly one" client-side
  // via the radio group.
  anchor: z.enum(['platform', 'project', 'team']),
  project_id: z.string().optional(),
  team_id: z.string().optional(),
  sel_project_id: z.string().max(120).optional(),
  sel_environment: z.string().max(120).optional(),
  sel_provider_type: z.string().max(60).optional(),
  sel_operation: z.string().max(60).optional(),
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
  anchor: 'platform',
  project_id: '',
  team_id: '',
  sel_project_id: '',
  sel_environment: '',
  sel_provider_type: '',
  sel_operation: '',
  sel_secret_ref_prefix: '',
};

export function PolicyForm({ initial, onSubmit, onCancel, submitting, submitError }: Props) {
  const workflows = useWorkflows();
  const teams = useTeams();
  const reservedPriority = usePlatformReservedPriority();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    // QA P0-1: surface required-field errors (notably workflow_id) as
    // soon as a field is touched, instead of only on the first submit —
    // so an unsatisfiable Create never looks like a silent dead button.
    mode: 'onTouched',
  });

  const anchor = watch('anchor');
  const priority = watch('priority');

  // QA P0-1: with no workflow selectable, the required workflow_id can
  // never validate and Create silently no-ops. Detect the empty/loading
  // list so we can disable Create + explain why.
  const noWorkflows = !workflows.isLoading && (workflows.data?.length ?? 0) === 0;

  // Admin reserved-band notice (author-scoped cap design): a policy.edit
  // admin MAY author anchored rules in the reserved band, but scoped
  // policy.author users cannot — surface that so it's an informed choice,
  // not a surprise. Informational only; never blocks submit.
  const cap = reservedPriority.value;
  const inReservedBand =
    cap !== undefined && anchor !== 'platform' && Number(priority) >= cap;

  useEffect(() => {
    if (initial) {
      // R-follow-up #3 — derive anchor from the existing row. Anchor
      // immutability at the api level means edits keep the original
      // anchor; the radio is disabled on edit (see render).
      let anchor: 'platform' | 'project' | 'team' = 'platform';
      if (initial.team_id) anchor = 'team';
      else if (initial.project_id) anchor = 'project';
      reset({
        name: initial.name,
        workflow_id: initial.workflow_id,
        priority: initial.priority,
        enabled: initial.enabled,
        anchor,
        project_id: initial.project_id ?? '',
        team_id: initial.team_id ?? '',
        sel_project_id: initial.selector?.project_id ?? '',
        sel_environment: initial.selector?.environment ?? '',
        sel_provider_type: initial.selector?.provider_type ?? '',
        sel_operation: initial.selector?.operation ?? '',
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
    // api#141 — operation is optional; blank omits the key (wildcard).
    // Never submit operation="" — the server rejects it as operation_invalid.
    if (data.sel_operation) selector.operation = data.sel_operation;
    if (data.sel_secret_ref_prefix) selector.secret_ref_prefix = data.sel_secret_ref_prefix;

    // R-follow-up #3 — §5 C5 team-anchored selector safety. The
    // server re-validates, but catching here gives a friendly toast
    // before the round-trip.
    if (data.anchor === 'team') {
      if (selector.project_id || selector.environment) {
        throw new Error(
          'team-anchored rules cannot pin selector.project_id or selector.environment',
        );
      }
    }

    let project_id: string | null | undefined;
    let team_id: string | null | undefined;
    if (data.anchor === 'project') {
      project_id = data.project_id || null;
      team_id = null;
    } else if (data.anchor === 'team') {
      team_id = data.team_id || null;
      project_id = null;
    } else {
      project_id = null;
      team_id = null;
    }

    const body: PolicyInput = {
      name: data.name,
      workflow_id: data.workflow_id,
      priority: data.priority,
      enabled: data.enabled,
      selector,
      project_id,
      team_id,
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

      {/* R-follow-up #3 — anchor picker. Immutable on edit per the
          api's storage-level ErrAnchorImmutable; to change a rule's
          anchor, delete + re-create. */}
      <fieldset className="border border-border rounded p-3 space-y-2">
        <legend className="text-xs text-muted px-1">Anchor</legend>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="radio"
            value="platform"
            {...register('anchor')}
            disabled={!!initial}
            className="accent-accent"
          />
          Platform (global)
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="radio"
            value="project"
            {...register('anchor')}
            disabled={!!initial}
            className="accent-accent"
          />
          Project
        </label>
        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="radio"
            value="team"
            {...register('anchor')}
            disabled={!!initial}
            className="accent-accent"
          />
          Team (cascades subtree-down)
        </label>
        {initial && (
          <p className="text-[11px] text-muted/80 italic">
            Anchor is immutable. Delete and re-create with a new anchor.
          </p>
        )}

        {anchor === 'project' && (
          <Field label="Project id" error={errors.project_id?.message}>
            <input
              type="text"
              {...register('project_id')}
              className={inputCls}
              placeholder="<project uuid>"
            />
          </Field>
        )}
        {anchor === 'team' && (
          <Field label="Team" error={errors.team_id?.message}>
            <select {...register('team_id')} className={inputCls}>
              <option value="">— pick a team —</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-muted/80 italic mt-1">
              Team rules MUST carry selector.environment_kind=non_prod and cannot pin selector.project_id or selector.environment.
            </p>
          </Field>
        )}
      </fieldset>

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
        {noWorkflows && !workflows.isError && (
          <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2 mt-1">
            No workflows exist yet. A policy must map to a workflow —
            create one on the Workflows page first, then return here.
          </div>
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

      {inReservedBand && (
        <div className="text-xs text-yellow-300 bg-yellow-400/10 border border-yellow-400/30 rounded px-3 py-2">
          Priority {String(priority)} is in the platform-reserved band
          (≥ {cap}). This is allowed for <strong>policy.edit</strong>{' '}
          admins on this admin surface, but scoped <strong>policy.author</strong>{' '}
          users cannot create or modify {anchor}-anchored rules at this
          priority.
        </div>
      )}

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

        <Field label="provider_type (exact)" hint="blank = any provider (wildcard)">
          {/* api#139 — backend-owned enum. Blank option omits the field
              from the submitted selector (onValid only sets it when
              truthy), so the server never sees provider_type="". */}
          <select {...register('sel_provider_type')} className={inputCls}>
            <option value="">— any —</option>
            {POLICY_SELECTOR_PROVIDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="operation (exact)" hint="blank = any operation (wildcard)">
          {/* api#141 — backend-owned enum. Blank option omits the field
              from the submitted selector (onValid only sets it when
              truthy), so the server never sees operation="". */}
          <select {...register('sel_operation')} className={inputCls}>
            <option value="">— any —</option>
            {POLICY_SELECTOR_OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
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
          disabled={submitting || noWorkflows}
          title={noWorkflows ? 'Create a workflow first' : undefined}
          className="bg-accent text-bg font-medium px-4 py-2 rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
