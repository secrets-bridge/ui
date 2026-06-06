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
    onSuccess: () => {
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
 * Provider connections visible inside the source project. Powers the
 * destination dropdown on the cross-team submit form per §5: the
 * picker queries the SOURCE project's bindings (NOT the target's) — the
 * cross-team flow ships values to where the source workload lives.
 */
export interface ProviderConnectionSummary {
  id: string;
  label: string; // human-readable e.g. "vault-prod"
  provider_type: string;
}

export function useProviderConnections(
  projectID?: string,
  opts?: { enabled?: boolean },
) {
  const qs = projectID ? `?project_id=${encodeURIComponent(projectID)}` : '';
  return useQuery({
    queryKey: ['provider-connections', projectID ?? 'all'],
    queryFn: () =>
      api.get<ProviderConnectionSummary[]>(`/api/v1/provider-connections${qs}`),
    enabled: opts?.enabled ?? !!projectID,
    staleTime: 30_000,
  });
}

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
  cross_team_destination_unbound:
    'Destination provider connection is not bound to your project.',
  cross_team_keys_empty: 'Add at least one key to fill.',
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
  return CROSS_TEAM_ERROR_MESSAGES[code];
}
