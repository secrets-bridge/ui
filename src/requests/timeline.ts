/**
 * Everything that happened to one request, oldest first, metadata only.
 *
 * Request lifecycle audit rows carry the request id as correlation id,
 * so for viewers who can read the audit log the timeline is the real
 * trail with names (submitted, approved by, agent claimed, executed,
 * revealed). Only fixed fields are used: time, actor name and action,
 * plus a few safe metadata fields (vote counts, job status, target
 * state). Wrap metadata such as byte length or content hash is never
 * read. For everyone else the timeline is built from the request
 * itself, until the api has a per-request events endpoint (api#230).
 */

import type { AuditEvent } from '../api/audit';
import type { AccessRequest } from '../api/types';

export type TimelineKind = 'request' | 'approval' | 'reject' | 'execution' | 'exec-fail' | 'reveal' | 'system';

export interface TimelineEntry {
  key: string;
  kind: TimelineKind;
  actor: string;
  action: string;
  note?: string;
  time: string;
}

const AGENT_PREFIX = /^Agent /;

function actorName(e: AuditEvent, me: string): string {
  if (e.actor === `user:${me}`) return 'You';
  if (e.actor.startsWith('agent:')) return `agent ${e.actor_display.replace(AGENT_PREFIX, '')}`;
  if (e.actor.startsWith('system:')) return 'The control plane';
  return e.actor_display || 'Someone';
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** Timeline from the audit rows of one request. */
export function timelineFromAudit(events: AuditEvent[], r: AccessRequest, me: string): TimelineEntry[] {
  const sorted = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const out: TimelineEntry[] = [];
  const op = r.type === 'patch' ? 'change' : 'read';
  for (const e of sorted) {
    const who = actorName(e, me);
    const md = e.metadata ?? {};
    const base = { key: e.id, actor: who, time: e.occurred_at };
    switch (e.action) {
      case 'request.submit':
        out.push({ ...base, kind: 'request', action: `created a ${op} request` });
        break;
      case 'request.cross_team.submit':
        out.push({ ...base, kind: 'request', action: 'asked another team to supply values' });
        break;
      case 'secret.reveal.direct.issued':
        out.push({ ...base, kind: 'request', action: 'started a direct reveal (no approval needed outside production)' });
        break;
      case 'request.approve': {
        const n = num(md.approves);
        const of = num(md.required);
        out.push({ ...base, kind: 'approval', action: n && of ? `approved (${n} of ${of})` : 'approved' });
        break;
      }
      case 'request.cross_team.verify.approve':
        out.push({ ...base, kind: 'approval', action: `approved${str(md.voted_as) ? ` (${md.voted_as} approval)` : ''}` });
        break;
      case 'request.reject':
      case 'request.cross_team.verify.reject':
        out.push({ ...base, kind: 'reject', action: 'rejected the request', note: r.reject_reason });
        break;
      case 'request.cancel':
        out.push({ ...base, kind: 'system', action: 'cancelled the request' });
        break;
      case 'request.expire':
        out.push({ ...base, kind: 'system', actor: 'The request', action: 'expired without a decision' });
        break;
      case 'request.cross_team.fill':
        out.push({ ...base, kind: 'approval', action: 'supplied the values' });
        break;
      case 'request.cross_team.refuse':
        out.push({ ...base, kind: 'reject', action: 'refused to supply values', note: r.refuse_reason });
        break;
      case 'job.enqueue':
        out.push({ ...base, kind: 'system', actor: 'The control plane', action: 'queued the job for an agent' });
        break;
      case 'job.claim':
        out.push({ ...base, kind: 'execution', action: 'picked up the job' });
        break;
      case 'job.complete': {
        const ok = str(md.job_status) === 'succeeded';
        out.push({
          ...base,
          kind: ok ? 'execution' : 'exec-fail',
          action: ok
            ? r.type === 'read'
              ? 'read the provider · success · values held as single-use encrypted wraps'
              : 'wrote the provider · success'
            : 'reported a failure',
        });
        break;
      }
      case 'request.transition': {
        const target = str(md.target);
        if (target) out.push({ ...base, kind: 'system', actor: 'The request', action: `moved to ${target}` });
        break;
      }
      case 'wrap.retrieve': {
        const refused = 'error_kind' in md;
        const prev = out[out.length - 1];
        if (!refused && prev && prev.kind === 'reveal' && prev.actor === who && Date.parse(e.occurred_at) - Date.parse(prev.time) < 120_000) {
          const n = Number(prev.action.match(/revealed (\d+)/)?.[1] ?? 1) + 1;
          prev.action = `revealed ${n} values · reveal consumed`;
          break;
        }
        out.push({
          ...base,
          kind: refused ? 'system' : 'reveal',
          action: refused ? 'tried to reveal a value that was already used or expired · nothing was shown' : 'revealed 1 value · reveal consumed',
        });
        break;
      }
      case 'wrap.retrieve.refused_session':
        out.push({ ...base, kind: 'system', action: 'tried to reveal a value outside its reveal session · refused' });
        break;
      case 'reveal.session.opened':
        out.push({ ...base, kind: 'reveal', action: 'opened a reveal session' });
        break;
      case 'reveal.session.expired':
        out.push({ ...base, kind: 'system', actor: 'The reveal session', action: 'closed' });
        break;
      case 'wrap.create':
        // One row per key; the job.complete row already says values were stored.
        break;
      default:
        if (e.action.includes('refused') || e.action.includes('rejected') || e.status !== 'success') {
          out.push({ ...base, kind: 'system', action: e.action.replace(/[._]/g, ' ') });
        }
    }
  }
  return out;
}

/** Timeline from the request alone, for viewers without the audit log. */
export function timelineFromRequest(r: AccessRequest, me: string): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const op = r.type === 'patch' ? 'change' : r.type === 'cross_team' ? 'cross-team' : 'read';
  out.push({
    key: 'created',
    kind: 'request',
    actor: r.requester_id === me ? 'You' : (r.requester_display ?? 'The requester'),
    action: `created a ${op} request`,
    time: r.created_at,
  });
  for (const a of [...(r.approvals ?? [])].sort((x, y) => Date.parse(x.created_at) - Date.parse(y.created_at))) {
    out.push({
      key: a.id,
      kind: a.decision === 'approve' ? 'approval' : 'reject',
      actor: a.approver_id === me ? 'You' : 'An approver',
      action: a.decision === 'approve' ? 'approved' : 'rejected the request',
      note: a.comment ?? (a.decision === 'reject' ? r.reject_reason : undefined),
      time: a.created_at,
    });
  }
  if (r.filled_at) {
    out.push({ key: 'filled', kind: 'approval', actor: r.filled_by_display ?? 'The supplying team', action: 'supplied the values', time: r.filled_at });
  }
  const end: Partial<Record<AccessRequest['status'], [TimelineKind, string]>> = {
    executed: ['execution', r.type === 'read' ? 'was executed by the agent · values held as single-use encrypted wraps' : 'was executed by the agent'],
    failed: ['exec-fail', 'failed at the agent'],
    cancelled: ['system', 'was cancelled'],
    expired: ['system', 'expired without a decision'],
    refused: ['reject', 'was refused by the supplying team'],
  };
  const last = end[r.status];
  if (last && r.updated_at) {
    out.push({ key: 'end', kind: last[0], actor: 'The request', action: last[1], time: r.updated_at, note: r.status === 'refused' ? r.refuse_reason : undefined });
  }
  return out;
}

/** Names of people who voted, from the audit rows, keyed by user id. */
export function voterNames(events: AuditEvent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of events) {
    if (!e.actor.startsWith('user:')) continue;
    if (e.action === 'request.approve' || e.action === 'request.reject' || e.action.startsWith('request.cross_team.verify.')) {
      m.set(e.actor.slice('user:'.length), e.actor_display);
    }
  }
  return m;
}
