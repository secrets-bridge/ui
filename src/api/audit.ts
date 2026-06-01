/**
 * Audit log API surface.
 *
 *   GET /api/v1/audit-events?actor=&action=&resource=&correlation_id=&since=&until=&limit=
 *
 * The api gates this endpoint behind `audit.read`; the seed `admin`,
 * `approver`, and `developer` roles all carry it, so any signed-in
 * user with a grant can read.
 *
 * Hard-rule reminder: `metadata` is opaque jsonb. The api's service
 * layer is responsible for stripping any field that could leak a
 * secret value BEFORE the row is appended, so the UI can safely
 * render any field that comes back here.
 */

import { useQuery } from '@tanstack/react-query';

import { api } from './client';

export interface AuditEvent {
  id: string;
  // Raw actor string — `user:<uuid>` / `agent:<uuid>` / `system:<kind>`.
  // Forensic anchor, always present; UIs may render the friendlier
  // `actor_display` field instead and keep `actor` as a tooltip.
  actor: string;
  // Human-readable rendering resolved by the api at response time:
  // user email (or display name), agent name, or a fixed "System (…)"
  // label. Falls back to a short placeholder when the underlying record
  // is missing (deleted user / revoked agent). Never empty for a
  // non-empty `actor`.
  actor_display: string;
  action: string;
  resource: string;
  status: 'success' | 'failure' | 'denied';
  correlation_id: string;
  metadata?: Record<string, unknown>;
  occurred_at: string;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  resource?: string;
  correlation_id?: string;
  since?: string;
  until?: string;
  limit?: number;
}

export const auditKey = {
  all: ['audit-events'] as const,
  list: (filter: AuditFilter) => ['audit-events', 'list', filter] as const,
};

export function useAuditEvents(filter: AuditFilter = {}) {
  const qs = new URLSearchParams();
  if (filter.actor) qs.set('actor', filter.actor);
  if (filter.action) qs.set('action', filter.action);
  if (filter.resource) qs.set('resource', filter.resource);
  if (filter.correlation_id) qs.set('correlation_id', filter.correlation_id);
  if (filter.since) qs.set('since', filter.since);
  if (filter.until) qs.set('until', filter.until);
  if (filter.limit) qs.set('limit', String(filter.limit));
  const suffix = qs.toString() ? `?${qs}` : '';
  return useQuery({
    queryKey: auditKey.list(filter),
    queryFn: () => api.get<AuditEvent[]>(`/api/v1/audit-events${suffix}`),
  });
}
