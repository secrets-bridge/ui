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

/** The reveal condition line shown under an executed or approved read. */
export function conditionLine(r: AccessRequest, reveal?: RevealCondition): { text: string; tone: 'ok' | 'muted' } | null {
  if (r.status === 'approved') return { text: 'No execution event yet', tone: 'muted' };
  if (r.status !== 'executed' || r.type !== 'read' || !reveal) return null;
  switch (reveal.state) {
    case 'ready':
      return { text: `Reveal ready until ${formatShort(reveal.deadline)} UTC`, tone: 'ok' };
    case 'consumed':
      return { text: 'Reveal consumed', tone: 'muted' };
    case 'expired':
      return { text: 'Reveal expired', tone: 'muted' };
    default:
      return null;
  }
}

export interface NextAction {
  text?: string;
  /** A call to action that opens the request. */
  cta?: string;
}

/** The single next step for the person looking at the list. */
export function nextAction(r: AccessRequest, me: string, reveal?: RevealCondition, decide?: boolean): NextAction {
  if (decide) return { cta: 'Review and decide' };
  const mine = r.requester_id === me;
  switch (r.status) {
    case 'pending':
      return { text: 'Waiting for approval' };
    case 'pending_values':
      return { text: `Waiting for ${r.target_team_name ?? 'the supplying team'} to supply values` };
    case 'pending_verification':
      return { text: 'Waiting for verification' };
    case 'approved':
      return { text: 'Waiting for the agent to execute' };
    case 'executed':
      if (mine && reveal?.state === 'ready') return { cta: 'Reveal' };
      if (reveal?.state === 'consumed') return { text: mine ? 'Nothing to do · you revealed the values' : 'Nothing to do · values were revealed' };
      if (reveal?.state === 'expired') return { text: 'Request again if you still need them' };
      return { text: 'Nothing to do' };
    case 'rejected':
      return { text: 'Open it to read the reason' };
    case 'refused':
      return { text: `Refused by ${r.target_team_name ?? 'the supplying team'}` };
    case 'failed':
      return mine ? { cta: 'Review failure' } : { text: 'Failed at the agent' };
    case 'expired':
      return { text: 'Expired without a decision' };
    case 'cancelled':
      return { text: mine ? 'Cancelled by you' : 'Cancelled by the requester' };
    default:
      return {};
  }
}
