/**
 * Access-request API surface. Wraps the BRD §16 request lifecycle:
 *
 *   POST   /api/v1/requests/read           — submit a read request
 *   GET    /api/v1/requests                — list (filter: requester_id, status)
 *   GET    /api/v1/requests/:id            — get one with inline approvals
 *   POST   /api/v1/requests/:id/approve    — cast an approve vote
 *   POST   /api/v1/requests/:id/reject     — cast a reject vote with reason
 *   POST   /api/v1/requests/:id/cancel     — withdraw your own request
 *
 * Wraps + GitOps observations live on adjacent paths and have their own
 * hook in this file:
 *
 *   GET    /api/v1/requests/:id/wraps/:wid              — single-shot
 *   GET    /api/v1/requests/:id/gitops                 — observation list
 *
 * Mutation strategy: every approve / reject / cancel invalidates BOTH
 * the list query AND the per-id query so the list and the detail page
 * agree without a manual refetch.
 *
 * Hard-rule reminder: the wrap-retrieval endpoint is single-shot. The
 * UI must NEVER call it speculatively — it's only invoked from the
 * Reveal button click in the detail page. Other reads use the
 * value-free wrap summaries surfaced inside the GET /requests/:id
 * response.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { useSensitiveMutation } from './sensitiveMutation';
import type {
  AccessRequest,
  PatchRequestInput,
  ReadRequestInput,
} from './types';

export const requestsKey = {
  all: ['requests'] as const,
  list: (filter: ListFilter) => ['requests', 'list', filter] as const,
  one: (id: string) => ['requests', 'one', id] as const,
  gitops: (id: string) => ['requests', 'gitops', id] as const,
};

export interface ListFilter {
  requester_id?: string;
  status?: AccessRequest['status'];
}

export function useRequests(filter: ListFilter = {}, opts?: { enabled?: boolean }) {
  const qs = new URLSearchParams();
  if (filter.requester_id) qs.set('requester_id', filter.requester_id);
  if (filter.status) qs.set('status', filter.status);
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: requestsKey.list(filter),
    queryFn: () => api.get<AccessRequest[]>(`/api/v1/requests${suffix}`),
    enabled: opts?.enabled ?? true,
  });
}

export function useRequest(id: string | undefined) {
  return useQuery({
    queryKey: id ? requestsKey.one(id) : requestsKey.all,
    queryFn: () => api.get<AccessRequest>(`/api/v1/requests/${id}`),
    enabled: !!id,
  });
}

/**
 * Decision bodies carry only the decision text. The api takes the
 * acting approver / canceller from the session (API-01, api#168) and
 * no longer parses an id from the body, so the UI doesn't send one
 * (UI-N-01).
 */
export interface ApproveBody {
  comment?: string;
}

export function useApproveRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApproveBody) =>
      api.post<void>(`/api/v1/requests/${id}/approve`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: requestsKey.one(id) });
      qc.invalidateQueries({ queryKey: requestsKey.all });
    },
  });
}

export interface RejectBody {
  reason: string;
}

export function useRejectRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RejectBody) =>
      api.post<void>(`/api/v1/requests/${id}/reject`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: requestsKey.one(id) });
      qc.invalidateQueries({ queryKey: requestsKey.all });
    },
  });
}

export function useCancelRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>(`/api/v1/requests/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: requestsKey.one(id) });
      qc.invalidateQueries({ queryKey: requestsKey.all });
    },
  });
}

/**
 * Value-free wrap summaries for a request. NEVER carries plaintext.
 * Used by the Wraps card on the request detail page to render one row
 * per key with a ready / consumed status pill BEFORE the user clicks
 * Reveal.
 */
export interface WrapSummary {
  id: string;
  key_name?: string;
  consumed: boolean;
  expires_at: string;
}

export function useRequestWraps(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? [...requestsKey.one(id), 'wraps'] : requestsKey.all,
    queryFn: () => api.get<WrapSummary[]>(`/api/v1/requests/${id}/wraps`),
    enabled: enabled && !!id,
    retry: false,
  });
}

/**
 * Single-shot wrap reveal — the platform's load-bearing security UX.
 *
 * HARD RULE: called only from the reveal (pages/request/Reveal.tsx),
 * after the requester's click and an MFA step-up, for the wraps of the
 * reveal session it just opened. NEVER call speculatively or in an
 * effect: the api consumes the wrap atomically on this call. A second
 * fetch is refused (410 once consumed, 403 outside its open session).
 *
 * The response value is base64-encoded plaintext. The caller decodes it
 * as UTF-8 (lib/decodeSecret.ts), shows it once and drops it when the
 * reveal ends. Its byte length and hash are never displayed.
 *
 * Identity is derived server-side from the session cookie — the SPA
 * never sends a user_id on this call (ui#96 / UI-01).
 */
export interface RevealedWrap {
  wrap_id: string;
  request_id: string;
  key_name?: string;
  value: string; // base64 plaintext
  byte_length: number;
  content_hash: string;
  algorithm: string;
}

export async function revealWrap(
  requestId: string,
  wrapId: string,
): Promise<RevealedWrap> {
  return api.get<RevealedWrap>(
    `/api/v1/requests/${requestId}/wraps/${wrapId}`,
  );
}

export function useSubmitReadRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ReadRequestInput) =>
      api.post<AccessRequest>('/api/v1/requests/read', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: requestsKey.all }),
  });
}

/**
 * Submit a patch request. The caller is responsible for clearing
 * `key_values` from local state immediately after the promise settles
 * — every plaintext string survives in JS heap until GC otherwise.
 * The variables carry the new values: sensitive (UI-N-02).
 */
export function useSubmitPatchRequest() {
  const qc = useQueryClient();
  return useSensitiveMutation({
    mutationFn: (body: PatchRequestInput) =>
      api.post<AccessRequest>('/api/v1/requests', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: requestsKey.all }),
  });
}

/**
 * GitOps observation rows for a request. Returns 404 when the §26
 * feature is OFF (api.SB_GITOPS_ENABLED=false) — the detail page
 * detects this and renders a disabled banner rather than an error.
 */
export interface GitOpsObservation {
  id: string;
  request_id: string;
  application_name: string;
  application_namespace?: string;
  project_name?: string;
  cluster_name?: string;
  status: 'queued' | 'active' | 'applied' | 'failed' | 'applied_unverified';
  observed_state?: Record<string, unknown>;
  timeout_at?: string;
  created_at: string;
  updated_at?: string;
}

export function useRequestGitOps(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? requestsKey.gitops(id) : requestsKey.all,
    queryFn: () =>
      api.get<GitOpsObservation[]>(`/api/v1/requests/${id}/gitops`),
    enabled: enabled && !!id,
    retry: false,
  });
}
