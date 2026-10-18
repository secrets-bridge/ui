/**
 * EPIC R (api#108) Slice R3 — a project's policy rules.
 *
 *   /projects/:id/policies
 *
 * The project's own rules, then the platform and team rules it
 * inherits. Inherited rows arrive with `selector_keys` only, never the
 * values (§4 correction 1), and are read-only here. The empty state
 * links to the admin Policies page only for policy.edit holders (§5 Q15).
 *
 * "Create rule" (policy.author) opens the guided form (§5 Q14): which
 * environments (any non-production one, or one picked from the list),
 * an optional path prefix and operation, a workflow from the curated
 * scoped list (api#118), and a priority below the platform-reserved
 * band. The band is read live (api#113); while it loads or fails the
 * form stays closed, never falling back to a guessed number.
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useMe } from '../api/me';
import { usePlatformReservedPriority } from '../api/platformSettings';
import { toPolicyRuleErrorToast } from '../api/policyErrors';
import { POLICY_SELECTOR_OPERATIONS } from '../api/policySelectorEnums';
import { useAuthorPolicyRule, useDeletePolicyRule, useProjectPolicyRules } from '../api/projectPolicyRules';
import type { AuthorPolicyRuleInput, MyEnvironment, PolicyRule } from '../api/types';
import { useScopedAuthorableWorkflows, useWorkflows } from '../api/workflows';
import { canAuthorProjectPolicy, canEditPolicyRule, canManagePlatformPolicy } from '../auth/capabilities';
import { useAuth } from '../auth/AuthContext';
import { Banner } from '../ui/Banner';
import { Breadcrumb } from '../ui/Breadcrumb';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { DataTable, type Column } from '../ui/DataTable';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Field, Input, Select } from '../ui/Field';
import { PageHeader } from '../ui/PageHeader';
import { useToast } from '../ui/toastContext';
import { operationLabel, type SelectorNames } from './policies/labels';
import { Loading, RuleStatus, Selector } from './policies/parts';

export function ProjectPolicies() {
  const { id: projectId } = useParams<{ id: string }>();
  const me = useMe();
  const { identity } = useAuth();
  const list = useProjectPolicyRules(projectId);
  const workflows = useWorkflows();
  const del = useDeletePolicyRule(projectId ?? '');
  const toast = useToast();
  const navigate = useNavigate();

  const project = me.data?.projects.find((p) => p.id === projectId);
  const nonProdEnvs = useMemo(() => (project?.environments ?? []).filter((e) => e.kind === 'non_prod'), [project?.environments]);

  const [authoring, setAuthoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PolicyRule | null>(null);

  const crumbs = [{ label: 'Project policies', to: '/projects/policies' }, { label: project?.name ?? 'Project' }];

  if (me.isLoading) return <Loading>Loading the project…</Loading>;
  if (!project) {
    return (
      <div>
        <Breadcrumb items={crumbs} />
        <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
          You can't open this project
        </h1>
        <Banner title="It doesn't exist, or your roles don't cover it.">
          <Link to="/projects/policies" className="font-medium text-accent hover:underline">
            Back to project policies
          </Link>
        </Banner>
      </div>
    );
  }

  const authorCap = canAuthorProjectPolicy(identity?.permissions, project);
  const showAdminShortcut = canManagePlatformPolicy(identity?.permissions);
  const workflowName = (r: PolicyRule) => r.workflow_name ?? workflows.data?.find((w) => w.id === r.workflow_id)?.name;
  const names: SelectorNames = {
    project: (id) => (id === project.id ? project.name : undefined),
    environment: (id) => project.environments?.find((e) => e.id === id)?.name,
  };

  // QA P0-3: the description never promises authoring to someone who
  // can't author here.
  const description = authorCap.allowed
    ? "Rules that pick the workflow for this project's non-production requests. Platform and team rules also apply; they are read-only here."
    : showAdminShortcut
      ? "You can't author rules for this project. Platform rules are managed on the Policies page; everything that applies here is listed below."
      : 'The rules that apply to this project, read-only. Authoring needs the policy.author permission for this project.';

  const own = (list.data ?? []).filter((r) => !r.is_platform_inherited && !r.is_team_inherited);
  const inherited = (list.data ?? []).filter((r) => r.is_platform_inherited || r.is_team_inherited);
  const detail = (r: PolicyRule) => `/projects/${project.id}/policies/${r.id}`;

  const ownColumns: Column<PolicyRule>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <Link to={detail(r)} className="font-medium text-accent hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: 'sel', header: 'Matches', render: (r) => <Selector selector={r.selector ?? {}} names={names} />, className: 'max-w-[360px]' },
    { key: 'wf', header: 'Workflow', render: (r) => workflowName(r) ?? '—' },
    { key: 'prio', header: 'Priority', align: 'right', render: (r) => <span className="font-mono text-mono">{r.priority}</span> },
    { key: 'status', header: 'Status', render: (r) => <RuleStatus enabled={r.enabled} /> },
    {
      key: 'actions',
      header: 'Actions',
      hiddenHeader: true,
      align: 'right',
      render: (r) =>
        canEditPolicyRule(identity?.permissions, r).allowed ? (
          <Button variant="danger" size="sm" onClick={() => setConfirmDelete(r)} aria-label={`Delete ${r.name}`}>
            Delete…
          </Button>
        ) : null,
    },
  ];

  const inheritedColumns: Column<PolicyRule>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    {
      key: 'from',
      header: 'From',
      render: (r) => (r.is_team_inherited ? `Team${r.team_name ? ` · ${r.team_name}` : ''}` : 'Platform'),
    },
    { key: 'keys', header: 'Matches on', render: (r) => <Selector keys={r.selector_keys} /> },
    { key: 'wf', header: 'Workflow', render: (r) => workflowName(r) ?? '—' },
    { key: 'prio', header: 'Priority', align: 'right', render: (r) => <span className="font-mono text-mono">{r.priority}</span> },
    { key: 'status', header: 'Status', render: (r) => <RuleStatus enabled={r.enabled} /> },
  ];

  return (
    <div>
      <Breadcrumb items={crumbs} />
      <div className="mt-3">
        <PageHeader
          title={`${project.name} policies`}
          description={description}
          actions={
            authorCap.allowed ? (
              <Button variant="primary" onClick={() => setAuthoring(true)}>
                Create rule
              </Button>
            ) : undefined
          }
        />
      </div>

      {list.isLoading && <Loading>Loading rules…</Loading>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the rules."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? toPolicyRuleErrorToast(list.error) : 'Network error.'}
        </Banner>
      )}

      {list.data && (
        <>
          <section aria-labelledby="own-heading" className="mb-8">
            <h2 id="own-heading" className="mb-3 text-block-heading text-ink">
              Project rules
              <span className="ml-2 font-mono text-mono-small font-normal text-muted">{own.length}</span>
            </h2>
            {own.length === 0 ? (
              <EmptyState title="No project rules yet.">
                Requests here follow the inherited rules below.
                {showAdminShortcut && (
                  <>
                    {' '}
                    Platform rules are managed on the{' '}
                    <Link to="/admin/policies" className="font-medium text-accent hover:underline">
                      Policies
                    </Link>{' '}
                    page.
                  </>
                )}
              </EmptyState>
            ) : (
              <DataTable
                label="Project rules"
                columns={ownColumns}
                rows={own}
                rowKey={(r) => r.id}
                onRowClick={(r) => navigate(detail(r))}
                minWidth={760}
                stacked={(r) => (
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-center justify-between gap-3">
                      <Link to={detail(r)} className="font-medium text-accent hover:underline">
                        {r.name}
                      </Link>
                      <RuleStatus enabled={r.enabled} />
                    </p>
                    <p className="text-caption text-muted">
                      Priority <span className="font-mono">{r.priority}</span> · {workflowName(r) ?? 'unknown workflow'}
                    </p>
                    <Selector selector={r.selector ?? {}} names={names} />
                    {canEditPolicyRule(identity?.permissions, r).allowed && (
                      <div className="mt-1">
                        <Button variant="danger" size="sm" onClick={() => setConfirmDelete(r)} aria-label={`Delete ${r.name}`}>
                          Delete…
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              />
            )}
          </section>

          <section aria-labelledby="inherited-heading">
            <h2 id="inherited-heading" className="mb-1 text-block-heading text-ink">
              Inherited rules
              <span className="ml-2 font-mono text-mono-small font-normal text-muted">{inherited.length}</span>
            </h2>
            <p className="mb-3 text-caption text-muted">
              Read-only here. Platform rules are managed by administrators, team rules on their team's page. Their selector values
              aren't shown, only what they match on.
            </p>
            {inherited.length === 0 ? (
              <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">No platform or team rules apply to this project.</p>
            ) : (
              <DataTable
                label="Inherited rules"
                columns={inheritedColumns}
                rows={inherited}
                rowKey={(r) => r.id}
                minWidth={760}
                stacked={(r) => (
                  <div className="flex flex-col gap-1.5">
                    <p className="flex items-center justify-between gap-3">
                      <span className="font-medium text-ink">{r.name}</span>
                      <RuleStatus enabled={r.enabled} />
                    </p>
                    <p className="text-caption text-muted">
                      {r.is_team_inherited ? `Team${r.team_name ? ` · ${r.team_name}` : ''}` : 'Platform'} · priority{' '}
                      <span className="font-mono">{r.priority}</span> · {workflowName(r) ?? 'unknown workflow'}
                    </p>
                    <Selector keys={r.selector_keys} />
                  </div>
                )}
              />
            )}
          </section>
        </>
      )}

      {authoring && <AuthorPolicyDrawer projectId={project.id} nonProdEnvs={nonProdEnvs} onClose={() => setAuthoring(false)} />}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body="The rule is removed from this project. Requests then follow the next rule that matches; platform and team rules keep applying."
          confirmText="Delete rule"
          danger
          loading={del.isPending}
          error={del.error}
          onConfirm={async () => {
            try {
              await del.mutateAsync(confirmDelete.id);
              toast(`Deleted ${confirmDelete.name}.`);
              setConfirmDelete(null);
            } catch {
              // Shown in the dialog.
            }
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

/* Author drawer: the guided form (§5 Q14, no raw JSON). */

/**
 * R-follow-up #2 (api#113) — the schema is built from the live
 * platform-reserved cap, so `< cap` reflects the current setting.
 */
function buildAuthorSchema(cap: number) {
  return z
    .object({
      name: z.string().trim().min(1, 'Name the rule.').max(120, 'Keep the name under 120 characters.'),
      env_match: z.enum(['any_non_prod', 'specific']),
      environment_id: z.string().optional(),
      secret_ref_prefix: z.string().max(255).optional(),
      // api#141: optional, from the backend-owned enum; "" = any.
      operation: z.string().optional(),
      workflow_id: z.guid('Choose a workflow.'),
      priority: z.coerce
        .number({ error: 'Enter a whole number.' })
        .int('Enter a whole number.')
        .min(0, 'Use 0 or more.')
        .max(cap - 1, `Use a number below ${cap}; ${cap} and up is reserved for the platform.`),
      enabled: z.boolean(),
    })
    .superRefine((val, ctx) => {
      if (val.env_match === 'specific' && !val.environment_id) {
        ctx.addIssue({ code: 'custom', path: ['environment_id'], message: 'Choose the environment.' });
      }
    });
}

// z.coerce.number() makes the input type differ from the output (zod 4
// types coerce input as unknown): the form holds the input shape and
// onValid receives the parsed output.
type AuthorFormInput = z.input<ReturnType<typeof buildAuthorSchema>>;
type AuthorFormShape = z.output<ReturnType<typeof buildAuthorSchema>>;

function AuthorPolicyDrawer({ projectId, nonProdEnvs, onClose }: { projectId: string; nonProdEnvs: MyEnvironment[]; onClose: () => void }) {
  // R-follow-up #2 (api#113): read the cap live and fail closed while
  // it loads or errors. Only the form branch mounts useForm, so the
  // schema sees a real cap.
  const cap = usePlatformReservedPriority();

  if (cap.isLoading || cap.isError || cap.value === undefined) {
    return (
      <Drawer
        title="Create rule"
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        {cap.isLoading ? (
          <Loading>Loading platform settings…</Loading>
        ) : (
          <Banner tone="error" title="Couldn't load the platform settings.">
            {cap.error instanceof ApiError ? toPolicyRuleErrorToast(cap.error) : 'Try again shortly.'}
          </Banner>
        )}
        <p className="mt-3 text-caption text-muted">
          The form needs the live priority limit for project rules. It stays closed until that loads, so a rule can't land in the
          platform's reserved range.
        </p>
      </Drawer>
    );
  }

  return <AuthorPolicyForm projectId={projectId} nonProdEnvs={nonProdEnvs} cap={cap.value} onClose={onClose} />;
}

function AuthorPolicyForm({ projectId, nonProdEnvs, cap, onClose }: { projectId: string; nonProdEnvs: MyEnvironment[]; cap: number; onClose: () => void }) {
  const author = useAuthorPolicyRule(projectId);
  const toast = useToast();
  // R-follow-up #1 (api#118): the api returns only workflows that are
  // enabled and marked for scoped authoring; render what arrives.
  const workflows = useScopedAuthorableWorkflows();
  const eligible = workflows.data ?? [];

  const schema = useMemo(() => buildAuthorSchema(cap), [cap]);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AuthorFormInput, unknown, AuthorFormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      env_match: 'any_non_prod',
      environment_id: '',
      secret_ref_prefix: '',
      operation: '',
      workflow_id: eligible[0]?.id ?? '',
      priority: 100,
      enabled: true,
    },
  });

  const envMatch = watch('env_match');

  const onSubmit: SubmitHandler<AuthorFormShape> = async (vals) => {
    const selector: Record<string, unknown> = { project_id: projectId };
    if (vals.env_match === 'any_non_prod') {
      selector.environment_kind = 'non_prod';
    } else if (vals.environment_id) {
      selector.environment_id = vals.environment_id;
      selector.environment_kind = 'non_prod';
    }
    if (vals.secret_ref_prefix) selector.secret_ref_prefix = vals.secret_ref_prefix.trim();
    // api#141: never send operation="" (the server rejects it).
    if (vals.operation) selector.operation = vals.operation;
    const body: AuthorPolicyRuleInput = {
      name: vals.name.trim(),
      selector,
      priority: vals.priority,
      workflow_id: vals.workflow_id,
      enabled: vals.enabled,
    };
    try {
      await author.mutateAsync(body);
      toast(`Created ${body.name}.`);
      onClose();
    } catch {
      // Shown below.
    }
  };

  return (
    <Drawer
      title="Create rule"
      subtitle="For this project's non-production environments. Rules for production are set by administrators."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={author.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="author-rule" variant="primary" disabled={author.isPending} aria-busy={author.isPending}>
            {author.isPending ? 'Saving…' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form id="author-rule" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
        <Field id="ar-name" label="Name" error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="payments-dev-fast-track" autoComplete="off" data-autofocus />}
        </Field>

        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="mb-1 text-body font-semibold text-ink">Environments</legend>
          <label className="flex items-center gap-2.5 text-ui font-normal">
            <input type="radio" value="any_non_prod" {...register('env_match')} className="accent-accent" />
            Every non-production environment
          </label>
          <label className="flex items-center gap-2.5 text-ui font-normal">
            <input type="radio" value="specific" {...register('env_match')} className="accent-accent" />
            One environment
          </label>
          {envMatch === 'specific' && (
            <Field id="ar-env" label="Environment" error={errors.environment_id?.message} className="mt-1.5">
              {(p) => (
                <Select {...p} {...register('environment_id')}>
                  <option value="">Choose an environment</option>
                  {nonProdEnvs.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
          {nonProdEnvs.length === 0 && (
            <p className="text-caption text-muted">This project has no non-production environments yet. An administrator adds them on the Projects page.</p>
          )}
        </fieldset>

        <Field id="ar-prefix" label="Secret path starts with (optional)" error={errors.secret_ref_prefix?.message}>
          {(p) => <Input {...p} {...register('secret_ref_prefix')} placeholder="billing/" className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>

        <Field id="ar-op" label="Operation (optional)" error={errors.operation?.message}>
          {(p) => (
            <Select {...p} {...register('operation')}>
              <option value="">Any operation</option>
              {POLICY_SELECTOR_OPERATIONS.map((o) => (
                <option key={o} value={o}>
                  {operationLabel(o)}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          id="ar-wf"
          label="Workflow"
          hint={eligible.length === 0 && workflows.isSuccess ? 'No workflow is open to project rules yet. An administrator enables one on the Workflows page.' : undefined}
          error={errors.workflow_id?.message}
        >
          {(p) => (
            <Select {...p} {...register('workflow_id')}>
              <option value="">{workflows.isLoading ? 'Loading workflows…' : 'Choose a workflow'}</option>
              {eligible.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-[18px] min-[480px]:grid-cols-2">
          <Field id="ar-prio" label="Priority" hint={`Below ${cap}. The highest matching rule wins.`} error={errors.priority?.message}>
            {(p) => <Input {...p} {...register('priority')} type="number" min={0} max={cap - 1} inputMode="numeric" className="font-mono" />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-body font-semibold text-ink">Status</span>
            <label className="flex h-(--control-md) items-center gap-2.5 text-ui font-normal">
              <input type="checkbox" {...register('enabled')} className="h-4 w-4 accent-accent" />
              Enabled
            </label>
          </div>
        </div>

        {author.error instanceof ApiError && (
          <Banner tone="error" title="Not created.">
            {toPolicyRuleErrorToast(author.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
