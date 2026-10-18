/**
 * Reveal condition of an executed read request, kept separate from its
 * status: `executed` alone never means a reveal is available.
 *
 * The api doesn't report the condition on the request yet, so it is
 * read from the requester's own wrap summaries (GET /requests/:id/wraps:
 * key name, consumed flag and expiry; never a value). Only executed
 * reads the signed-in user requested in the last few days are checked,
 * so this costs a handful of small calls. The worker purges expired,
 * unopened wraps, so an executed read with no wraps left had a reveal
 * window that closed unused.
 *
 * Drop this once the api reports the condition on the request itself.
 */

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '../api/client';
import { requestsKey, type WrapSummary } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { withinDays } from '../lib/time';

export type RevealCondition =
  | { state: 'ready'; deadline: string }
  | { state: 'consumed' }
  | { state: 'expired' }
  | { state: 'unknown' };

const LOOKBACK_DAYS = 3;
const MAX_CHECKED = 20;

export function revealConditionOf(wraps: WrapSummary[] | undefined, now = Date.now()): RevealCondition {
  if (!wraps) return { state: 'unknown' };
  const ready = wraps
    .filter((w) => !w.consumed && Date.parse(w.expires_at) > now)
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at));
  if (ready.length > 0) return { state: 'ready', deadline: ready[0].expires_at };
  if (wraps.some((w) => w.consumed)) return { state: 'consumed' };
  return { state: 'expired' };
}

function wantsCheck(r: AccessRequest, me: string): boolean {
  return (
    r.type === 'read' &&
    r.status === 'executed' &&
    r.requester_id === me &&
    withinDays(r.updated_at ?? r.created_at, LOOKBACK_DAYS)
  );
}

/** Reveal condition per request id, for the signed-in requester's recent executed reads. */
export function useRevealConditions(rows: AccessRequest[], me: string): Map<string, RevealCondition> {
  const targets = useMemo(
    () => rows.filter((r) => wantsCheck(r, me)).slice(0, MAX_CHECKED),
    [rows, me],
  );
  // `combine` returns a structurally shared array, so it only changes
  // when one of the wrap lists does.
  const wrapLists = useQueries({
    queries: targets.map((r) => ({
      queryKey: [...requestsKey.one(r.id), 'wraps'],
      queryFn: () => api.get<WrapSummary[]>(`/api/v1/requests/${r.id}/wraps`),
      retry: false,
      staleTime: 30_000,
    })),
    combine: (results) => results.map((q) => q.data),
  });
  return useMemo(() => {
    const m = new Map<string, RevealCondition>();
    targets.forEach((r, i) => m.set(r.id, revealConditionOf(wrapLists[i])));
    return m;
  }, [targets, wrapLists]);
}
