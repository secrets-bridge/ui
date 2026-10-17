/**
 * Cross-team verification (pending_verification): the source and
 * security lanes, separation of duties and the vote. Unchanged from the
 * previous request page; its redesign belongs to the Inbox slice.
 */

import { useState } from 'react';

import { ApiError } from '../../api/client';
import { crossTeamErrorMessage, useVerifyCrossTeam } from '../../api/crossTeam';
import { useTeams } from '../../api/teams';
import type { AccessRequest } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { crossTeamVerifyCapability } from '../../auth/capabilities';
import { requestRef as shortId } from '../../lib/requestRef';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { StatusPill } from '../../ui/StatusPill';

// --- Slice N5 — cross-team verify + approval-chain cards ------------

export function CrossTeamVerifyCard({
  request: r,
  actorId,
}: {
  request: AccessRequest;
  actorId: string;
}) {
  const { identity } = useAuth();
  const verify = useVerifyCrossTeam(r.id);
  const teams = useTeams();
  const teamName = teams.data?.find((t) => t.id === r.target_team_id)?.name;
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Lane order + separation of duties (API-N-01). Cosmetic: the api
  // checks the lane permission against the request's source project.
  const {
    sourceVoted,
    showSourceLane,
    canSourceApprove,
    showSecurityLane,
    canSecurityApprove,
    sodReason: sod,
  } = crossTeamVerifyCapability(r, actorId, identity?.permissions);
  const sodReason =
    sod === 'requester'
      ? 'You are the requester.'
      : sod === 'filler'
        ? 'You provided the values for this request.'
        : sod === 'already_voted'
          ? 'You already voted on this request; a different approver casts the next vote.'
          : null;

  const run = async (
    decision: 'approve' | 'reject',
    votedAs: 'source' | 'security',
  ) => {
    setError(null);
    setToast(null);
    try {
      const resp = await verify.mutateAsync({
        decision,
        voted_as: votedAs,
        comment: comment.trim() || undefined,
      });
      setComment('');
      if (
        resp.voted_as === 'source' &&
        resp.security_approval_required &&
        !resp.security_vote_present
      ) {
        setToast(
          'Your source vote was recorded. Security approval is still pending.',
        );
      } else if (resp.vote_recorded) {
        setToast('Vote recorded.');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        const code = extractErrorCodeFromApiErr(err);
        setError(
          `${err.status} · ${crossTeamErrorMessage(code) ?? err.message}`,
        );
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  return (
    <Card>
      <div className="px-5 py-4 border-b border-border/60">
        <h3 className="text-ink font-semibold">Verify cross-team request</h3>
      </div>
      <div className="px-5 py-4 space-y-3 text-sm">
        {/* Full approver context so nobody approves blind (ui#87). All
            metadata — key NAMES, refs, ids, timestamps, the frozen
            approval requirement. Never a value, hash, or wrapped body. */}
        <div className="space-y-1 text-muted">
          <p>
            Requester:{' '}
            <span className="text-ink">
              {r.requester_display ?? r.requester_id}
            </span>
          </p>
          <p>
            Target team:{' '}
            <span className="text-ink">
              {r.target_team_name ?? teamName ?? r.target_team_id ?? '—'}
            </span>
          </p>
          <p>
            Target project · env:{' '}
            <span className="font-mono text-ink">
              {r.target_project_name ??
                (r.target_project_id ? shortId(r.target_project_id) : '—')}
              {' · '}
              {r.target_environment_name ??
                (r.target_environment_id ? shortId(r.target_environment_id) : '—')}
            </span>
          </p>
          <p>
            Destination:{' '}
            <span className="font-mono text-ink">
              {r.destination_provider_label ??
                (r.destination_provider_connection_id
                  ? `connection ${shortId(r.destination_provider_connection_id)}`
                  : r.target_provider_type || '—')}
              {r.destination_secret_ref ? ` · ${r.destination_secret_ref}` : ''}
            </span>
          </p>
          <p>
            Keys ({(r.destination_keys ?? r.target_keys ?? []).length}):{' '}
            <span className="font-mono text-ink">
              {(r.destination_keys ?? r.target_keys ?? []).join(', ') || '—'}
            </span>
          </p>
          <p>
            Filled by:{' '}
            <span className="text-ink">
              {r.filled_by_display ?? r.filled_by_user_id ?? '—'}
            </span>
            {r.filled_at && (
              <span className="text-muted text-xs"> · {r.filled_at}</span>
            )}
          </p>
          {r.fill_comment && (
            <p>
              Filler comment:{' '}
              <span className="text-ink">{r.fill_comment}</span>
            </p>
          )}
          {r.justification && (
            <p>
              Justification:{' '}
              <span className="text-ink">{r.justification}</span>
            </p>
          )}
          <p>
            Approval required:{' '}
            <span className="text-ink">
              {r.snap_requires_security_approval
                ? 'Source + Security'
                : 'Source'}
            </span>
          </p>
          {/* Per §5 design correction: NO content_hash, NO byte_length,
              NO values here. The verify card shows only what an approver
              needs to make a decision — key names, not their contents. */}
          <p className="text-[11px] text-muted/70 pt-1">
            Values provided: {r.filled_by_user_id ? 'yes' : 'no'} · key names
            only — filled values are never shown.
          </p>
        </div>

        {(showSourceLane || showSecurityLane) && (
          <div className="space-y-2 pt-2 border-t border-border/60">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment (visible in audit + to requester)"
              rows={2}
              className="w-full bg-surface border border-edge rounded-md px-3 py-2 text-ink text-sm focus:border-accent"
            />
            {showSourceLane && (
              <div className="flex items-center justify-end gap-2">
                {sourceVoted && (
                  <span className="text-muted text-xs mr-auto">
                    Source vote recorded.
                  </span>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  disabled={verify.isPending}
                  onClick={() => void run('reject', 'source')}
                >
                  Reject (source)
                </Button>
                {canSourceApprove && (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={verify.isPending}
                    onClick={() => void run('approve', 'source')}
                  >
                    Approve (source)
                  </Button>
                )}
              </div>
            )}
            {showSecurityLane && (
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
                {!sourceVoted && (
                  <span className="text-muted text-xs mr-auto">
                    Security approval opens after the source vote.
                  </span>
                )}
                <Button
                  variant="danger"
                  size="sm"
                  disabled={verify.isPending}
                  onClick={() => void run('reject', 'security')}
                >
                  Reject (security)
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={verify.isPending || !canSecurityApprove}
                  title={
                    canSecurityApprove
                      ? undefined
                      : 'Waiting for the source vote'
                  }
                  onClick={() => void run('approve', 'security')}
                >
                  Approve (security)
                </Button>
              </div>
            )}
          </div>
        )}

        {!showSourceLane && !showSecurityLane && sodReason && (
          <div className="bg-bg/40 border border-border/60 rounded-md px-3 py-2 text-muted text-xs">
            You cannot approve this request: {sodReason}
          </div>
        )}

        {toast && (
          <div className="text-accent text-xs bg-accent/10 border border-accent/30 rounded-md px-3 py-2">
            {toast}
          </div>
        )}
        {error && (
          <div className="text-bad text-xs bg-bad-bg border border-bad-line rounded-md px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Card>
  );
}

export function CrossTeamApprovalChainCard({ request: r }: { request: AccessRequest }) {
  // Source side: at least one approve vote on a cross_team request
  // counts as source-approved (v1 supports min_approvers ∈ {0, 1}).
  const sourceVoted =
    (r.approvals ?? []).some((a) => a.decision === 'approve');
  const securityRequired = !!r.snap_requires_security_approval;
  // V1 heuristic: security vote is inferred by status crossing into
  // approved (not pending_verification) when security_required=true.
  // RequestDetail flips into other cards then; here we show progress.
  const securityVoted = r.status === 'approved' || r.status === 'executed';

  return (
    <Card>
      <div className="px-5 py-4 border-b border-border/60">
        <h3 className="text-ink font-semibold">Approval chain</h3>
      </div>
      <div className="px-5 py-4 space-y-2 text-sm">
        <ChainRow label="Source approval" done={sourceVoted} />
        {securityRequired && (
          <ChainRow label="Security approval" done={securityVoted} />
        )}
        {!securityRequired && (
          <p className="text-muted text-xs">
            Workflow policy does not require security approval.
          </p>
        )}
      </div>
    </Card>
  );
}

function ChainRow({ label, done }: { label: string; done: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink">{label}</span>
      <StatusPill
        variant={done ? 'approved' : 'pending'}
        tone="outline"
      >
        {done ? 'done' : 'pending'}
      </StatusPill>
    </div>
  );
}

// Same reading as extractCrossTeamErrorCode in api/crossTeam.ts: the
// api renders cross-team errors as `{"error": "<code>"}`.
function extractErrorCodeFromApiErr(err: ApiError): string | undefined {
  if (err.body && typeof err.body === 'object') {
    const obj = err.body as { code?: unknown; error_code?: unknown; error?: unknown };
    if (typeof obj.code === 'string') return obj.code;
    if (typeof obj.error_code === 'string') return obj.error_code;
    if (typeof obj.error === 'string') return obj.error;
  }
  return undefined;
}

