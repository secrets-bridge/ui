/**
 * R-follow-up #3 (api#114) Slice 2 — a team's policy rules.
 *
 *   /teams/:teamID/policies
 *
 * The team's own rules, then the read-only rules it inherits from parent
 * teams and the platform (selector values withheld; keys only). The
 * author form is separate from the project one (§5 OQ2): a team rule
 * always carries environment_kind=non_prod and can't pin a project,
 * environment or team (§1 C1), so it only offers the safe optional
 * keys: path prefix, provider and operation.
 *
 * The list endpoint needs policy.author on this team; a 403 shows as a
 * permission panel, never as "0 rules" (QA P0-2). The form reads the
 * live priority cap from the list response and stays closed without it.
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useMyPolicyAuthorTeamCoverage } from '../api/myPolicyAuthorTeamCoverage';
import { toPolicyRuleErrorToast } from '../api/policyErrors';
import { POLICY_SELECTOR_OPERATIONS, POLICY_SELECTOR_PROVIDER_TYPES } from '../api/policySelectorEnums';
import { useAuthorTeamPolicyRule, useDeleteTeamPolicyRule, useTeamPolicyRules } from '../api/teamPolicyRules';
import { useTeams } from '../api/teams';
import type { AuthorTeamPolicyRuleInput, TeamPolicyRule } from '../api/types';
import { useScopedAuthorableWorkflows } from '../api/workflows';
import { canAuthorTeamPolicy, canEditPolicyRule, canManagePlatformPolicy } from '../auth/capabilities';
import { useAuth } from '../auth/AuthContext';
import { providerLabel } from '../lib/providers';
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
import { operationLabel } from './policies/labels';
import { Loading, RuleStatus, Selector } from './policies/parts';

export function TeamPolicies() {
  const { id: teamID } = useParams<{ id: string }>();
  const { identity } = useAuth();
  const list = useTeamPolicyRules(teamID);
  const teams = useTeams();
  const coverage = useMyPolicyAuthorTeamCoverage();
  const del = useDeleteTeamPolicyRule(teamID ?? '');
  const toast = useToast();
  const navigate = useNavigate();

  const team = teams.data?.find((t) => t.id === teamID);
  const [authoring, setAuthoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TeamPolicyRule | null>(null);

  const rules = useMemo(() => list.data?.rules ?? [], [list.data]);
  const own = useMemo(() => rules.filter((r) => !r.is_platform_inherited && !r.is_ancestor_inherited), [rules]);
  const inherited = useMemo(
    () => [...rules.filter((r) => r.is_ancestor_inherited), ...rules.filter((r) => r.is_platform_inherited)],
    [rules],
  );

  const crumbs = [{ label: 'Team policies', to: '/teams/policies' }, { label: team?.name ?? 'Team' }];

  if (!teamID) return <Loading>Missing team id.</Loading>;
  if (teams.isLoading) return <Loading>Loading the team…</Loading>;

  const authorCap = canAuthorTeamPolicy(coverage.data, teamID);
  const showAdminShortcut = canManagePlatformPolicy(identity?.permissions);
  const cap = list.data?.priority_cap;
  // QA P0-2: the list is policy.author-scoped; a 403 covers the whole
  // response and must read as a permission problem.
  const forbidden = list.error instanceof ApiError && list.error.status === 403;

  // QA P0-3: never promise authoring to someone who can't author here.
  const description = authorCap.allowed
    ? "Rules for this team's non-production requests. They apply to every project under the team and its sub-teams."
    : showAdminShortcut
      ? "You can't author rules for this team. Platform rules are managed on the Policies page."
      : 'The rules that apply to this team, read-only. Authoring needs the policy.author permission for this team.';

  const detail = (r: TeamPolicyRule) => `/teams/${teamID}/policies/${r.id}`;
  const from = (r: TeamPolicyRule) => (r.is_ancestor_inherited ? `Parent team${r.team_name ? ` · ${r.team_name}` : ''}` : 'Platform');
  const workflow = (r: TeamPolicyRule) => r.workflow_name ?? r.workflow_id.slice(0, 8);

  const ownColumns: Column<TeamPolicyRule>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (r) => (
        <Link to={detail(r)} className="font-medium text-accent hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: 'sel', header: 'Matches', render: (r) => <Selector selector={r.selector ?? {}} />, className: 'max-w-[360px]' },
    { key: 'wf', header: 'Workflow', render: workflow },
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
  const inheritedColumns: Column<TeamPolicyRule>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium text-ink">{r.name}</span> },
    { key: 'from', header: 'From', render: from },
    { key: 'keys', header: 'Matches on', render: (r) => <Selector keys={r.selector_keys} /> },
    { key: 'wf', header: 'Workflow', render: workflow },
    { key: 'prio', header: 'Priority', align: 'right', render: (r) => <span className="font-mono text-mono">{r.priority}</span> },
    { key: 'status', header: 'Status', render: (r) => <RuleStatus enabled={r.enabled} /> },
  ];

  return (
    <div>
      <Breadcrumb items={crumbs} />
      <div className="mt-3">
        <PageHeader
          title={`${team?.name ?? 'Team'} policies`}
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
      {forbidden && (
        <Banner title="You don't have policy.author for this team.">
          Team rules need the policy.author permission scoped to this team.
          {showAdminShortcut ? (
            <>
              {' '}
              As an administrator you can still manage platform rules on the{' '}
              <Link to="/admin/policies" className="font-medium text-accent hover:underline">
                Policies
              </Link>{' '}
              page.
            </>
          ) : (
            ' Ask a platform administrator to grant it.'
          )}
        </Banner>
      )}
      {list.isError && !forbidden && (
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
              Team rules
              <span className="ml-2 font-mono text-mono-small font-normal text-muted">{own.length}</span>
            </h2>
            {own.length === 0 ? (
              <EmptyState title="No team rules yet.">
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
                label="Team rules"
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
                      Priority <span className="font-mono">{r.priority}</span> · {workflow(r)}
                    </p>
                    <Selector selector={r.selector ?? {}} />
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

          {inherited.length > 0 && (
            <section aria-labelledby="inherited-heading">
              <h2 id="inherited-heading" className="mb-1 text-block-heading text-ink">
                Inherited rules
                <span className="ml-2 font-mono text-mono-small font-normal text-muted">{inherited.length}</span>
              </h2>
              <p className="mb-3 text-caption text-muted">
                Read-only here. They are managed where they were created. Their selector values aren't shown, only what they match
                on.
              </p>
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
                      {from(r)} · priority <span className="font-mono">{r.priority}</span> · {workflow(r)}
                    </p>
                    <Selector keys={r.selector_keys} />
                  </div>
                )}
              />
            </section>
          )}
        </>
      )}

      {authoring && <TeamPolicyAuthorDrawer teamID={teamID} cap={cap} listError={list.error} onClose={() => setAuthoring(false)} />}

      {confirmDelete && (
        <ConfirmModal
          title={`Delete ${confirmDelete.name}?`}
          body="The rule is removed from this team and the projects under it. Inherited rules keep applying."
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

/* Author drawer, separate from the project one (§5 OQ2). */

function buildTeamAuthorSchema(cap: number) {
  return z.object({
    name: z.string().trim().min(1, 'Name the rule.').max(120, 'Keep the name under 120 characters.'),
    secret_ref_prefix: z.string().max(255).optional(),
    // api#139 / api#141: optional, from the backend-owned enums; "" = any.
    provider_type: z.string().optional(),
    operation: z.string().optional(),
    workflow_id: z.guid('Choose a workflow.'),
    priority: z.coerce
      .number({ error: 'Enter a whole number.' })
      .int('Enter a whole number.')
      .min(0, 'Use 0 or more.')
      .max(cap - 1, `Use a number below ${cap}; ${cap} and up is reserved for the platform.`),
    enabled: z.boolean(),
  });
}

// z.coerce.number() makes the input type differ from the output (zod 4
// types coerce input as unknown): the form holds the input shape and
// onValid receives the parsed output.
type TeamAuthorFormInput = z.input<ReturnType<typeof buildTeamAuthorSchema>>;
type TeamAuthorFormShape = z.output<ReturnType<typeof buildTeamAuthorSchema>>;

function TeamPolicyAuthorDrawer({ teamID, cap, listError, onClose }: { teamID: string; cap: number | undefined; listError: unknown; onClose: () => void }) {
  // R-follow-up #2 fail-closed: without a readable cap (the api fails
  // the whole list with 503 platform_setting_unavailable) no form.
  if (cap === undefined) {
    return (
      <Drawer
        title="Create team rule"
        onClose={onClose}
        footer={
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        }
      >
        <Banner tone="error" title="Couldn't load the priority limit for team rules.">
          {listError instanceof ApiError ? toPolicyRuleErrorToast(listError) : 'Try again shortly.'}
        </Banner>
        <p className="mt-3 text-caption text-muted">
          The form stays closed until the limit loads, so a rule can't land in the platform's reserved range.
        </p>
      </Drawer>
    );
  }
  return <TeamPolicyAuthorForm teamID={teamID} cap={cap} onClose={onClose} />;
}

function TeamPolicyAuthorForm({ teamID, cap, onClose }: { teamID: string; cap: number; onClose: () => void }) {
  const author = useAuthorTeamPolicyRule(teamID);
  const toast = useToast();
  const workflows = useScopedAuthorableWorkflows();
  const eligible = workflows.data ?? [];

  const schema = useMemo(() => buildTeamAuthorSchema(cap), [cap]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TeamAuthorFormInput, unknown, TeamAuthorFormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      secret_ref_prefix: '',
      provider_type: '',
      operation: '',
      workflow_id: eligible[0]?.id ?? '',
      priority: 100,
      enabled: true,
    },
  });

  const onSubmit: SubmitHandler<TeamAuthorFormShape> = async (vals) => {
    // §1 C1: always environment_kind=non_prod; never project_id,
    // environment_id or team_id (the URL's team is the anchor).
    const selector: Record<string, unknown> = { environment_kind: 'non_prod' };
    if (vals.secret_ref_prefix) selector.secret_ref_prefix = vals.secret_ref_prefix.trim();
    // Never send provider_type="" or operation="" (the server rejects them).
    if (vals.provider_type) selector.provider_type = vals.provider_type;
    if (vals.operation) selector.operation = vals.operation;
    const body: AuthorTeamPolicyRuleInput = {
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
      title="Create team rule"
      subtitle="Applies to non-production environments in every project under this team and its sub-teams."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={author.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="team-rule" variant="primary" disabled={author.isPending} aria-busy={author.isPending}>
            {author.isPending ? 'Saving…' : 'Create rule'}
          </Button>
        </>
      }
    >
      <form id="team-rule" noValidate onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-[18px]">
        <Field id="tr-name" label="Name" error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="platform-team-non-prod" autoComplete="off" data-autofocus />}
        </Field>
        <Field id="tr-prefix" label="Secret path starts with (optional)" error={errors.secret_ref_prefix?.message}>
          {(p) => <Input {...p} {...register('secret_ref_prefix')} placeholder="billing/" className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>
        <Field id="tr-provider" label="Provider (optional)" error={errors.provider_type?.message}>
          {(p) => (
            <Select {...p} {...register('provider_type')}>
              <option value="">Any provider</option>
              {POLICY_SELECTOR_PROVIDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {providerLabel(t)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="tr-op" label="Operation (optional)" error={errors.operation?.message}>
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
          id="tr-wf"
          label="Workflow"
          hint={eligible.length === 0 && workflows.isSuccess ? 'No workflow is open to team rules yet. An administrator enables one on the Workflows page.' : undefined}
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
          <Field id="tr-prio" label="Priority" hint={`Below ${cap}. The highest matching rule wins.`} error={errors.priority?.message}>
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
        <p className="text-caption text-muted">Team rules can't pin a project or an environment, and never apply to production.</p>
        {author.error instanceof ApiError && (
          <Banner tone="error" title="Not created.">
            {toPolicyRuleErrorToast(author.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}
