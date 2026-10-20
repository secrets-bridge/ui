/**
 * Gateways (Release 1, Argo CD only; api#293 and api#294).
 *
 *   GET    /admin/gateways                                    gateway.list
 *   GET    /admin/gateways/:id                                gateway.list
 *   GET    /admin/gateways/:id/tasks?state=&limit=            gateway.list
 *   POST   /admin/gateways                                    gateway.mint, fresh MFA
 *   POST   /admin/gateways/:id/enrollment-token               gateway.mint, fresh MFA
 *   POST   /admin/gateway-enrollment-tokens/:id/revoke        gateway.mint, fresh MFA
 *   POST   /admin/gateways/:id/revoke {reason?}               gateway.revoke, fresh MFA
 *   PUT    /admin/gateways/:id/enabled {enabled}              gateway.revoke, fresh MFA
 *   POST   /admin/gateways/:id/connectors/:cid/approve        gateway.bind, fresh MFA
 *   POST   /admin/gateway-bindings                            gateway.bind, fresh MFA
 *   DELETE /admin/gateway-bindings/:id                        gateway.bind, fresh MFA
 *   GET    /admin/environments/:id/observation-source         gateway.bind
 *   PUT    /admin/environments/:id/observation-source         gateway.bind, fresh MFA
 *   GET    /requests/:id/observations                         same read check as the request
 *
 * A write that needs a fresh second factor comes back 401 step-up and
 * client.ts runs the step-up dialog, then retries once.
 *
 * Nothing here is a credential except the enrollment token, which is in
 * the mint response only. That mutation is a sensitive one: the caller
 * copies the token into component state and calls reset().
 */

import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { useSensitiveMutation } from './sensitiveMutation';

export type GatewayStatus = 'pending' | 'active' | 'stale' | 'disabled' | 'revoked';

export interface Gateway {
  id: string;
  name: string;
  boundary: string;
  environment_id?: string;
  status: GatewayStatus;
  gateway_version?: string;
  contract_versions: string[] | null;
  max_replicas: number;
  max_inflight_tasks: number;
  catalog_version?: string;
  catalog_updated_at?: string;
  last_seen_at?: string;
  /** The last heartbeat's status: ok, degraded, not_ready, over_privileged, shutting_down. */
  last_status?: string;
  enrolled_at?: string;
  revoked_at?: string;
  replicas_seen: number;
  created_by: string;
  created_at: string;
}

export interface GatewayConnectorHealth {
  connector_id: string;
  kind: string;
  status: string;
}

export interface GatewayReplica {
  replica_id: string;
  gateway_version?: string;
  status: string;
  in_flight: number;
  catalog_version?: string;
  connectors: GatewayConnectorHealth[] | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface GatewayTarget {
  target_id: string;
  namespace?: string;
  name?: string;
  refresh_interval_seconds?: number;
  progress_deadline_seconds?: number;
  stale: boolean;
}

export type GatewayConnectorStatus = 'advertised' | 'approved' | 'disabled' | 'missing';

export interface GatewayConnector {
  /** The row id, used in the approve path and the binding body. */
  id: string;
  /** The connector's name as the Gateway advertises it. */
  connector_id: string;
  kind: string;
  status: GatewayConnectorStatus;
  targets: GatewayTarget[] | null;
  approved_by?: string;
  approved_at?: string;
  last_advertised_at?: string;
}

export interface GatewayBinding {
  id: string;
  gateway_id: string;
  project_id: string;
  environment_id: string;
  secret_id?: string;
  provider_connection_id?: string;
  secret_ref?: string;
  expected_stages: string[] | null;
  argocd_connector_id?: string;
  argocd_target_id?: string;
  observation_timeout_seconds: number;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

export interface GatewayEnrollmentTokenMeta {
  id: string;
  expected_cluster_name?: string;
  expires_at: string;
  consumed_at?: string;
  revoked_at?: string;
  created_by: string;
  created_at: string;
}

export interface GatewayDetail {
  gateway: Gateway;
  replicas: GatewayReplica[] | null;
  connectors: GatewayConnector[] | null;
  bindings: GatewayBinding[] | null;
  enrollment_tokens: GatewayEnrollmentTokenMeta[] | null;
}

export type ObservationTaskState = 'queued' | 'leased' | 'done' | 'dead' | 'cancelled';
export type ObservationVerdict = 'pending' | 'verified' | 'partially_observed' | 'unverified' | 'timed_out';

export interface ObservationTask {
  id: string;
  request_id: string;
  gateway_id: string;
  gateway_name?: string;
  binding_id: string;
  environment_id: string;
  correlation_id: string;
  connector_refs: { connector_id: string; target_id: string; stage: string }[] | null;
  expected_stages: string[] | null;
  state: ObservationTaskState;
  verdict: ObservationVerdict;
  verdict_reason?: string;
  version_source: string;
  attempt_count: number;
  failure_count: number;
  leased_replica_id?: string;
  lease_expires_at?: string;
  not_before: string;
  deadline_at: string;
  executed_at: string;
  last_result_at?: string;
  created_at: string;
  terminal_at?: string;
}

export interface GatewayTasks {
  items: ObservationTask[] | null;
  /** Per state, counted over the returned items only (the limit applies). */
  counts: Partial<Record<ObservationTaskState, number>> | null;
}

export type ObservationSource = 'control_plane' | 'gateway' | 'none';

export const gatewaysKey = {
  all: ['gateways'] as const,
  list: ['gateways', 'list'] as const,
  one: (id: string) => ['gateways', 'one', id] as const,
  tasks: (id: string) => ['gateways', 'tasks', id] as const,
  source: (envId: string) => ['gateways', 'observation-source', envId] as const,
  observations: (requestId: string) => ['requests', requestId, 'observations'] as const,
};

const gw = (id: string) => `/api/v1/admin/gateways/${encodeURIComponent(id)}`;

export function useGateways(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: gatewaysKey.list,
    queryFn: async () => (await api.get<{ items: Gateway[] | null }>('/api/v1/admin/gateways')).items ?? [],
    enabled: opts.enabled ?? true,
    // Heartbeats move "last heartbeat" every 30 s; keep the table fresh
    // while it is on screen, no faster.
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useGateway(id: string | undefined) {
  return useQuery({
    queryKey: id ? gatewaysKey.one(id) : gatewaysKey.all,
    queryFn: () => api.get<GatewayDetail>(gw(id!)),
    enabled: !!id,
    refetchOnWindowFocus: true,
  });
}

/** Each listed Gateway's detail, for the connector column. Gateways are few. */
export function useGatewayDetails(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: gatewaysKey.one(id),
      queryFn: () => api.get<GatewayDetail>(gw(id)),
      staleTime: 30_000,
    })),
  });
}

export function useGatewayTasks(id: string | undefined, limit = 25) {
  return useQuery({
    queryKey: id ? [...gatewaysKey.tasks(id), limit] : gatewaysKey.all,
    queryFn: () => api.get<GatewayTasks>(`${gw(id!)}/tasks?limit=${limit}`),
    enabled: !!id,
    refetchOnWindowFocus: true,
  });
}

export interface CreateGatewayInput {
  name: string;
  boundary: string;
  environment_id?: string;
  max_replicas?: number;
  max_inflight_tasks?: number;
}

export function useCreateGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGatewayInput) => api.post<Gateway>('/api/v1/admin/gateways', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: gatewaysKey.all }),
  });
}

export interface GatewayEnrollmentToken {
  id: string;
  gateway_id: string;
  enrollment_token: string;
  expires_at: string;
}

/**
 * Mints a one-time enrollment token. The response carries the token, so
 * this is a sensitive mutation: copy it into component state, then
 * reset(). The metadata list is refreshed on success.
 */
export function useMintGatewayToken() {
  const qc = useQueryClient();
  return useSensitiveMutation({
    mutationFn: ({ gatewayId, ...body }: { gatewayId: string; expires_in_seconds?: number; expected_cluster_name?: string }) =>
      api.post<GatewayEnrollmentToken>(`${gw(gatewayId)}/enrollment-token`, body),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: gatewaysKey.one(v.gatewayId) }),
  });
}

export function useRevokeGatewayToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tokenId }: { tokenId: string; gatewayId: string }) =>
      api.post<void>(`/api/v1/admin/gateway-enrollment-tokens/${encodeURIComponent(tokenId)}/revoke`),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: gatewaysKey.one(v.gatewayId) }),
  });
}

export function useRevokeGateway() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<Gateway>(`${gw(id)}/revoke`, reason ? { reason } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: gatewaysKey.all }),
  });
}

export function useSetGatewayEnabled() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => api.put<Gateway>(`${gw(id)}/enabled`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: gatewaysKey.all }),
  });
}

export function useApproveConnector() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ gatewayId, connectorId }: { gatewayId: string; connectorId: string }) =>
      api.post<GatewayConnector>(`${gw(gatewayId)}/connectors/${encodeURIComponent(connectorId)}/approve`),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: gatewaysKey.one(v.gatewayId) }),
  });
}

/**
 * POST /admin/gateway-bindings. The secret scope is either a catalog
 * secret bound to the project (secret_id) or a provider connection plus
 * a secret path (provider_connection_id and secret_ref), never both.
 */
export interface CreateBindingInput {
  gateway_id: string;
  project_id?: string;
  environment_id: string;
  secret_id?: string;
  provider_connection_id?: string;
  secret_ref?: string;
  argocd_connector_id: string;
  argocd_target_id: string;
  observation_timeout_seconds?: number;
}

export function useCreateBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBindingInput) => api.post<GatewayBinding>('/api/v1/admin/gateway-bindings', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: gatewaysKey.all }),
  });
}

export function useDeleteBinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => api.delete<void>(`/api/v1/admin/gateway-bindings/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: gatewaysKey.all }),
  });
}

export function useObservationSource(envId: string, enabled = true) {
  return useQuery({
    queryKey: gatewaysKey.source(envId),
    queryFn: async () =>
      (await api.get<{ environment_id: string; observation_source: ObservationSource }>(
        `/api/v1/admin/environments/${encodeURIComponent(envId)}/observation-source`,
      )).observation_source,
    enabled,
    retry: false,
  });
}

export interface SetObservationSourceResult {
  environment_id: string;
  observation_source: ObservationSource;
  previous_observation_source: ObservationSource;
  tasks_cancelled: number;
}

export function useSetObservationSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ envId, source }: { envId: string; source: ObservationSource }) =>
      api.put<SetObservationSourceResult>(`/api/v1/admin/environments/${encodeURIComponent(envId)}/observation-source`, {
        observation_source: source,
      }),
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: gatewaysKey.source(v.envId) });
      void qc.invalidateQueries({ queryKey: gatewaysKey.all });
    },
  });
}

// --- the request page -------------------------------------------------------

export type ObservationRollup = ObservationVerdict | 'none';

export interface EvidenceStage {
  stage: string;
  /** The control plane's outcome after its checks. */
  outcome: string;
  /** What the Gateway reported, before those checks. */
  reported_outcome: string;
  observed_at: string;
  received_at: string;
  gateway_id: string;
  replica_id: string;
  attempt_id: string;
  connector_id: string;
  target_id: string;
  confidence: string;
  linkage: string;
  caveats: string[] | null;
  facts: Record<string, unknown> | null;
  label: string;
}

export interface RequestObservationTask {
  task_id: string;
  gateway_id: string;
  gateway_name: string;
  state: ObservationTaskState;
  verdict: ObservationVerdict;
  verdict_reason?: string;
  expected_stages: string[] | null;
  version_source: string;
  attempt_count: number;
  deadline_at: string;
  created_at: string;
  terminal_at?: string;
  stages: EvidenceStage[] | null;
}

export interface RequestObservations {
  observation_source: ObservationSource | '' | null;
  rollup: ObservationRollup;
  label: string;
  tasks: RequestObservationTask[] | null;
}

/**
 * The request's Gateway evidence. Refetched when the window regains
 * focus, and every 20 s only while the rollup is pending.
 */
export function useRequestObservations(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: id ? gatewaysKey.observations(id) : gatewaysKey.all,
    queryFn: () => api.get<RequestObservations>(`/api/v1/requests/${encodeURIComponent(id!)}/observations`),
    enabled: enabled && !!id,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (q) => (q.state.data?.rollup === 'pending' ? 20_000 : false),
    refetchIntervalInBackground: false,
  });
}
