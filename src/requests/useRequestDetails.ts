/**
 * Full records for a few requests, keyed by id.
 *
 * GET /requests list rows carry no display names and no votes; the
 * single-request endpoint has both. The approver queue needs the
 * requester's name and whether the signed-in approver has already
 * voted, so it loads the detail of its own rows (a handful). Shares the
 * cache with the request detail page.
 *
 * Drop this once list rows carry names and votes.
 */

import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';

import { api } from '../api/client';
import { requestsKey } from '../api/requests';
import type { AccessRequest } from '../api/types';

const MAX_DETAILS = 25;

export function useRequestDetails(ids: string[]): Map<string, AccessRequest> {
  const wanted = useMemo(() => ids.slice(0, MAX_DETAILS), [ids]);
  const details = useQueries({
    queries: wanted.map((id) => ({
      queryKey: requestsKey.one(id),
      queryFn: () => api.get<AccessRequest>(`/api/v1/requests/${id}`),
      staleTime: 30_000,
    })),
    combine: (results) => results.map((q) => q.data),
  });
  return useMemo(() => {
    const m = new Map<string, AccessRequest>();
    details.forEach((d) => {
      if (d) m.set(d.id, d);
    });
    return m;
  }, [details]);
}
