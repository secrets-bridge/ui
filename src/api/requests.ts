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
 *   GET    /api/v1/requests/:id/wraps/:wid?user_id=…   — single-shot
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

export function useRequests(filter: ListFilter = {}) {
  const qs = new URLSearchParams();
  if (filter.requester_id) qs.set('requester_id', filter.requester_id);
  if (filter.status) qs.set('status', filter.status);
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: requestsKey.list(filter),
    queryFn: () => api.get<AccessRequest[]>(`/api/v1/requests${suffix}`),
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
 * Decision bodies carry `approver_id` / `actor_id` explicitly until the
 * auth middleware swap lands. The UI sources the identifier from
 * AuthContext at the call site so the hooks stay stateless.
 */
export interface ApproveBody {
  approver_id: string;
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
  approver_id: string;
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
    mutationFn: (actorID: string) =>
      api.post<void>(`/api/v1/requests/${id}/cancel`, { actor_id: actorID }),
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

export function useRequestWraps(
  id: string | undefined,
  userId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: id ? [...requestsKey.one(id), 'wraps'] : requestsKey.all,
    queryFn: () =>
      api.get<WrapSummary[]>(
        `/api/v1/requests/${id}/wraps?user_id=${encodeURIComponent(userId)}`,
      ),
    enabled: enabled && !!id && !!userId,
    retry: false,
  });
}

/**
 * Single-shot wrap reveal — the platform's load-bearing security UX.
 *
 * HARD RULE: this MUST only be called from an explicit user click on
 * the Reveal button. NEVER call speculatively or in an effect — the
 * api consumes the wrap atomically on this call and a second call
 * returns 410.
 *
 * The response value is base64-encoded plaintext. The caller decodes,
 * displays once, and clears it from state when the modal closes.
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
  userId: string,
): Promise<RevealedWrap> {
  return api.get<RevealedWrap>(
    `/api/v1/requests/${requestId}/wraps/${wrapId}?user_id=${encodeURIComponent(userId)}`,
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
 */
export function useSubmitPatchRequest() {
  const qc = useQueryClient();
  return useMutation({
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
