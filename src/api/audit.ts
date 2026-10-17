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

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';

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

function auditQuery(filter: AuditFilter): string {
  const qs = new URLSearchParams();
  if (filter.actor) qs.set('actor', filter.actor);
  if (filter.action) qs.set('action', filter.action);
  if (filter.resource) qs.set('resource', filter.resource);
  if (filter.correlation_id) qs.set('correlation_id', filter.correlation_id);
  if (filter.since) qs.set('since', filter.since);
  if (filter.until) qs.set('until', filter.until);
  if (filter.limit) qs.set('limit', String(filter.limit));
  return qs.toString() ? `?${qs}` : '';
}

export function useAuditEvents(filter: AuditFilter = {}) {
  return useQuery({
    queryKey: auditKey.list(filter),
    queryFn: () => api.get<AuditEvent[]>(`/api/v1/audit-events${auditQuery(filter)}`),
  });
}

/**
 * The audit log one page at a time, newest first. The api has no
 * cursor, but `until` is exclusive and rows come back newest first, so
 * the next page asks for rows before the oldest one seen.
 *
 * Rows written in one transaction share a timestamp, so a page boundary
 * can fall inside such a group. The next page therefore starts one
 * millisecond after the oldest row and drops rows already shown. Pass
 * the same `filter` (without `until`) for the life of the list.
 */
export function useAuditPages(filter: Omit<AuditFilter, 'until' | 'limit'>, pageSize = 50) {
  return useInfiniteQuery({
    queryKey: ['audit-events', 'pages', filter, pageSize] as const,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.get<AuditEvent[]>(`/api/v1/audit-events${auditQuery({ ...filter, until: pageParam, limit: pageSize })}`),
    getNextPageParam: (last, pages) => {
      if (last.length < pageSize) return undefined;
      const seen = new Set(pages.slice(0, -1).flatMap((p) => p.map((e) => e.id)));
      // Only rows we already had: more rows than a page share one
      // millisecond. Step past them rather than loop.
      if (last.every((e) => seen.has(e.id))) return last[last.length - 1].occurred_at;
      const oldest = Date.parse(last[last.length - 1].occurred_at);
      return new Date(oldest + 1).toISOString();
    },
  });
}

/** Every row of the pages once, newest first. */
export function flattenAuditPages(pages: AuditEvent[][] | undefined): AuditEvent[] {
  const seen = new Set<string>();
  const out: AuditEvent[] = [];
  for (const page of pages ?? []) {
    for (const e of page) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      out.push(e);
    }
  }
  return out;
}
