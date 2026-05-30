/**
 * Agent admin API surface.
 *
 *   GET    /api/v1/agents             — list (admin projection, no secrets)
 *   POST   /api/v1/agents             — mint a new agent (returns secret ONCE)
 *   POST   /api/v1/agents/:id/revoke  — revoke; heartbeats stop being accepted
 *
 * The mint endpoint returns `{id, agent_secret}` exactly once. The
 * agent_secret hash is what's stored in Postgres; the plaintext is
 * returned in the response and NEVER recoverable thereafter. UI must
 * surface that hard limit clearly — see the reveal-once modal in
 * `src/pages/Agents.tsx`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { api } from './client';
import type { Agent } from './types';

export const agentsKey = {
  all: ['agents'] as const,
};

export function useAgents() {
  return useQuery({
    queryKey: agentsKey.all,
    queryFn: () => api.get<Agent[]>('/api/v1/agents'),
    // Poll every 10s so the live `online` / `pending` / `stale` badge
    // in the Agents table reflects fresh heartbeats. The api-side
    // status is owned by the worker's agents-stale sweeper (cutoff
    // 5min by default); the SPA's narrower `online` window (90s) is
    // computed from last_seen_at, which we want fresh.
    refetchInterval: 10_000,
    refetchOnWindowFocus: true,
  });
}

export interface MintAgentInput {
  name: string;
  scope?: Record<string, unknown>;
}

/**
 * MintAgentResponse — the load-bearing security shape. `agent_secret`
 * is the ONLY moment plaintext exists in the SPA. Render it in a
 * reveal-once panel; clear from React state when the panel closes.
 */
export interface MintAgentResponse {
  id: string;
  name: string;
  agent_secret: string;
}

export function useMintAgent() {
  // Don't invalidate on mint — let the caller decide WHEN to refetch
  // (after the operator copies the secret). The Agents page calls
  // invalidate() in its drawer's close handler.
  return useMutation({
    mutationFn: (body: MintAgentInput) =>
      api.post<MintAgentResponse>('/api/v1/agents', body),
  });
}

export function useRevokeAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<void>(`/api/v1/agents/${id}/revoke`),
    onSuccess: () => qc.invalidateQueries({ queryKey: agentsKey.all }),
  });
}
