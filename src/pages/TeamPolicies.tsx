/**
 * R-follow-up #3 (api#114) Slice 2 — team-anchored scoped policy
 * authoring page.
 *
 *   /teams/:teamID/policies
 *
 * Shows the team's own rules + inherited ancestor-team rules + inherited
 * platform rules. Inherited rows are read-only and sanitized (selector
 * omitted; selector_keys only). Per §5 OQ2 the Author drawer is a
 * separate component from ProjectPolicies' drawer — selectors are
 * materially different (no env_id picker, no project_id ever, fewer
 * fields).
 *
 * Per §1 C1 lock the team rule's selector must carry
 * environment_kind="non_prod" and cannot pin project_id,
 * environment_id, or team_id. The form ALWAYS submits
 * environment_kind=non_prod and exposes only the safe-list optional
 * keys (secret_ref_prefix in v1).
 *
 * The Author drawer reads the live cap from the LIST response envelope
 * (no separate platform-settings GET). Fails closed when the cap is
 * missing — falling back to 9000 would defeat the scoped-author gate.
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { toPolicyRuleErrorToast } from '../api/policyErrors';
import {
  POLICY_SELECTOR_PROVIDER_TYPES,
  POLICY_SELECTOR_OPERATIONS,
} from '../api/policySelectorEnums';
import { useMyPolicyAuthorTeamCoverage } from '../api/myPolicyAuthorTeamCoverage';
import {
  useAuthorTeamPolicyRule,
  useDeleteTeamPolicyRule,
  useTeamPolicyRules,
} from '../api/teamPolicyRules';
import { useTeams } from '../api/teams';
import type {
  AuthorTeamPolicyRuleInput,
  TeamPolicyRule,
} from '../api/types';
import { useScopedAuthorableWorkflows } from '../api/workflows';
import {
  canAuthorTeamPolicy,
  canEditPolicyRule,
  canManagePlatformPolicy,
} from '../auth/capabilities';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Drawer } from '../ui/Drawer';
import { PageHeader } from '../ui/PageHeader';

export function TeamPolicies() {
  const { id: teamID } = useParams<{ id: string }>();
  const { identity } = useAuth();
  const list = useTeamPolicyRules(teamID);
  const teams = useTeams();
  const coverage = useMyPolicyAuthorTeamCoverage();
  const del = useDeleteTeamPolicyRule(teamID ?? '');

  const team = teams.data?.find((t) => t.id === teamID);

  const [authoring, setAuthoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<TeamPolicyRule | null>(null);

  const ownRules = useMemo(
    () =>
      (list.data?.rules ?? []).filter(
        (r) => !r.is_platform_inherited && !r.is_ancestor_inherited,
      ),
    [list.data],
  );
  const ancestorRules = useMemo(
    () => (list.data?.rules ?? []).filter((r) => r.is_ancestor_inherited),
    [list.data],
  );
  const platformInherited = useMemo(
    () => (list.data?.rules ?? []).filter((r) => r.is_platform_inherited),
    [list.data],
  );

  if (!teamID) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Missing team id.</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  if (teams.isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Loading team…</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const authorCap = canAuthorTeamPolicy(coverage.data, teamID);
  const showAdminShortcut = canManagePlatformPolicy(identity?.permissions);
  const livePriorityCap = list.data?.priority_cap;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <PageHeader
        title={`${team?.name ?? 'Team'} · Team policies`}
        description="Author non-prod policy rules for this team. Rules cascade down to every descendant project."
        actions={
          authorCap.allowed ? (
            <Button onClick={() => setAuthoring(true)}>+ Author rule</Button>
          ) : undefined
        }
      />

      {(ancestorRules.length > 0 || platformInherited.length > 0) && (
        <Card>
          <CardHeader>
            <h3 className="text-text font-semibold">
              Inherited (read-only)
            </h3>
            <span className="text-muted text-xs">
              {ancestorRules.length + platformInherited.length} rule
              {ancestorRules.length + platformInherited.length === 1 ? '' : 's'}
            </span>
          </CardHeader>
          <CardBody>
            <ul className="divide-y divide-border">
              {ancestorRules.map((r) => (
                <InheritedRow
                  key={r.id}
                  rule={r}
                  badgeLabel="team"
                  badgeTooltip={r.team_name ? `From team ${r.team_name}` : undefined}
                />
              ))}
              {platformInherited.map((r) => (
                <InheritedRow key={r.id} rule={r} badgeLabel="platform" />
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">Team rules</h3>
          <span className="text-muted text-xs">
            {ownRules.length} rule{ownRules.length === 1 ? '' : 's'}
          </span>
        </CardHeader>
        <CardBody>
          {ownRules.length === 0 ? (
            <EmptyState
              canAuthor={authorCap.allowed}
              onAuthor={() => setAuthoring(true)}
              showAdminShortcut={showAdminShortcut}
            />
          ) : (
            <ul className="divide-y divide-border">
              {ownRules.map((r) => {
                const editCap = canEditPolicyRule(identity?.permissions, {
                  is_platform_inherited: r.is_platform_inherited,
                  is_ancestor_inherited: r.is_ancestor_inherited,
                  is_system: r.is_system,
                });
                return (
                  <li
                    key={r.id}
                    className="py-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm text-text">{r.name}</div>
                      <div className="mt-1 text-[12px] text-muted">
                        priority {r.priority} · workflow{' '}
                        {r.workflow_name ?? r.workflow_id.slice(0, 8) + '…'}
                        {' · '}
                        {r.enabled ? 'enabled' : 'disabled'}
                      </div>
                      {r.selector && (
                        <div className="mt-1 text-[11px] font-mono text-muted/80">
                          {JSON.stringify(r.selector)}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      {/* R-follow-up #5 — History link routes to the
                          Detail page where the audit timeline lives. */}
                      <Link
                        to={`/teams/${teamID}/policies/${r.id}`}
                        className="text-[12px] text-accent hover:underline"
                      >
                        History
                      </Link>
                      {editCap.allowed && (
                        <button
                          onClick={() => setConfirmDelete(r)}
                          className="text-[12px] text-red-300 hover:underline"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {authoring && (
        <TeamPolicyAuthorDrawer
          teamID={teamID}
          cap={livePriorityCap}
          listError={list.error}
          onClose={() => setAuthoring(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete policy rule?"
          body={`The rule "${confirmDelete.name}" will be removed from this team. Inherited rules continue to apply.`}
          confirmText="Delete"
          danger
          loading={del.isPending}
          error={del.error}
          onConfirm={async () => {
            await del.mutateAsync(confirmDelete.id);
            setConfirmDelete(null);
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

function InheritedRow({
  rule,
  badgeLabel,
  badgeTooltip,
}: {
  rule: TeamPolicyRule;
  badgeLabel: string;
  badgeTooltip?: string;
}) {
  return (
    <li className="py-3 flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <span
            className="rounded bg-bg/60 border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
            title={badgeTooltip}
          >
            {badgeLabel}
          </span>
          <span className="text-sm text-text">{rule.name}</span>
        </div>
        <div className="mt-1 text-[12px] text-muted">
          priority {rule.priority} · workflow{' '}
          {rule.workflow_name ?? rule.workflow_id.slice(0, 8) + '…'}
          {rule.selector_keys.length > 0 && (
            <>
              {' · selector keys: '}
              <span className="font-mono text-[11px]">
                {rule.selector_keys.join(', ')}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="text-[11px] text-muted/80 italic pt-1">
        Read-only · manage on its owning surface
      </div>
    </li>
  );
}

function EmptyState({
  canAuthor,
  onAuthor,
  showAdminShortcut,
}: {
  canAuthor: boolean;
  onAuthor: () => void;
  showAdminShortcut: boolean;
}) {
  return (
    <div className="py-6 text-center space-y-2">
      <p className="text-sm text-muted">No team rules yet.</p>
      {canAuthor && (
        <Button onClick={onAuthor} variant="secondary">
          + Author rule
        </Button>
      )}
      {showAdminShortcut && (
        <div className="pt-2 text-[12px] text-muted/80">
          Platform engineer?{' '}
          <Link
            to="/admin/policies"
            className="text-accent hover:underline"
          >
            Manage at /admin/policies
          </Link>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- */
/* TeamPolicyAuthorDrawer — separate component per OQ2          */
/* ----------------------------------------------------------- */

function buildTeamAuthorSchema(cap: number) {
  return z.object({
    name: z.string().min(1, 'name is required').max(120, 'name is too long'),
    secret_ref_prefix: z.string().max(255).optional(),
    // api#139 — optional provider_type from the backend-owned enum.
    // Empty string = wildcard (omitted from the submitted selector).
    provider_type: z.string().optional(),
    // api#141 — optional operation from the backend-owned enum.
    // Empty string = wildcard (omitted from the submitted selector).
    operation: z.string().optional(),
    workflow_id: z.string().uuid('pick a workflow'),
    priority: z.coerce
      .number()
      .int()
      .min(0, 'priority must be 0 or higher')
      .max(cap - 1, `priority must be < ${cap}`),
    enabled: z.boolean(),
  });
}

type TeamAuthorFormShape = z.infer<ReturnType<typeof buildTeamAuthorSchema>>;

function TeamPolicyAuthorDrawer({
  teamID,
  cap,
  listError,
  onClose,
}: {
  teamID: string;
  cap: number | undefined;
  listError: unknown;
  onClose: () => void;
}) {
  // R-follow-up #2 fail-closed contract: the SPA refuses to render
  // the form when the cap can't be read. The api fails the WHOLE
  // list response with 503 platform_setting_unavailable in that
  // case; the list query's error surfaces here.
  if (cap === undefined) {
    return (
      <Drawer
        title="Author policy rule"
        onClose={onClose}
        footer={
          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
            Could not load the platform-reserved priority cap.{' '}
            {listError instanceof ApiError
              ? toPolicyRuleErrorToast(listError)
              : 'Try again shortly.'}
          </div>
          <p className="text-[12px] text-muted italic">
            Authoring stays disabled until the cap is readable —
            falling back to a stale value would let team rules into
            the platform-reserved band.
          </p>
        </div>
      </Drawer>
    );
  }

  return (
    <TeamPolicyAuthorForm teamID={teamID} cap={cap} onClose={onClose} />
  );
}

function TeamPolicyAuthorForm({
  teamID,
  cap,
  onClose,
}: {
  teamID: string;
  cap: number;
  onClose: () => void;
}) {
  const author = useAuthorTeamPolicyRule(teamID);
  const workflows = useScopedAuthorableWorkflows();
  const eligibleWorkflows = workflows.data ?? [];

  const schema = useMemo(() => buildTeamAuthorSchema(cap), [cap]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<TeamAuthorFormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      secret_ref_prefix: '',
      provider_type: '',
      operation: '',
      workflow_id: eligibleWorkflows[0]?.id ?? '',
      priority: 100,
      enabled: true,
    },
  });

  const onSubmit: SubmitHandler<TeamAuthorFormShape> = async (vals) => {
    // §1 C1 strict: ALWAYS submit environment_kind=non_prod. NO
    // project_id, NO environment_id, NO team_id (URL teamID is the
    // source of truth per §4 / R-follow-up #2's URL-key-wins).
    const selector: Record<string, unknown> = {
      environment_kind: 'non_prod',
    };
    if (vals.secret_ref_prefix) {
      selector.secret_ref_prefix = vals.secret_ref_prefix;
    }
    // api#139 — only set provider_type when a real value is chosen.
    // Blank stays a wildcard; never submit provider_type="" (the
    // server rejects it as provider_type_invalid).
    if (vals.provider_type) {
      selector.provider_type = vals.provider_type;
    }
    // api#141 — only set operation when a real value is chosen. Blank
    // stays a wildcard; never submit operation="" (the server rejects
    // it as operation_invalid).
    if (vals.operation) {
      selector.operation = vals.operation;
    }
    const body: AuthorTeamPolicyRuleInput = {
      name: vals.name,
      selector,
      priority: vals.priority,
      workflow_id: vals.workflow_id,
      enabled: vals.enabled,
    };
    try {
      await author.mutateAsync(body);
      onClose();
    } catch {
      // inline below
    }
  };

  const errorToast =
    author.error instanceof ApiError
      ? toPolicyRuleErrorToast(author.error)
      : undefined;

  return (
    <Drawer
      title="Author team policy rule"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit(onSubmit)}
            disabled={author.isPending}
          >
            {author.isPending ? 'Saving…' : 'Author rule'}
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 text-sm">
        <Field label="Name" error={errors.name?.message}>
          <input
            type="text"
            {...register('name')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
            placeholder="non-prod-team-default"
          />
        </Field>

        <Field
          label="Optional secret_ref_prefix"
          error={errors.secret_ref_prefix?.message}
        >
          <input
            type="text"
            {...register('secret_ref_prefix')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text font-mono"
            placeholder="billing/"
          />
        </Field>

        <Field
          label="Optional provider_type"
          error={errors.provider_type?.message}
        >
          {/* api#139 — backend-owned enum. Blank = wildcard; the
              onSubmit only sets the key when a value is chosen, so the
              server never sees provider_type="". */}
          <select
            {...register('provider_type')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
          >
            <option value="">— any provider —</option>
            {POLICY_SELECTOR_PROVIDER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Optional operation"
          error={errors.operation?.message}
        >
          {/* api#141 — backend-owned enum. Blank = wildcard; the
              onSubmit only sets the key when a value is chosen, so the
              server never sees operation="". */}
          <select
            {...register('operation')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
          >
            <option value="">— any operation —</option>
            {POLICY_SELECTOR_OPERATIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Use workflow" error={errors.workflow_id?.message}>
          <select
            {...register('workflow_id')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
          >
            <option value="">— pick a workflow —</option>
            {eligibleWorkflows.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          {eligibleWorkflows.length === 0 && workflows.isSuccess && (
            <p className="text-[12px] text-muted italic">
              No workflows available for scoped authoring yet — admin
              enables one via /admin/workflows.
            </p>
          )}
        </Field>

        <Field
          label={`Priority (< ${cap} — platform reserved)`}
          error={errors.priority?.message}
        >
          <input
            type="number"
            {...register('priority')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
          />
        </Field>

        <label className="flex items-center gap-2">
          <input type="checkbox" {...register('enabled')} />
          <span>Enabled</span>
        </label>

        <p className="text-[11px] text-muted/80 italic">
          Team rules always match environment_kind=non_prod and cascade
          to every descendant project. They cannot pin a specific
          project or environment.
        </p>

        {errorToast && (
          <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
            {errorToast}
          </div>
        )}
      </form>
    </Drawer>
  );
}

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
    <label className="block space-y-1">
      <span className="text-text font-medium">{label}</span>
      {children}
      {error && (
        <span className="block text-[12px] text-red-300">{error}</span>
      )}
    </label>
  );
}
