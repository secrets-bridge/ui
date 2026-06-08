/**
 * EPIC R (api#108) Slice R3 — project-anchored scoped policy authoring
 * page.
 *
 *   /projects/:id/policies
 *
 * Shows the project's scoped rules plus inherited platform rules. Per
 * §4 correction 1 the inherited rows arrive with `selector_keys` only
 * (no raw selector values) and render with a `[platform]` badge +
 * disabled actions. Per §5 Q15 the empty-state surfaces a "Manage at
 * /admin/policies" link ONLY for `policy.edit` holders.
 *
 * The Author drawer (defined at the bottom of this file) is the §5 Q14
 * guided form: required env picker (radio: any non_prod OR specific
 * env from a dropdown filtered to non_prod), optional secret_ref_prefix,
 * workflow dropdown (curated server-side per R-follow-up #1 / api#118),
 * priority strictly below the platform-reserved band.
 *
 * R-follow-up #2 (api#113) — the priority cap is no longer hardcoded.
 * The drawer reads the live cap via `usePlatformReservedPriority()`
 * and FAILS CLOSED (form disabled + red banner) while loading or on
 * error rather than falling back to 9000 — a stale fallback would
 * defeat the gate that keeps scoped authors out of the platform band.
 */

import { useMemo, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';

import { ApiError } from '../api/client';
import { useMe } from '../api/me';
import {
  toPolicyRuleErrorToast,
} from '../api/policyErrors';
import {
  useAuthorPolicyRule,
  useDeletePolicyRule,
  useProjectPolicyRules,
} from '../api/projectPolicyRules';
import type {
  AuthorPolicyRuleInput,
  MyEnvironment,
  PolicyRule,
} from '../api/types';
import { usePlatformReservedPriority } from '../api/platformSettings';
import {
  useScopedAuthorableWorkflows,
  useWorkflows,
} from '../api/workflows';
import {
  canAuthorProjectPolicy,
  canEditPolicyRule,
  canManagePlatformPolicy,
} from '../auth/capabilities';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Drawer } from '../ui/Drawer';
import { PageHeader } from '../ui/PageHeader';

export function ProjectPolicies() {
  const { id: projectId } = useParams<{ id: string }>();
  const me = useMe();
  const { identity } = useAuth();
  const list = useProjectPolicyRules(projectId);
  const workflows = useWorkflows();
  const del = useDeletePolicyRule(projectId ?? '');

  const project = me.data?.projects.find((p) => p.id === projectId);
  const nonProdEnvs = useMemo(
    () => (project?.environments ?? []).filter((e) => e.kind === 'non_prod'),
    [project?.environments],
  );

  const [authoring, setAuthoring] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PolicyRule | null>(null);

  const workflowName = (id: string) =>
    workflows.data?.find((w) => w.id === id)?.name ?? id.slice(0, 8) + '…';

  if (me.isLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Loading project…</p>
          </CardBody>
        </Card>
      </div>
    );
  }
  if (!project) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">
              You don't have access to this project.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const authorCap = canAuthorProjectPolicy(identity?.permissions, project);
  const showAdminShortcut = canManagePlatformPolicy(identity?.permissions);

  const scopedRules = (list.data ?? []).filter(
    (r) => !r.is_platform_inherited && !r.is_team_inherited,
  );
  const inheritedRules = (list.data ?? []).filter(
    (r) => r.is_platform_inherited || r.is_team_inherited,
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <PageHeader
        title={`${project.name} · Project policies`}
        description="Author non-prod policy rules for this project. Platform global rules are inherited (read-only here)."
        actions={
          authorCap.allowed ? (
            <Button onClick={() => setAuthoring(true)}>+ Author rule</Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">
            Inherited (platform + team)
          </h3>
          <span className="text-muted text-xs">
            {inheritedRules.length} rule{inheritedRules.length === 1 ? '' : 's'}
          </span>
        </CardHeader>
        <CardBody>
          {inheritedRules.length === 0 ? (
            <p className="text-sm text-muted">
              No platform or team rules apply to this project.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {inheritedRules.map((r) => (
                <li
                  key={r.id}
                  className="py-3 flex items-start justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded bg-bg/60 border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted"
                        title={
                          r.is_team_inherited && r.team_name
                            ? `From team ${r.team_name}`
                            : undefined
                        }
                      >
                        {r.is_team_inherited ? 'team' : 'platform'}
                      </span>
                      <span className="text-sm text-text">{r.name}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-muted">
                      priority {r.priority} · workflow{' '}
                      {r.workflow_name ?? workflowName(r.workflow_id)}
                      {r.selector_keys.length > 0 && (
                        <>
                          {' · selector keys: '}
                          <span className="font-mono text-[11px]">
                            {r.selector_keys.join(', ')}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted/80 italic pt-1">
                    {r.is_team_inherited
                      ? `Read-only · manage on team page${r.team_name ? ` (${r.team_name})` : ''}`
                      : 'Read-only · use /admin/policies'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">Project rules</h3>
          <span className="text-muted text-xs">
            {scopedRules.length} rule{scopedRules.length === 1 ? '' : 's'}
          </span>
        </CardHeader>
        <CardBody>
          {scopedRules.length === 0 ? (
            <EmptyState
              canAuthor={authorCap.allowed}
              onAuthor={() => setAuthoring(true)}
              showAdminShortcut={showAdminShortcut}
            />
          ) : (
            <ul className="divide-y divide-border">
              {scopedRules.map((r) => {
                const editCap = canEditPolicyRule(identity?.permissions, r);
                return (
                  <li
                    key={r.id}
                    className="py-3 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="text-sm text-text">{r.name}</div>
                      <div className="mt-1 text-[12px] text-muted">
                        priority {r.priority} · workflow{' '}
                        {workflowName(r.workflow_id)}{' '}
                        · {r.enabled ? 'enabled' : 'disabled'}
                      </div>
                      {r.selector && (
                        <div className="mt-1 text-[11px] font-mono text-muted/80">
                          {JSON.stringify(r.selector)}
                        </div>
                      )}
                    </div>
                    {editCap.allowed && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => setConfirmDelete(r)}
                          className="text-[12px] text-red-300 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      {authoring && (
        <AuthorPolicyDrawer
          projectId={project.id}
          nonProdEnvs={nonProdEnvs}
          onClose={() => setAuthoring(false)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Delete policy rule?"
          body={`The rule "${confirmDelete.name}" will be removed from this project. Platform global rules continue to apply.`}
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
      <p className="text-sm text-muted">
        No project rules yet.
      </p>
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
/* Author drawer (guided form, §5 Q14 lock — no raw JSON)       */
/* ----------------------------------------------------------- */

/**
 * R-follow-up #2 (api#113) — schema is a factory keyed on the live
 * platform-reserved-priority cap. Built per-mount so the `< cap`
 * validation reflects whatever admin has flipped to right now.
 */
function buildAuthorSchema(cap: number) {
  return z
    .object({
      name: z
        .string()
        .min(1, 'name is required')
        .max(120, 'name is too long'),
      env_match: z.enum(['any_non_prod', 'specific']),
      environment_id: z.string().optional(),
      secret_ref_prefix: z.string().max(255).optional(),
      workflow_id: z.string().uuid('pick a workflow'),
      priority: z.coerce
        .number()
        .int()
        .min(0, 'priority must be 0 or higher')
        .max(cap - 1, `priority must be < ${cap}`),
      enabled: z.boolean(),
    })
    .superRefine((val, ctx) => {
      if (val.env_match === 'specific' && !val.environment_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['environment_id'],
          message: 'pick a non-prod environment',
        });
      }
    });
}

type AuthorFormShape = z.infer<ReturnType<typeof buildAuthorSchema>>;

function AuthorPolicyDrawer({
  projectId,
  nonProdEnvs,
  onClose,
}: {
  projectId: string;
  nonProdEnvs: MyEnvironment[];
  onClose: () => void;
}) {
  // R-follow-up #2 (api#113) — read the cap LIVE. §3 correction 2:
  // FAIL CLOSED on isLoading/isError. The wrapper renders one of
  // three children — loading / error / form — and only the form
  // branch (`cap.value` is a real number) mounts useForm, so the
  // Zod schema reflects the live cap at mount time.
  const cap = usePlatformReservedPriority();

  if (cap.isLoading) {
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
          <div className="rounded border border-border bg-bg px-3 py-2 text-[12px] text-muted">
            Loading platform settings…
          </div>
          <p className="text-[12px] text-muted italic">
            The priority cap is a live platform setting — authoring
            stays disabled until it loads.
          </p>
        </div>
      </Drawer>
    );
  }

  if (cap.isError || cap.value === undefined) {
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
            Could not load platform settings.{' '}
            {cap.error instanceof ApiError
              ? toPolicyRuleErrorToast(cap.error)
              : 'Try again shortly.'}
          </div>
          <p className="text-[12px] text-muted italic">
            Authoring stays disabled until the cap is readable —
            falling back to a stale value would let scoped rules into
            the platform-reserved band.
          </p>
        </div>
      </Drawer>
    );
  }

  return (
    <AuthorPolicyForm
      projectId={projectId}
      nonProdEnvs={nonProdEnvs}
      cap={cap.value}
      onClose={onClose}
    />
  );
}

function AuthorPolicyForm({
  projectId,
  nonProdEnvs,
  cap,
  onClose,
}: {
  projectId: string;
  nonProdEnvs: MyEnvironment[];
  cap: number;
  onClose: () => void;
}) {
  const author = useAuthorPolicyRule(projectId);
  // R-follow-up #1 (api#118) — Server-side curated list replaces the
  // EPIC R §5 correction 3 defensive client-side filter. The api
  // returns only workflows where enabled=true AND
  // scoped_policy_authorable=true; platform admin curates the
  // surface via the admin Workflows page. No client-side filtering
  // needed; the SPA renders what arrives.
  const workflows = useScopedAuthorableWorkflows();
  const eligibleWorkflows = workflows.data ?? [];

  const schema = useMemo(() => buildAuthorSchema(cap), [cap]);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AuthorFormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      env_match: 'any_non_prod',
      environment_id: '',
      secret_ref_prefix: '',
      workflow_id: eligibleWorkflows[0]?.id ?? '',
      priority: 100,
      enabled: true,
    },
  });

  const envMatch = watch('env_match');

  const onSubmit: SubmitHandler<AuthorFormShape> = async (vals) => {
    const selector: Record<string, unknown> = {
      project_id: projectId,
    };
    if (vals.env_match === 'any_non_prod') {
      selector.environment_kind = 'non_prod';
    } else if (vals.environment_id) {
      selector.environment_id = vals.environment_id;
      selector.environment_kind = 'non_prod';
    }
    if (vals.secret_ref_prefix) {
      selector.secret_ref_prefix = vals.secret_ref_prefix;
    }
    const body: AuthorPolicyRuleInput = {
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
      // error rendered inline below
    }
  };

  const errorToast =
    author.error instanceof ApiError
      ? toPolicyRuleErrorToast(author.error)
      : undefined;

  return (
    <Drawer
      title="Author policy rule"
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
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="space-y-4 text-sm"
      >
        <Field
          label="Name"
          error={errors.name?.message}
        >
          <input
            type="text"
            {...register('name')}
            className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
            placeholder="my-non-prod-policy"
          />
        </Field>

        <fieldset className="space-y-2">
          <legend className="text-text font-medium">
            Match this rule when…
          </legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="any_non_prod"
              {...register('env_match')}
            />
            <span>Any non-production environment</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              value="specific"
              {...register('env_match')}
            />
            <span>Specific environment</span>
          </label>
          {envMatch === 'specific' && (
            <select
              {...register('environment_id')}
              className="w-full rounded border border-border bg-bg px-2 py-1 text-text"
            >
              <option value="">— pick a non-prod env —</option>
              {nonProdEnvs.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} (non_prod)
                </option>
              ))}
            </select>
          )}
          {errors.environment_id && (
            <p className="text-[12px] text-red-300">
              {errors.environment_id.message}
            </p>
          )}
          {nonProdEnvs.length === 0 && (
            <p className="text-[12px] text-muted italic">
              This project has no non-prod environments yet — admin
              creates them via /admin/projects.
            </p>
          )}
        </fieldset>

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
          label="Use workflow"
          error={errors.workflow_id?.message}
        >
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
