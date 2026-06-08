/**
 * EPIC Q (api#99) Slice Q3 — UI capability helpers.
 *
 * Per §5 Q15 sign-off: DO NOT overload `hasPermission('integration.bind')`
 * to return true for `integration.edit` holders. That would confuse the
 * permission semantics across the app. Instead, expose specific
 * capability helpers that name the action AND the relevant context,
 * and pick the endpoint explicitly based on which permission carried
 * the call.
 *
 * Used by ProviderConnectionsCard + BinderPickerDrawer. Never imported
 * into generic auth state.
 */

import type { MyEnvironment } from '../api/types';

/**
 * Capability output the card / drawer act on. `via` answers "which
 * permission carried this action?" so the caller selects the right
 * endpoint family:
 *
 *   via = 'integration.edit'  → admin URLs (POST /provider-connections/:id/bindings)
 *   via = 'integration.bind'  → project-anchored URLs (POST /projects/:id/provider-connection-bindings)
 *
 * `null` via means the action is not allowed at all from this surface
 * (caller hides the CTA).
 */
export interface BindCapability {
  allowed: boolean;
  via: 'integration.edit' | 'integration.bind' | null;
  reason?: 'prod_managed_by_platform' | 'no_perm';
}

/**
 * Can the actor bind / unbind a provider connection on the given env?
 *
 * - integration.edit holders can act on ANY env (including prod) via
 *   the admin path.
 * - integration.bind holders can act only on non-prod envs via the
 *   scoped path. Prod envs are platform-team territory by §2 Q4=A.
 *
 * The caller (card or drawer) is responsible for passing the actor's
 * permission set via the `permissions` array — typically pulled from
 * `useAuth().identity?.permissions`. The helper does NOT call useAuth
 * itself so it stays pure + testable.
 */
export function canBindProviderConnectionOnEnv(
  permissions: readonly string[] | undefined,
  env: Pick<MyEnvironment, 'kind'>,
): BindCapability {
  const perms = permissions ?? [];
  if (perms.includes('integration.edit')) {
    return { allowed: true, via: 'integration.edit' };
  }
  if (env.kind === 'prod') {
    return {
      allowed: false,
      via: null,
      reason: 'prod_managed_by_platform',
    };
  }
  if (perms.includes('integration.bind')) {
    return { allowed: true, via: 'integration.bind' };
  }
  return { allowed: false, via: null, reason: 'no_perm' };
}

/**
 * Can the actor unbind THIS specific binding? Distinct from the bind
 * capability because the binding's stored project_id + environment
 * matter, not the current page's env. Project-wide bindings
 * (`environment_id IS NULL`) are admin-only per §4 — scoped users
 * never see an enabled Unbind on them.
 */
export function canUnbindBinding(
  permissions: readonly string[] | undefined,
  binding: {
    environment_id: string | null;
    environment_kind?: 'non_prod' | 'prod';
  },
): BindCapability {
  const perms = permissions ?? [];
  const isAdmin = perms.includes('integration.edit');
  if (isAdmin) {
    return { allowed: true, via: 'integration.edit' };
  }
  if (binding.environment_id === null) {
    // Project-wide binding. Always platform-managed.
    return { allowed: false, via: null, reason: 'prod_managed_by_platform' };
  }
  if (binding.environment_kind === 'prod') {
    return { allowed: false, via: null, reason: 'prod_managed_by_platform' };
  }
  if (perms.includes('integration.bind')) {
    return { allowed: true, via: 'integration.bind' };
  }
  return { allowed: false, via: null, reason: 'no_perm' };
}

/* ------------------------------------------------------------------ */
/* EPIC R (api#108) Slice R3 — scoped policy authoring                */
/* ------------------------------------------------------------------ */

/**
 * Capability output for the project policies page.
 *
 * Per §5 correction 2 from the design pass: `policy.edit` does NOT
 * auto-cover `policy.author`, server-side OR as a UI shortcut. The two
 * permissions stay distinct; the project-anchored authoring CTA
 * appears ONLY for `policy.author` holders. `policy.edit` holders
 * see an admin shortcut (separate helper below) instead.
 */
export interface PolicyAuthorCapability {
  allowed: boolean;
  /**
   * The permission that carried the action.
   *
   *   - `'policy.author'` — project-anchored URLs
   *     (POST /projects/:id/policy-rules)
   *   - `null` — actor lacks scoped author; caller hides the CTA.
   *
   * Note that `'policy.edit'` is deliberately NOT a value here —
   * platform admins use `/admin/policies` for global rules; the
   * scoped page does NOT cross-trip them into the scoped route.
   */
  via: 'policy.author' | null;
  reason?: 'no_perm' | 'platform_owned';
}

/**
 * Can the actor author scoped policy rules on the given project?
 *
 * The `permissions` array is the actor's deduped set (typically pulled
 * from `useAuth().identity?.permissions`). The helper does NOT call
 * `useAuth` itself so it stays pure + testable.
 *
 * Today we treat `policy.author` as a global flag — the api re-checks
 * `EffectiveProjectAccess(policy.author, projectID)` server-side. When
 * the SPA gains a per-project capability cache (api#27 RBAC P0-2),
 * this helper picks the project from the cache instead.
 */
export function canAuthorProjectPolicy(
  permissions: readonly string[] | undefined,
  _project: { id: string },
): PolicyAuthorCapability {
  const perms = permissions ?? [];
  if (perms.includes('policy.author')) {
    return { allowed: true, via: 'policy.author' };
  }
  return { allowed: false, via: null, reason: 'no_perm' };
}

/**
 * Can the actor edit / delete THIS specific policy rule via the
 * scoped route?
 *
 * Returns `{allowed: false, reason: 'platform_owned'}` for inherited
 * platform rules (`is_platform_inherited=true`) regardless of perms —
 * even admins acting on the project page route to `/admin/policies`,
 * NOT through the project-anchored URLs. Keeps the routes from
 * mode-switching by perm.
 */
export function canEditPolicyRule(
  permissions: readonly string[] | undefined,
  rule: {
    is_platform_inherited: boolean;
    /** R-follow-up #3 — inherited from a team rule cascading into a project view. */
    is_team_inherited?: boolean;
    /** R-follow-up #3 — inherited from an ancestor team in a team view. */
    is_ancestor_inherited?: boolean;
    is_system: boolean;
  },
): PolicyAuthorCapability {
  const inherited =
    rule.is_platform_inherited ||
    rule.is_team_inherited === true ||
    rule.is_ancestor_inherited === true;
  if (inherited || rule.is_system) {
    return { allowed: false, via: null, reason: 'platform_owned' };
  }
  const perms = permissions ?? [];
  if (perms.includes('policy.author')) {
    return { allowed: true, via: 'policy.author' };
  }
  return { allowed: false, via: null, reason: 'no_perm' };
}

/* ------------------------------------------------------------------ */
/* R-follow-up #3 (api#114) — team-scoped policy authoring            */
/* ------------------------------------------------------------------ */

/**
 * Can the actor author scoped policy rules on the given team?
 *
 * Per §5 C3: consumes the actor's resolved team coverage (the team_ids
 * the `policy.author` grants cover, subtree-expanded by the api's
 * `EffectiveTeamAccess`). The SPA pulls this via
 * `useMyPolicyAuthorTeamCoverage`. Passing `global: true` covers every
 * team.
 *
 * §5 C4 lock — `policy.edit` does NOT auto-allow on the team URL
 * family. Platform admins use `/admin/policies` for team rules; the
 * team page is `policy.author` only.
 */
export function canAuthorTeamPolicy(
  coverage: { global: boolean; team_ids: readonly string[] } | undefined,
  teamID: string,
): PolicyAuthorCapability {
  if (!coverage) {
    return { allowed: false, via: null, reason: 'no_perm' };
  }
  if (coverage.global) {
    return { allowed: true, via: 'policy.author' };
  }
  if (coverage.team_ids.includes(teamID)) {
    return { allowed: true, via: 'policy.author' };
  }
  return { allowed: false, via: null, reason: 'no_perm' };
}

/**
 * Does the actor hold global `policy.edit`?
 *
 * Drives the §5 Q15 admin shortcut on the project policies page —
 * `policy.edit` holders see a "Manage at /admin/policies" link in the
 * empty state; pure `policy.author` users do not.
 */
export function canManagePlatformPolicy(
  permissions: readonly string[] | undefined,
): boolean {
  const perms = permissions ?? [];
  return perms.includes('policy.edit');
}
