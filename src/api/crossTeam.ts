/**
 * Slice N5 — typed surface for the cross-team integration workflow
 * (api#88 N3 endpoints):
 *
 *   POST   /api/v1/requests/cross-team                — submit
 *   POST   /api/v1/requests/:id/fill                  — Team B provides values
 *   POST   /api/v1/requests/:id/refuse                — Team B refuses
 *   POST   /api/v1/requests/:id/verify                — Team A / security votes
 *   GET    /api/v1/requests/inbox                     — pending_values for me
 *   GET    /api/v1/requests/inbox/count               — badge + per-team count
 *
 * Every mutation invalidates BOTH `['requests']` AND `['inbox']` so
 * the sidebar badge + detail view + inbox list refresh on the same
 * tick. NO field on any type below carries a secret value — fill_*
 * key_values flow through the request body to the api in one direction
 * only and are wiped from React state on submit success per the §5
 * design lock.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import type { AccessRequest } from './types';

export const inboxKey = {
  all: ['inbox'] as const,
  list: (teamID?: string) => ['inbox', 'list', teamID ?? 'all'] as const,
  count: ['inbox', 'count'] as const,
};

/** Body for POST /requests/cross-team. NO values; key NAMES only. */
export interface SubmitCrossTeamInput {
  /**
   * SOURCE project id (the requester's project, whose provider
   * connection receives the values). The api requires it: it checks the
   * destination is bound to this project and scopes the source approver
   * to it (API-N-03).
   */
  project_id: string;
  /**
   * SOURCE environment NAME (not its id). The api resolves it inside
   * `project_id` so an environment-specific destination binding counts.
   * Omitted when the drawer has no environment context; then only
   * project-wide bindings apply, same as the destination dropdown.
   */
  environment?: string;
  target_team_id: string;
  target_project_id: string;
  target_environment_id: string;
  destination_provider_connection_id: string;
  destination_secret_ref: string;
  destination_keys: string[];
  justification: string;
}

export function useSubmitCrossTeam() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitCrossTeamInput) =>
      api.post<AccessRequest>('/api/v1/requests/cross-team', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: inboxKey.all });
    },
  });
}

/**
 * Body for POST /requests/:id/fill. `key_values` is one base64-encoded
 * plaintext per destination key. The form base64-encodes locally before
 * calling so values can be binary-safe; React state holds the plaintext
 * only between keystroke and submit, then is wiped.
 */
export interface FillCrossTeamInput {
  key_values: Record<string, string>; // values are base64
  fill_comment?: string;
}

export function useFillCrossTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FillCrossTeamInput) =>
      api.post<void>(`/api/v1/requests/${id}/fill`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: inboxKey.all });
    },
  });
}

/** Body for POST /requests/:id/refuse. `reason` >= 10 chars per design. */
export interface RefuseCrossTeamInput {
  reason: string;
}

export function useRefuseCrossTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RefuseCrossTeamInput) =>
      api.post<void>(`/api/v1/requests/${id}/refuse`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: inboxKey.all });
    },
  });
}

/** Body for POST /requests/:id/verify. */
export interface VerifyCrossTeamInput {
  decision: 'approve' | 'reject';
  voted_as: 'source' | 'security';
  comment?: string;
}

/**
 * VerifyResponse — structured payload from N3. Drives the
 * "your source vote landed, security still pending" toast + the
 * Approval Chain card.
 *
 * Per §6 sign-off: 200 OK on every successful vote (NOT 412). Caller
 * routes UX from `next_required[]` + `security_approval_required`.
 */
export interface VerifyResponse {
  vote_recorded: boolean;
  voted_as: 'source' | 'security';
  source_votes: number;
  security_approval_required: boolean;
  security_vote_present: boolean;
  next_required: Array<'source_approval' | 'security_approval'>;
}

export function useVerifyCrossTeam(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyCrossTeamInput) =>
      api.post<VerifyResponse>(`/api/v1/requests/${id}/verify`, body),
    // Settled, not just success: a refused vote (out of turn, or another
    // approver got there first) means the card's approvals are stale, so
    // re-read them to show the lane that's actually open now.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: inboxKey.all });
    },
  });
}

/**
 * Inbox list. Fail-closed: caller MUST gate on
 * `hasPermission('secret.value.provide')` at the call site; the
 * sidebar entry won't render without it.
 *
 * `team_id` narrows to one team's inbox when the user covers more than
 * one team. Absent = aggregate over every team in scope.
 */
export function useInbox(teamID?: string, opts?: { enabled?: boolean }) {
  const qs = teamID ? `?team_id=${encodeURIComponent(teamID)}` : '';
  return useQuery({
    queryKey: inboxKey.list(teamID),
    queryFn: () => api.get<AccessRequest[]>(`/api/v1/requests/inbox${qs}`),
    enabled: opts?.enabled ?? true,
    staleTime: 15_000,
  });
}

export interface InboxCount {
  total: number;
  per_team: Array<{ team_id: string; team_name?: string; count: number }>;
}

export function useInboxCount(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: inboxKey.count,
    queryFn: () => api.get<InboxCount>('/api/v1/requests/inbox/count'),
    enabled: opts?.enabled ?? true,
    // Sidebar badge — refresh more often than the list because it's
    // tiny + visible everywhere. 10s is the cap.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });
}

/**
 * Provider connections bound to the source project (+ env). EPIC P
 * (api#92) rewired this endpoint:
 *
 *   - Auth is `secret.request` scoped to (project, env) — out of scope
 *     callers see 403 out_of_scope_project, which the drawer surfaces
 *     as the empty-state CTA per §5.
 *   - Response shape is sanitized `{id, name, type}` only — no scope,
 *     no auth_method, no discovery fields.
 *   - With `environment_id` set, the api returns env-specific + project-
 *     wide bindings; without it, project-wide only. Drawer threads the
 *     env id from its route param so the developer's dropdown narrows
 *     to what's actually consumable in this env.
 *
 * The hook re-exports `useProviderConnectionsForProject` from the new
 * `providerConnections.ts` module so cross-team callers see the locked
 * EPIC P shape without depending on its admin-CRUD surface.
 */
export {
  useProviderConnectionsForProject as useProviderConnections,
} from './providerConnections';
export type { ProviderConnectionSummary } from './types';

/**
 * Stable 403 error codes the cross-team flow returns per §6 design.
 * UI maps these to friendly messages instead of surfacing raw
 * api strings. Centralized here so RequestDetail / Inbox / Fill all
 * agree on phrasing.
 */
export const CROSS_TEAM_ERROR_MESSAGES: Record<string, string> = {
  out_of_scope_team: "You don't have access to this team's inbox.",
  out_of_scope_project: "You don't have access to this project.",
  separation_of_duties_violated:
    'You cannot act on this request because of a separation-of-duties rule.',
  cross_team_invalid_target:
    'Selected target team / project / environment chain is invalid.',
  cross_team_invalid_input:
    'The request is missing a required field (source project, target, destination or justification). Reopen this form from your project environment page and try again.',
  cross_team_destination_unbound:
    'That provider connection is not bound to your source project and environment. Pick one bound to this project, or ask an admin to bind it.',
  cross_team_keys_empty: 'Add at least one key to fill.',
  cross_team_key_not_allowed:
    "One or more keys are outside the destination secret's allowed keys for this project.",
  cross_team_key_not_declared:
    'Only the keys this request asked for can be filled. Remove any extra keys and try again.',
  cross_team_verify_forbidden:
    "You don't hold the permission for this approval lane on the source project. The source vote needs secret.approve and the security vote needs secret.security.approve.",
  cross_team_vote_out_of_turn:
    'This vote is out of order. The source vote comes first, then the security vote when the workflow requires one. Refresh to see the current state.',
  cross_team_prior_vote_invalid:
    'An earlier vote on this request was cast by someone who no longer holds that permission, so it cannot complete. Reject it, or ask the requester to cancel and resubmit.',
  cross_team_already_filled: 'This request has already been filled.',
  fill_window_expired: 'The fill window has expired.',
  cross_team_min_approvers_unsupported:
    'Workflows with multi-approver source side are not supported for cross-team requests in this version.',
  cross_team_status_invalid_transition:
    'This request is no longer in a state that accepts this action.',
  duplicate_vote: 'You already voted on this request.',
};

/**
 * Returns a friendly message for a stable cross-team 403 code, or
 * undefined when the code isn't one of ours (caller falls back to the
 * api's own message).
 */
export function crossTeamErrorMessage(code: string | undefined): string | undefined {
  if (!code) return undefined;
  // Own keys only, so an api message like "constructor" never resolves
  // to an Object.prototype member.
  if (!Object.prototype.hasOwnProperty.call(CROSS_TEAM_ERROR_MESSAGES, code)) {
    return undefined;
  }
  return CROSS_TEAM_ERROR_MESSAGES[code];
}

/**
 * Pulls the stable code out of a cross-team error body. The api's JSON
 * error handler renders these as `{"error": "<code>"}`; `code` and
 * `error_code` are read first for envelopes that carry a separate field.
 * Anything that isn't a known code falls through to the api's message at
 * the call site via `crossTeamErrorMessage` returning undefined.
 */
export function extractCrossTeamErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const obj = body as { code?: unknown; error_code?: unknown; error?: unknown };
  if (typeof obj.code === 'string') return obj.code;
  if (typeof obj.error_code === 'string') return obj.error_code;
  if (typeof obj.error === 'string') return obj.error;
  return undefined;
}

/** Form state the submit drawer turns into a request body. */
export interface CrossTeamSubmitForm {
  /** Source project id, from the page that opened the drawer. */
  sourceProjectID: string | undefined;
  /** Source environment id, when the drawer has an environment context. */
  sourceEnvironmentID: string | undefined;
  /** Name of `sourceEnvironmentID` inside the source project. */
  sourceEnvironmentName: string | undefined;
  targetTeamID: string;
  targetProjectID: string;
  targetEnvironmentID: string;
  destinationProviderConnectionID: string;
  destinationSecretRef: string;
  destinationKeys: string[];
  justification: string;
}

export type CrossTeamSubmitBuild =
  | { ok: true; body: SubmitCrossTeamInput }
  | { ok: false; errors: string[] };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates the drawer's form and builds the POST body. Fail closed:
 * every id must be a real UUID (a half-loaded dropdown or a label can't
 * reach the POST), and no body is built without the source project the
 * api requires. When the drawer has an environment id it must resolve to
 * a name, otherwise the api would only honour project-wide bindings and
 * refuse a connection the dropdown offered.
 */
export function buildCrossTeamSubmitBody(f: CrossTeamSubmitForm): CrossTeamSubmitBuild {
  const errors: string[] = [];
  const sourceProjectID = f.sourceProjectID ?? '';
  if (!UUID_RE.test(sourceProjectID)) {
    errors.push(
      'Source project is missing. Open this form from one of your project environment pages.',
    );
  }
  const sourceEnvName = f.sourceEnvironmentName?.trim() ?? '';
  if (f.sourceEnvironmentID && sourceEnvName === '') {
    errors.push(
      "Source environment couldn't be resolved for this project. Reload the page and try again.",
    );
  }
  if (!UUID_RE.test(f.targetTeamID)) errors.push('Select a target team.');
  if (!UUID_RE.test(f.targetProjectID)) errors.push('Select a target project.');
  if (!UUID_RE.test(f.targetEnvironmentID)) errors.push('Select a target environment.');
  if (!UUID_RE.test(f.destinationProviderConnectionID))
    errors.push('Select a destination provider connection.');
  const secretRef = f.destinationSecretRef.trim();
  if (secretRef.length === 0) errors.push('Enter the destination secret reference.');
  if (f.destinationKeys.length === 0) errors.push('Add at least one key to fill.');
  const justification = f.justification.trim();
  if (justification.length < 10) {
    const missing = 10 - justification.length;
    errors.push(
      `Justification needs ${missing} more character${missing === 1 ? '' : 's'}.`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  const body: SubmitCrossTeamInput = {
    project_id: sourceProjectID,
    target_team_id: f.targetTeamID,
    target_project_id: f.targetProjectID,
    target_environment_id: f.targetEnvironmentID,
    destination_provider_connection_id: f.destinationProviderConnectionID,
    destination_secret_ref: secretRef,
    destination_keys: f.destinationKeys,
    justification,
  };
  if (f.sourceEnvironmentID) body.environment = sourceEnvName;
  return { ok: true, body };
}
