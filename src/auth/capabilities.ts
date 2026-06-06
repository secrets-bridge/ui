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
