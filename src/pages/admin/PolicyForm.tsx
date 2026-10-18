/**
 * Create / edit form for a platform policy rule (admin, policy.edit),
 * shown in a drawer from the Policies page. The drawer owns the buttons;
 * this renders `<form id={formId}>`.
 *
 * Selector dimensions (`policy_rules.selector`), each optional; an
 * empty one is left out of the body so the api treats it as "any":
 *   - project_id          exact match (a project picked from the list)
 *   - environment         exact match on the environment name
 *   - environment_kind    non_prod | prod
 *   - provider_type       backend-owned enum (api#139); never "" (the
 *                         server rejects it as provider_type_invalid)
 *   - operation           backend-owned enum (api#141); never ""
 *   - secret_ref_prefix   prefix match
 * Keys this form doesn't manage (environment_id on rules authored from a
 * project page, for example) are kept as they are on edit; the old form
 * dropped them, and environment_kind with them.
 *
 * Anchor (api#127): platform, one project, or one team; fixed after
 * creation. Team rules always carry environment_kind=non_prod and can't
 * pin a project or environment (the api checks too).
 *
 * The workflow is picked from `useWorkflows()` (same query key as the
 * Workflows page).
 */

import { useEffect, useMemo } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { usePlatformReservedPriority } from '../../api/platformSettings';
import { POLICY_SELECTOR_OPERATIONS, POLICY_SELECTOR_PROVIDER_TYPES } from '../../api/policySelectorEnums';
import { useTeams } from '../../api/teams';
import { useProjects } from '../../api/tenancy';
import type { Policy, PolicyInput } from '../../api/types';
import { useWorkflows } from '../../api/workflows';
import { providerLabel } from '../../lib/providers';
import { Banner } from '../../ui/Banner';
import { Field, Input, Select } from '../../ui/Field';
import { operationLabel, selectorKeyLabel } from '../policies/labels';

/** Selector keys this form edits; anything else on a rule is kept as is. */
const MANAGED = ['project_id', 'environment', 'environment_kind', 'provider_type', 'operation', 'secret_ref_prefix'];

const schema = z
  .object({
    name: z.string().trim().min(1, 'Name the rule.').max(120, 'Keep the name under 120 characters.'),
    workflow_id: z.guid('Choose the workflow these requests go through.'),
    priority: z.coerce.number({ error: 'Enter a whole number.' }).int('Enter a whole number.').min(0, 'Use 0 or more.').max(10_000, 'Use 10000 or less.'),
    enabled: z.boolean(),
    anchor: z.enum(['platform', 'project', 'team']),
    project_id: z.string().optional(),
    team_id: z.string().optional(),
    sel_project_id: z.string().max(120).optional(),
    sel_environment: z.string().max(120).optional(),
    sel_environment_kind: z.string().optional(),
    sel_provider_type: z.string().max(60).optional(),
    sel_operation: z.string().max(60).optional(),
    sel_secret_ref_prefix: z.string().max(255).optional(),
  })
  .superRefine((v, ctx) => {
    // The old form sent project_id/team_id null when none was picked,
    // which quietly created a platform rule instead.
    if (v.anchor === 'project' && !v.project_id) {
      ctx.addIssue({ code: 'custom', path: ['project_id'], message: 'Choose the project this rule belongs to.' });
    }
    if (v.anchor === 'team' && !v.team_id) {
      ctx.addIssue({ code: 'custom', path: ['team_id'], message: 'Choose the team this rule belongs to.' });
    }
  });

// z.coerce.number() makes the input type differ from the output (zod 4
// types coerce input as unknown): the form holds the input shape and
// onValid receives the parsed output.
type FormInput = z.input<typeof schema>;
type FormShape = z.output<typeof schema>;

interface Props {
  formId: string;
  initial?: Policy;
  onSubmit: (body: PolicyInput) => Promise<unknown>;
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
  sel_environment_kind: '',
  sel_provider_type: '',
  sel_operation: '',
  sel_secret_ref_prefix: '',
};

export function PolicyForm({ formId, initial, onSubmit }: Props) {
  const workflows = useWorkflows();
  const teams = useTeams();
  const projects = useProjects();
  const reservedPriority = usePlatformReservedPriority();

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormInput, unknown, FormShape>({ resolver: zodResolver(schema), defaultValues: defaults });

  const anchor = watch('anchor');
  const priority = watch('priority');
  const envKind = watch('sel_environment_kind');
  const selProject = watch('sel_project_id');

  const noWorkflows = !workflows.isLoading && !workflows.isError && (workflows.data?.length ?? 0) === 0;
  const cap = reservedPriority.value;
  const inReservedBand = cap !== undefined && anchor !== 'platform' && Number(priority) >= cap;

  // Selector keys the form doesn't edit, carried through unchanged.
  const kept = useMemo(
    () => Object.fromEntries(Object.entries(initial?.selector ?? {}).filter(([k]) => !MANAGED.includes(k))),
    [initial],
  );

  useEffect(() => {
    if (!initial) {
      reset(defaults);
      return;
    }
    const a: FormShape['anchor'] = initial.team_id ? 'team' : initial.project_id ? 'project' : 'platform';
    reset({
      name: initial.name,
      workflow_id: initial.workflow_id,
      priority: initial.priority,
      enabled: initial.enabled,
      anchor: a,
      project_id: initial.project_id ?? '',
      team_id: initial.team_id ?? '',
      sel_project_id: initial.selector?.project_id ?? '',
      sel_environment: initial.selector?.environment ?? '',
      sel_environment_kind: initial.selector?.environment_kind ?? '',
      sel_provider_type: initial.selector?.provider_type ?? '',
      sel_operation: initial.selector?.operation ?? '',
      sel_secret_ref_prefix: initial.selector?.secret_ref_prefix ?? '',
    });
  }, [initial, reset]);

  const onValid: SubmitHandler<FormShape> = async (data) => {
    // The anchor can't change after creation (the api refuses it), so an
    // edit always sends the rule's own anchor.
    const anchorNow: FormShape['anchor'] = initial ? (initial.team_id ? 'team' : initial.project_id ? 'project' : 'platform') : data.anchor;
    const team = anchorNow === 'team';
    const selector: Record<string, string> = { ...kept };
    // Team rules can't pin a project or environment, and always apply to
    // non-production only.
    if (!team && data.sel_project_id) selector.project_id = data.sel_project_id;
    if (!team && data.sel_environment) selector.environment = data.sel_environment.trim();
    if (team) selector.environment_kind = 'non_prod';
    else if (data.sel_environment_kind) selector.environment_kind = data.sel_environment_kind;
    if (data.sel_provider_type) selector.provider_type = data.sel_provider_type;
    if (data.sel_operation) selector.operation = data.sel_operation;
    if (data.sel_secret_ref_prefix) selector.secret_ref_prefix = data.sel_secret_ref_prefix.trim();
    if (team) {
      delete selector.environment_id;
      delete selector.team_id;
    }

    const body: PolicyInput = {
      name: data.name.trim(),
      workflow_id: data.workflow_id,
      priority: data.priority,
      enabled: data.enabled,
      selector,
      project_id: anchorNow === 'project' ? (initial?.project_id ?? data.project_id) || null : null,
      team_id: team ? (initial?.team_id ?? data.team_id) || null : null,
    };
    await onSubmit(body);
  };

  const projectOptions = projects.data ?? [];
  // A selector project that isn't in the list (archived, or an old
  // free-text value) still shows, so an edit doesn't lose it.
  const strayProject = selProject && !projectOptions.some((p) => p.id === selProject) ? selProject : '';
  const keptEntries = Object.entries(kept);

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(e) => {
        // onValid's errors surface in the drawer through its mutation.
        void handleSubmit(onValid)(e).catch(() => {});
      }}
      className="flex flex-col gap-[18px]"
    >
      {initial?.is_system && (
        <Banner title="This is the system default rule.">It can be edited but not deleted. It catches every request no other rule matches.</Banner>
      )}

      <Field id="pf-name" label="Name" error={errors.name?.message}>
        {(p) => <Input {...p} {...register('name')} placeholder="billing-prod-two-approvers" autoComplete="off" data-autofocus />}
      </Field>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="mb-1 text-body font-semibold text-ink">Applies to</legend>
        {(
          [
            ['platform', 'The whole platform'],
            ['project', 'One project'],
            ['team', 'One team and its sub-teams'],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2.5 text-ui font-normal">
            <input type="radio" value={v} {...register('anchor')} disabled={!!initial} className="accent-accent" />
            {label}
          </label>
        ))}
        {initial && <p className="text-caption text-muted">Fixed once the rule exists. To move it, delete it and create a new one.</p>}
        {anchor === 'project' && (
          <Field id="pf-project" label="Project" error={errors.project_id?.message} className="mt-1.5">
            {(p) => (
              <Select {...p} {...register('project_id')} disabled={!!initial}>
                <option value="">{projects.isLoading ? 'Loading projects…' : 'Choose a project'}</option>
                {projectOptions.map((pr) => (
                  <option key={pr.id} value={pr.id}>
                    {pr.name}
                    {pr.status === 'archived' ? ' (archived)' : ''}
                  </option>
                ))}
                {initial?.project_id && !projectOptions.some((pr) => pr.id === initial.project_id) && (
                  <option value={initial.project_id}>{initial.project_id}</option>
                )}
              </Select>
            )}
          </Field>
        )}
        {anchor === 'team' && (
          <Field
            id="pf-team"
            label="Team"
            hint="Team rules apply to non-production environments only, and can't pin a project or environment."
            error={errors.team_id?.message}
            className="mt-1.5"
          >
            {(p) => (
              <Select {...p} {...register('team_id')} disabled={!!initial}>
                <option value="">{teams.isLoading ? 'Loading teams…' : 'Choose a team'}</option>
                {(teams.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </fieldset>

      <Field
        id="pf-workflow"
        label="Workflow"
        hint="The approvals and time limits that matching requests go through."
        error={errors.workflow_id?.message}
      >
        {(p) => (
          <Select {...p} {...register('workflow_id')}>
            <option value="">{workflows.isLoading ? 'Loading workflows…' : 'Choose a workflow'}</option>
            {(workflows.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.is_default ? ' (default)' : ''}
                {!w.enabled ? ' (disabled)' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {workflows.isError && <Banner tone="error" title="Couldn't load the workflows.">Close the drawer and try again.</Banner>}
      {noWorkflows && <Banner title="There are no workflows yet.">Create one on the Workflows page first; every rule maps to one.</Banner>}

      <div className="grid grid-cols-1 gap-[18px] min-[480px]:grid-cols-2">
        <Field
          id="pf-priority"
          label="Priority"
          hint="When several rules match, the highest wins. The system default is 0."
          error={errors.priority?.message}
        >
          {(p) => <Input {...p} {...register('priority')} type="number" min={0} max={10000} inputMode="numeric" className="font-mono" />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-body font-semibold text-ink">Status</span>
          <label className="flex h-(--control-md) items-center gap-2.5 text-ui font-normal">
            <input type="checkbox" {...register('enabled')} className="h-4 w-4 accent-accent" />
            Enabled
          </label>
        </div>
      </div>
      {inReservedBand && (
        <Banner title={`Priority ${String(priority)} is in the reserved band (${cap} and up).`}>
          You can save it here as an administrator. People who author rules from a project or team page can't create or
          change {anchor} rules at this priority.
        </Banner>
      )}

      <fieldset className="flex min-w-0 flex-col gap-3.5">
        <legend className="mb-1 text-body font-semibold text-ink">Matches requests where</legend>
        <p className="-mt-1 text-caption text-muted">Leave a field empty to match anything.</p>
        {anchor !== 'team' && (
          <>
            <Field id="pf-sel-project" label="Project">
              {(p) => (
                <Select {...p} {...register('sel_project_id')}>
                  <option value="">Any project</option>
                  {projectOptions.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.name}
                    </option>
                  ))}
                  {strayProject && <option value={strayProject}>{strayProject}</option>}
                </Select>
              )}
            </Field>
            <Field id="pf-sel-env" label="Environment name" hint="Exact name, such as production.">
              {(p) => <Input {...p} {...register('sel_environment')} placeholder="Any environment" autoComplete="off" spellCheck={false} />}
            </Field>
          </>
        )}
        <Field
          id="pf-sel-kind"
          label="Environment kind"
          hint={anchor === 'team' ? 'Team rules always apply to non-production only.' : undefined}
        >
          {(p) =>
            anchor === 'team' ? (
              <Select {...p} value="non_prod" disabled onChange={() => {}}>
                <option value="non_prod">Non-production</option>
              </Select>
            ) : (
              <Select {...p} {...register('sel_environment_kind')}>
                <option value="">Any kind</option>
                <option value="non_prod">Non-production</option>
                <option value="prod">Production</option>
              </Select>
            )
          }
        </Field>
        {anchor !== 'team' && envKind === 'prod' && (
          <p className="-mt-2 text-caption text-muted">Production reads always need an approved request. Direct reveal is never allowed there, whatever a rule says.</p>
        )}
        <Field id="pf-sel-provider" label="Provider">
          {(p) => (
            <Select {...p} {...register('sel_provider_type')}>
              <option value="">Any provider</option>
              {POLICY_SELECTOR_PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {providerLabel(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="pf-sel-op" label="Operation">
          {(p) => (
            <Select {...p} {...register('sel_operation')}>
              <option value="">Any operation</option>
              {POLICY_SELECTOR_OPERATIONS.map((o) => (
                <option key={o} value={o}>
                  {operationLabel(o)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="pf-sel-prefix" label="Secret path starts with">
          {(p) => <Input {...p} {...register('sel_secret_ref_prefix')} placeholder="billing/" className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        {keptEntries.length > 0 && (
          <p className="text-caption text-muted">
            Also matches on {keptEntries.map(([k]) => selectorKeyLabel(k).toLowerCase()).join(', ')} (
            <span className="font-mono">{keptEntries.map(([k]) => k).join(', ')}</span>), set where the rule was authored. Saving keeps{' '}
            {keptEntries.length === 1 ? 'it' : 'them'}.
          </p>
        )}
      </fieldset>
    </form>
  );
}
