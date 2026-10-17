/**
 * Agent administration (Agent Onboarding MVP, api#177).
 *
 *   GET  /api/v1/admin/agents                                    agent.list
 *   POST /api/v1/admin/agents/:id/revoke  {reason?}              agent.revoke
 *   POST /api/v1/provider-connections/:id/agent-enrollment-token agent.mint
 *
 * The list is the value-free admin projection: no secret hash, public
 * key or credential. The enrollment token comes back exactly once, in
 * the response to the POST; the api keeps only its hash. The SPA holds
 * it in component state while the enrollment drawer is open and drops
 * it on close. Direct mint (POST /agents) is a break-glass switch that
 * is off by default (api#183), so the console onboards only through
 * enrollment.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from './client';
import { useSensitiveMutation } from './sensitiveMutation';

export type AgentStatus = 'enrolled' | 'active' | 'stale' | 'revoked' | 'disabled' | 'error';

export interface AdminAgent {
  id: string;
  name: string;
  status: AgentStatus;
  provider_connection_id?: string;
  provider_connection_name?: string;
  provider_type?: string;
  cluster_name?: string;
  region?: string;
  agent_version?: string;
  capabilities: string[] | null;
  last_seen_at?: string;
  last_status?: string;
  revoked_at?: string;
  created_at: string;
}

export const agentsKey = {
  all: ['agents'] as const,
  admin: ['agents', 'admin'] as const,
};

export function useAdminAgents(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: agentsKey.admin,
    queryFn: async () => (await api.get<{ items: AdminAgent[] }>('/api/v1/admin/agents')).items ?? [],
    enabled: opts.enabled ?? true,
    // Heartbeats move "last seen" every 30 s or so; keep the table fresh
    // while it is on screen.
    refetchInterval: 15_000,
  });
}

export function useRevokeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post<void>(`/api/v1/admin/agents/${encodeURIComponent(id)}/revoke`, reason ? { reason } : {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentsKey.all }),
  });
}

export interface EnrollmentTokenInput {
  connectionId: string;
  expected_cluster_name?: string;
  expires_in_seconds?: number;
}

export interface EnrollmentToken {
  enrollment_token: string;
  expires_at: string;
  provider_connection_id: string;
}

/**
 * Creates a one-time enrollment token. The response carries the token,
 * so this is a sensitive mutation: call `reset()` once the result is in
 * component state, so the MutationCache doesn't keep a second copy.
 */
export function useCreateEnrollmentToken() {
  return useSensitiveMutation({
    mutationFn: ({ connectionId, ...body }: EnrollmentTokenInput) =>
      api.post<EnrollmentToken>(
        `/api/v1/provider-connections/${encodeURIComponent(connectionId)}/agent-enrollment-token`,
        body,
      ),
  });
}
