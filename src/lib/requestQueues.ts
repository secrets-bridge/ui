/**
 * Which requests belong to which queue, shared by the nav count and the
 * pages so a count never disagrees with the list it points to.
 *
 * These read only what GET /requests returns today: status, requester
 * and the votes already cast. The api does not report approval lanes
 * yet, so "needs my decision" means: pending, someone else's, and I
 * haven't voted on it. The api still decides who may approve.
 */

import type { AccessRequest } from '../api/types';

/** Pending requests from other people that I haven't voted on. */
export function needsMyDecision(rows: AccessRequest[], me: string): AccessRequest[] {
  return rows.filter(
    (r) =>
      r.status === 'pending' &&
      r.requester_id !== me &&
      !(r.approvals ?? []).some((a) => a.approver_id === me),
  );
}

/** Requests I have voted on, newest decision first. */
export function decidedByMe(rows: AccessRequest[], me: string): AccessRequest[] {
  const myVote = (r: AccessRequest) => (r.approvals ?? []).find((a) => a.approver_id === me);
  return rows
    .filter((r) => myVote(r) !== undefined)
    .sort((a, b) => Date.parse(myVote(b)!.created_at) - Date.parse(myVote(a)!.created_at));
}

export const OPEN_STATUSES: AccessRequest['status'][] = [
  'pending',
  'pending_values',
  'pending_verification',
  'approved',
];

export function isOpen(r: AccessRequest): boolean {
  return OPEN_STATUSES.includes(r.status);
}
