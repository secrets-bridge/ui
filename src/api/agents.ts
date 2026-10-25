/**
 * Agent administration (enrollment v2, skills#116).
 *
 *   GET  /api/v1/admin/agents                                    agent.list
 *   POST /api/v1/admin/agents/:id/revoke  {reason?}              agent.revoke
 *   POST /api/v1/admin/agents/:id/key-rotation                   agent.mint + fresh second factor
 *   POST /api/v1/provider-connections/:id/agent-enrollment-token agent.mint
 *
 * The list is the value-free admin projection: the agent's identity, its
 * health and the fingerprint and version of its registered X25519 wire
 * key. It never carries the agent secret, its hash or a private key: the
 * operator's machine creates those (`secrets-bridge-agent enroll`), and
 * they never reach the browser or the control plane.
 *
 * The enrollment token and the rotation token come back exactly once, in
 * the response to their POST; the api keeps only a hash. The SPA holds
 * either in component state until it is copied, and drops it on copy,
 * close and unmount.
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
  /** `sha256:` + hex SHA-256 of the 32 raw public key bytes. Not a secret. */
  public_key_fingerprint?: string;
  /** Starts at 1 on enrollment, +1 on each key rotation. */
  public_key_version?: number;
  /** Always `x25519` today. A wire-encryption key, not a TLS certificate. */
  public_key_algorithm?: string;
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

export interface KeyRotationToken {
  rotation_token: string;
  expires_at: string;
}

/**
 * Creates a one-time rotation token for an agent's wire key (TTL 15
 * minutes, hashed on the api). The api asks for a fresh second factor;
 * `client.ts` opens the step-up modal and retries. The response carries
 * the token, so this is a sensitive mutation: call `reset()` once the
 * result is in component state.
 */
export function useCreateKeyRotation() {
  const qc = useQueryClient();
  return useSensitiveMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.post<KeyRotationToken>(`/api/v1/admin/agents/${encodeURIComponent(id)}/key-rotation`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentsKey.all }),
  });
}
