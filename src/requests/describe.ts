/**
 * Plain-language facts about a request, from what the api returns
 * today. Nothing here invents a person: the api doesn't report
 * approval lanes yet, so "waiting on" for a pending request says
 * "Approval" rather than guessing a name.
 */

import type { AccessRequest } from '../api/types';
import type { RevealCondition } from './revealState';
import { formatShort } from '../lib/time';

export function keysOf(r: AccessRequest): string[] {
  if (r.type === 'cross_team') return r.destination_keys ?? r.target_keys ?? [];
  return r.target_keys ?? [];
}

export function pathOf(r: AccessRequest): string {
  return (r.type === 'cross_team' ? r.destination_secret_ref : r.target_secret_ref) ?? '';
}

/** Who or what an open request is waiting on. */
export function waitingOn(r: AccessRequest): string {
  switch (r.status) {
    case 'pending':
      return 'Approval';
    case 'pending_values':
      return r.target_team_name ?? 'Supplying team';
    case 'pending_verification':
      return 'Verification';
    case 'approved':
      return 'Agent execution';
    default:
      return '';
  }
}

/** One-line outcome of a closed request. */
export function closedDetail(r: AccessRequest, reveal?: RevealCondition): string {
  switch (r.status) {
    case 'executed':
      if (r.type !== 'read') return 'Written by the agent';
      if (reveal?.state === 'ready') return `Reveal ready until ${formatShort(reveal.deadline)} UTC`;
      if (reveal?.state === 'consumed') return 'Reveal consumed';
      if (reveal?.state === 'expired') return 'Reveal expired unused';
      return 'Executed by the agent';
    case 'rejected':
      return r.reject_reason ? `Rejected: ${r.reject_reason}` : 'Rejected';
    case 'refused':
      return r.target_team_name ? `Refused by ${r.target_team_name}` : 'Refused by the supplying team';
    case 'failed':
      return 'The agent reported a failure';
    case 'expired':
      return 'No decision in time';
    case 'cancelled':
      return 'Cancelled';
    default:
      return '';
  }
}

/** "Read DB_USERNAME, DB_PASSWORD" style operation title. */
export function operationTitle(r: AccessRequest): string {
  const keys = keysOf(r);
  const op = r.type === 'patch' ? 'Change' : r.type === 'cross_team' ? 'Supply' : 'Read';
  return keys.length > 0 ? `${op} ${keys.join(', ')}` : `${op} all keys`;
}
