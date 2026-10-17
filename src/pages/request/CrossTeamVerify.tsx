/**
 * Cross-team verification on the request page (status
 * pending_verification). Another team filled the values; the
 * requester's approvers now vote, first in the source lane and then,
 * when the frozen workflow asks for it, in the security lane.
 *
 * The card gives the full context so nobody approves blind (ui#87):
 * who asked, who filled, what goes where, key names and the
 * justification. Never a value, its length or a hash. Separation of
 * duties (API-N-01) comes from `crossTeamVerifyCapability`; it is
 * cosmetic, the api checks again. Each vote opens a dialog with an
 * optional comment, and the vote may ask for the second factor.
 */

import { useState, type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import { crossTeamErrorMessage, extractCrossTeamErrorCode, useVerifyCrossTeam } from '../../api/crossTeam';
import { useTeams } from '../../api/teams';
import type { AccessRequest } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { crossTeamVerifyCapability } from '../../auth/capabilities';
import { requestRef } from '../../lib/requestRef';
import { formatExact } from '../../lib/time';
import { keysOf } from '../../requests/crossTeam';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Textarea } from '../../ui/Field';
import { Keys } from '../../ui/Keys';
import { ToneStatus } from '../../ui/Status';
import { useToast } from '../../ui/toastContext';

type Lane = 'source' | 'security';
type Decision = 'approve' | 'reject';

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface">
      <h2 className="border-b border-rule px-5 py-3.5 text-block-heading text-ink">{title}</h2>
      {children}
    </section>
  );
}

export function CrossTeamVerifyCard({ request: r, actorId }: { request: AccessRequest; actorId: string }) {
  const { identity } = useAuth();
  const teams = useTeams();
  const [voting, setVoting] = useState<{ lane: Lane; decision: Decision } | null>(null);
  const teamName = r.target_team_name ?? teams.data?.find((t) => t.id === r.target_team_id)?.name;
  const { sourceVoted, showSourceLane, canSourceApprove, showSecurityLane, canSecurityApprove, sodReason } =
    crossTeamVerifyCapability(r, actorId, identity?.permissions);
  const why =
    sodReason === 'requester'
      ? 'you asked for it'
      : sodReason === 'filler'
        ? 'you provided the values'
        : sodReason === 'already_voted'
          ? 'you already voted, and a different approver casts the next vote'
          : null;

  const rows: [string, ReactNode][] = [
    ['Requester', r.requester_display ?? 'Someone'],
    ['Asked of', [teamName, r.target_project_name, r.target_environment_name].filter(Boolean).join(' · ') || '—'],
    [
      'Destination',
      <span key="d">
        {r.destination_provider_label ?? r.target_provider_type ?? '—'}
        {r.destination_secret_ref && <span className="block break-all font-mono text-mono">{r.destination_secret_ref}</span>}
      </span>,
    ],
    ['Keys', <Keys key="k" keys={keysOf(r)} variant="chips" />],
    ['Filled by', `${r.filled_by_display ?? (r.filled_by_user_id ? 'Someone on that team' : 'Not filled yet')}${r.filled_at ? ` · ${formatExact(r.filled_at)}` : ''}`],
  ];
  if (r.fill_comment) rows.push(['Their comment', <span key="c" className="whitespace-pre-wrap">{r.fill_comment}</span>]);
  rows.push(['Needs', r.snap_requires_security_approval ? 'Source approval, then security approval' : 'Source approval']);

  return (
    <Panel title="Verify the filled values">
      <dl className="m-0 px-5 py-1">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-rule px-5 py-2.5 text-caption text-muted">Key names only. Filled values are never shown here.</p>

      {(showSourceLane || showSecurityLane) && (
        <div className="flex flex-col gap-3 border-t border-rule px-5 py-4">
          {showSourceLane && (
            <LaneRow
              label="Source approval"
              note={sourceVoted ? 'A source vote is recorded.' : undefined}
              canApprove={canSourceApprove}
              onVote={(decision) => setVoting({ lane: 'source', decision })}
            />
          )}
          {showSecurityLane && (
            <LaneRow
              label="Security approval"
              note={sourceVoted ? undefined : 'Opens after the source vote.'}
              canApprove={canSecurityApprove}
              onVote={(decision) => setVoting({ lane: 'security', decision })}
            />
          )}
        </div>
      )}
      {!showSourceLane && !showSecurityLane && why && (
        <p className="border-t border-rule px-5 py-3 text-ui font-normal text-muted">You can't vote on this request: {why}.</p>
      )}
      {voting && <VoteDialog r={r} lane={voting.lane} decision={voting.decision} onClose={() => setVoting(null)} />}
    </Panel>
  );
}

function LaneRow({ label, note, canApprove, onVote }: { label: string; note?: string; canApprove: boolean; onVote: (d: Decision) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2.5">
      <p className="text-ui font-normal">
        <span className="font-medium text-ink">{label}</span>
        {note && <span className="ml-2 text-muted">{note}</span>}
      </p>
      <span className="inline-flex gap-2">
        <Button variant="danger" size="sm" onClick={() => onVote('reject')}>
          Reject…
        </Button>
        <Button variant={canApprove ? 'primary' : 'secondary'} size="sm" disabled={!canApprove} onClick={() => onVote('approve')}>
          Approve…
        </Button>
      </span>
    </div>
  );
}

function VoteDialog({ r, lane, decision, onClose }: { r: AccessRequest; lane: Lane; decision: Decision; onClose: () => void }) {
  const verify = useVerifyCrossTeam(r.id);
  const toast = useToast();
  const [comment, setComment] = useState('');
  const ref = requestRef(r.id);
  const asWho = lane === 'source' ? 'source approver' : 'security approver';
  const after =
    decision === 'reject'
      ? 'The request closes as rejected and the agent writes nothing.'
      : lane === 'source' && r.snap_requires_security_approval
        ? 'Security approval is still needed after this.'
        : 'This is the last approval. The agent then writes the values to the destination.';

  const confirm = async () => {
    try {
      const resp = await verify.mutateAsync({ decision, voted_as: lane, comment: comment.trim() || undefined });
      toast(
        decision === 'reject'
          ? `Rejected ${ref}.`
          : resp.voted_as === 'source' && resp.security_approval_required && !resp.security_vote_present
            ? `Approved ${ref} as source. Security approval is next.`
            : `Approved ${ref}.`,
      );
      onClose();
    } catch {
      // Shown below.
    }
  };

  return (
    <Dialog
      title={`${decision === 'approve' ? 'Approve' : 'Reject'} ${ref} as ${asWho}?`}
      onClose={onClose}
      dismissible={!verify.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={verify.isPending}>
            Cancel
          </Button>
          <Button
            variant={decision === 'approve' ? 'primary' : 'danger'}
            onClick={() => void confirm()}
            disabled={verify.isPending}
            aria-busy={verify.isPending}
          >
            {verify.isPending ? 'Recording…' : decision === 'approve' ? 'Approve' : 'Reject'}
          </Button>
        </>
      }
    >
      <p className="text-muted">{after}</p>
      <Field id="vote-comment" label="Comment (optional)" hint="The requester sees it, and it goes in the audit log.">
        {(p) => <Textarea {...p} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} data-autofocus />}
      </Field>
      {verify.isError && (
        <Banner tone="error" title="Vote not recorded.">
          {verify.error instanceof ApiError
            ? `${verify.error.status}: ${crossTeamErrorMessage(extractCrossTeamErrorCode(verify.error.body)) ?? verify.error.message}`
            : 'Network error.'}
        </Banner>
      )}
    </Dialog>
  );
}

export function CrossTeamApprovalChainCard({ request: r }: { request: AccessRequest }) {
  // One approve vote counts as the source approval (min_approvers is 0
  // or 1 for cross-team). The security vote shows as done once the
  // request moves on to approved or executed.
  const sourceVoted = (r.approvals ?? []).some((a) => a.decision === 'approve');
  const securityRequired = !!r.snap_requires_security_approval;
  const securityVoted = r.status === 'approved' || r.status === 'executed';

  return (
    <Panel title="Approvals">
      <div className="flex flex-col gap-2 px-5 py-4 text-ui font-normal">
        <ChainRow label="Source approval" done={sourceVoted} />
        {securityRequired ? (
          <ChainRow label="Security approval" done={securityVoted} />
        ) : (
          <p className="text-caption text-muted">The workflow doesn't require a security approval.</p>
        )}
      </div>
    </Panel>
  );
}

function ChainRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink">{label}</span>
      <ToneStatus tone={done ? 'ok' : 'warn'}>{done ? 'Done' : 'Waiting'}</ToneStatus>
    </div>
  );
}
