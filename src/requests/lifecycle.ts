/**
 * Where a request stands on its path, as steps for the lifecycle
 * stepper on the request page. Built only from what the page already
 * has: the request, its votes, the workflow, the reveal condition and
 * the timeline. Times are ISO strings; the component formats them.
 *
 * Read:        Requested → Approved → Agent read it → Revealed
 * Change:      Requested → Approved → Agent wrote it
 * Cross-team:  Requested → Values supplied → Verified → Agent wrote it
 *
 * A request that stops early (rejected, refused, failed, expired,
 * cancelled) marks the step where it stopped with the exact word, and
 * the steps after it stay upcoming.
 */

import type { AccessRequest } from '../api/types';
import type { RevealCondition } from './revealState';
import type { TimelineEntry } from './timeline';

export type StepState = 'done' | 'current' | 'ready' | 'stopped' | 'closed' | 'upcoming';

export interface LifecycleStep {
  key: string;
  label: string;
  /** A short line under the label: who it waits on, counts, a deadline. */
  detail?: string;
  /** When the step happened (ISO), when known. */
  time?: string;
  state: StepState;
}

interface Inputs {
  minApprovers?: number;
  reveal?: RevealCondition;
  timeline: TimelineEntry[];
  isMine: boolean;
}

const lastTime = (entries: TimelineEntry[], kinds: TimelineEntry['kind'][]) =>
  [...entries].reverse().find((e) => kinds.includes(e.kind))?.time;

export function lifecycleSteps(r: AccessRequest, { minApprovers, reveal, timeline, isMine }: Inputs): LifecycleStep[] {
  const requested: LifecycleStep = { key: 'requested', label: 'Requested', time: r.created_at, state: 'done' };
  const approvals = r.approvals ?? [];
  const approves = approvals.filter((a) => a.decision === 'approve');
  const lastApproveAt = approves.length ? approves[approves.length - 1].created_at : undefined;
  const closedAt = r.updated_at ?? r.created_at;

  if (r.type === 'cross_team') {
    const team = r.target_team_name ?? 'the supplying team';
    const filled = !!r.filled_at || ['pending_verification', 'approved', 'executed', 'failed'].includes(r.status);
    const supplied: LifecycleStep = { key: 'supplied', label: 'Values supplied', state: 'upcoming' };
    const verified: LifecycleStep = { key: 'verified', label: 'Verified', state: 'upcoming' };
    const wrote: LifecycleStep = { key: 'agent', label: 'Agent wrote it', state: 'upcoming' };

    if (r.status === 'pending_values') Object.assign(supplied, { state: 'current', detail: `Waiting for ${team}` });
    else if (r.status === 'refused') Object.assign(supplied, { state: 'stopped', label: 'Refused', detail: `By ${team}`, time: r.refused_at ?? closedAt });
    else if (!filled && (r.status === 'expired' || r.status === 'cancelled'))
      Object.assign(supplied, { state: 'closed', label: r.status === 'expired' ? 'Expired' : 'Cancelled', time: closedAt });
    else Object.assign(supplied, { state: 'done', time: r.filled_at, detail: r.filled_by_display ? `By ${r.filled_by_display}` : undefined });

    if (supplied.state === 'done') {
      if (r.status === 'pending_verification')
        Object.assign(verified, {
          state: 'current',
          detail: r.snap_requires_security_approval ? 'Source, then security approval' : 'Waiting for an approver',
        });
      else if (r.status === 'rejected') Object.assign(verified, { state: 'stopped', label: 'Rejected', time: closedAt });
      else if (r.status === 'expired' || r.status === 'cancelled')
        Object.assign(verified, { state: 'closed', label: r.status === 'expired' ? 'Expired' : 'Cancelled', time: closedAt });
      else Object.assign(verified, { state: 'done', time: lastApproveAt });
    }

    if (verified.state === 'done') {
      if (r.status === 'approved') Object.assign(wrote, { state: 'current', detail: 'Waiting for the agent' });
      else if (r.status === 'failed') Object.assign(wrote, { state: 'stopped', label: 'Failed', time: closedAt });
      else if (r.status === 'executed') Object.assign(wrote, { state: 'done', time: lastTime(timeline, ['execution']) ?? closedAt });
    }
    return [requested, supplied, verified, wrote];
  }

  const counts = minApprovers ? `${Math.min(approves.length, minApprovers)} of ${minApprovers}` : undefined;
  const approved: LifecycleStep = { key: 'approved', label: 'Approved', state: 'upcoming' };
  const agent: LifecycleStep = { key: 'agent', label: r.type === 'patch' ? 'Agent wrote it' : 'Agent read it', state: 'upcoming' };

  if (r.status === 'pending') Object.assign(approved, { state: 'current', detail: counts ? `Waiting for approval · ${counts}` : 'Waiting for approval' });
  else if (r.status === 'rejected') Object.assign(approved, { state: 'stopped', label: 'Rejected', time: closedAt });
  else if (r.status === 'expired') Object.assign(approved, { state: 'closed', label: 'Expired', detail: 'No decision in time', time: closedAt });
  else if (r.status === 'cancelled') Object.assign(approved, { state: 'closed', label: 'Cancelled', time: closedAt });
  else
    Object.assign(approved, {
      state: 'done',
      time: lastApproveAt ?? lastTime(timeline, ['approval']),
      detail: minApprovers === 0 ? 'By policy' : counts,
    });

  if (approved.state === 'done') {
    if (r.status === 'approved') Object.assign(agent, { state: 'current', detail: 'Waiting for the agent' });
    else if (r.status === 'failed') Object.assign(agent, { state: 'stopped', label: 'Failed', time: lastTime(timeline, ['exec-fail']) ?? closedAt });
    else if (r.status === 'executed') Object.assign(agent, { state: 'done', time: lastTime(timeline, ['execution']) ?? closedAt });
  }

  if (r.type !== 'read') return [requested, approved, agent];

  const revealed: LifecycleStep = { key: 'revealed', label: 'Revealed', state: 'upcoming' };
  if (agent.state === 'done') {
    if (reveal?.state === 'ready') Object.assign(revealed, { state: 'ready', label: 'Ready to reveal', detail: 'until', time: reveal.deadline });
    else if (reveal?.state === 'consumed') Object.assign(revealed, { state: 'done', time: lastTime(timeline, ['reveal']) });
    else if (reveal?.state === 'expired') Object.assign(revealed, { state: 'closed', label: 'Reveal window closed' });
    else if (!isMine) Object.assign(revealed, { detail: 'Only the requester can reveal' });
  }
  return [requested, approved, agent, revealed];
}

/** "Step 2 of 4: waiting for approval" for screen readers. */
export function lifecycleSummary(steps: LifecycleStep[]): string {
  const i = steps.findIndex((s) => s.state !== 'done');
  if (i === -1) return `All ${steps.length} steps done.`;
  const s = steps[i];
  // A current step reads as what it waits on; a stopped one as its word.
  const what = s.state === 'current' && s.detail ? s.detail : s.label;
  return `Step ${i + 1} of ${steps.length}: ${what.charAt(0).toLowerCase()}${what.slice(1)}.`;
}
