/**
 * EPIC R (api#108) Slice R3 — stable error code → friendly toast
 * messages for the project-anchored scoped policy.author endpoints.
 *
 * Per §5 correction 1 from the design pass: this module is DELIBERATELY
 * separate from `providerConnections.ts`. Policy and provider-connection
 * domains are different; folding their error routers together would
 * make the API surface harder to maintain (each domain grows codes
 * independently, and a code rename in one shouldn't ripple through the
 * other's reviewers).
 *
 * Code reference: `api/internal/handlers/project_policy_rules.go`
 * `mapPolicyServiceErr`. The 8 stable codes mirror the api's locked
 * envelope.
 */

import type { ApiError } from './client';

const POLICY_RULE_ERROR_MESSAGES: Record<string, string> = {
  policy_not_found: 'Policy rule not found.',
  platform_policy_not_editable:
    'Platform global policy rules are administered via /admin/policies.',
  out_of_scope_policy:
    "You don't have permission to author policy on this project.",
  policy_selector_mismatch:
    "The selector's project must match this project.",
  prod_policy_not_allowed_for_scope:
    'Scoped policy authors cannot create rules that match production environments.',
  policy_scope_too_broad:
    'Scoped policy rules must constrain to a non-prod environment.',
  policy_priority_reserved:
    'Priority is reserved for platform policy rules. Use a value below the cap.',
  policy_environment_not_in_project:
    "The selector's environment does not belong to this project.",
  // R-follow-up #1 (api#118) — closes the §5 correction 3 gap: scoped
  // authors hit this when they pick a workflow platform admin hasn't
  // opted into the scoped surface yet.
  workflow_not_authorable_for_scope:
    'The selected workflow is not enabled for scoped policy authoring. Pick another or ask platform to enable it.',
  // R-follow-up #2 (api#113) — platform_settings admin endpoints. These
  // surface in two places: the PlatformSettings admin page (direct
  // mutation) AND the Author drawer when the live-cap read fails (the
  // `platform_setting_unavailable` path drives the §3 correction 2
  // FAIL-CLOSED banner).
  unknown_platform_setting: 'Platform setting not found.',
  invalid_platform_setting:
    'Value is outside the allowed range. Refresh and try again.',
  platform_setting_unavailable:
    'Platform settings are temporarily unavailable. Try again shortly.',
};

/**
 * Refinements for `policy_scope_too_broad.reason` so the UI surfaces a
 * specific cause instead of the generic top-level message.
 *
 * Pinned to the four §6 variants the api emits.
 */
const POLICY_SCOPE_TOO_BROAD_REASON_MESSAGES: Record<string, string> = {
  env_constraint_missing:
    'Pick a non-prod environment or selector option (the rule must constrain to non-prod).',
  env_kind_invalid:
    'environment_kind must be "non_prod" for scoped rules.',
  selector_empty:
    'Selector cannot be empty. Add at least an environment constraint.',
  env_kind_id_inconsistent:
    'environment_kind and environment_id must agree (both non-prod).',
};

/**
 * Returns the friendly user-facing string for a given stable code.
 * `undefined` when the code is not one we know about; caller falls
 * back to the api's `message` field or a generic toast.
 */
export function policyRuleErrorMessage(
  code: string | undefined,
): string | undefined {
  if (!code) return undefined;
  return POLICY_RULE_ERROR_MESSAGES[code];
}

/**
 * Convenience: pull `{error_code, reason?, cap?, env_kind?}` from an
 * EPIC R envelope. Mirrors `extractProviderConnectionErrorCode` shape
 * but exclusively reads the EPIC R fields.
 */
export interface PolicyRuleErrorDetail {
  code: string | undefined;
  reason?: string;
  cap?: number;
  envKind?: string;
  /** R-follow-up #2 (api#113) — bounds carried on invalid_platform_setting envelopes. */
  min?: number;
  max?: number;
}

export function extractPolicyRuleError(err: ApiError): PolicyRuleErrorDetail {
  const out: PolicyRuleErrorDetail = { code: undefined };
  if (err.body && typeof err.body === 'object') {
    const obj = err.body as {
      error_code?: unknown;
      reason?: unknown;
      cap?: unknown;
      env_kind?: unknown;
      min?: unknown;
      max?: unknown;
    };
    if (typeof obj.error_code === 'string') out.code = obj.error_code;
    if (typeof obj.reason === 'string') out.reason = obj.reason;
    if (typeof obj.cap === 'number') out.cap = obj.cap;
    if (typeof obj.env_kind === 'string') out.envKind = obj.env_kind;
    if (typeof obj.min === 'number') out.min = obj.min;
    if (typeof obj.max === 'number') out.max = obj.max;
  }
  return out;
}

/**
 * One-shot translator: ApiError → friendly toast.
 *
 * Prefers a specific `policy_scope_too_broad.reason` variant message
 * over the generic top-level message. Falls back to the api-supplied
 * `message` field, then to a generic copy.
 */
export function toPolicyRuleErrorToast(err: ApiError): string {
  const detail = extractPolicyRuleError(err);
  if (
    detail.code === 'policy_scope_too_broad' &&
    detail.reason &&
    POLICY_SCOPE_TOO_BROAD_REASON_MESSAGES[detail.reason]
  ) {
    return POLICY_SCOPE_TOO_BROAD_REASON_MESSAGES[detail.reason];
  }
  if (detail.code === 'policy_priority_reserved' && typeof detail.cap === 'number') {
    return `Priority must be less than ${detail.cap} (platform reserved).`;
  }
  if (
    detail.code === 'invalid_platform_setting' &&
    typeof detail.min === 'number' &&
    typeof detail.max === 'number'
  ) {
    return `Value must be between ${detail.min} and ${detail.max}.`;
  }
  const generic = policyRuleErrorMessage(detail.code);
  if (generic) return generic;
  if (err.body && typeof err.body === 'object') {
    const obj = err.body as { message?: unknown };
    if (typeof obj.message === 'string') return obj.message;
  }
  return 'Could not save the policy rule.';
}
