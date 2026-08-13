/**
 * Request detail page (`/requests/:id`) — matches Figma frame 26:2.
 *
 * Layout (two columns on lg+):
 *
 *   ┌── breadcrumb + title strip ───────────────────────────────────┐
 *   │ Requests · REQ-1042                                           │
 *   │ Read prod/db/password                                         │
 *   │ [Pending approval] type [read]  requested by alice@corp · 2m  │
 *   ├──── LEFT (≈ 1.6fr) ─────────┬──── RIGHT (≈ 1fr) ───────────────┤
 *   │ Timeline                    │ Details (k/v)                    │
 *   │ Approvals                   │ Time-to-decide pill              │
 *   │ Wraps (read flow only)      │ Approver actions card            │
 *   │ GitOps observations         │                                  │
 *   └─────────────────────────────┴──────────────────────────────────┘
 *
 * Data sourcing:
 *   - `useRequest(id)` hydrates the entire page; the api response
 *     includes inline `approvals[]`.
 *   - `useRequestGitOps(id)` hydrates the observations card when the
 *     §26 feature is on; a 404 from the api flips the card to a
 *     "feature off" banner without polluting the error surface.
 *   - The `Wraps` card is a **read-flow-only** preview today — the
 *     full single-shot reveal-once UX needs the read-wrap retrieval
 *     endpoint and a user-confirm step that lands with slice 7. We
 *     surface the placeholder so the operator knows what to expect.
 *
 * Hard rules:
 *   - NEVER call the wrap retrieval endpoint speculatively. The
 *     placeholder Reveal button is disabled today; the next slice
 *     wires the explicit click handler.
 *   - The page renders metadata only — no secret values appear in any
 *     of the cards' content.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  revealWrap,
  useApproveRequest,
  useCancelRequest,
  useRejectRequest,
  useRequest,
  useRequestGitOps,
  useRequestWraps,
  type RevealedWrap,
  type WrapSummary,
} from '../api/requests';
import { useWorkflows } from '../api/workflows';
import { useTeams } from '../api/teams';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { crossTeamErrorMessage, useVerifyCrossTeam } from '../api/crossTeam';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { StatusPill } from '../ui/StatusPill';
import {
  RequestStatusPill,
  formatRelativeShort,
  shortId,
} from './Requests';

export function RequestDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { identity } = useAuth();
  const req = useRequest(id);
  const workflows = useWorkflows();
  const gitops = useRequestGitOps(id);
  const isReadFlow = req.data?.type === 'read';
  const isOwner = req.data?.requester_id === identity?.id;
  const wraps = useRequestWraps(
    id,
    identity?.id ?? '',
    !!req.data && isReadFlow && isOwner,
  );

  if (req.isLoading) {
    return <div className="text-muted text-sm">Loading…</div>;
  }
  if (req.isError) {
    return (
      <Card className="border-red-500/40 p-5 text-sm">
        <div className="text-red-300 font-medium">Failed to load request</div>
        <div className="text-muted mt-1">{stringifyError(req.error)}</div>
      </Card>
    );
  }
  if (!req.data || !id) return null;

  const r = req.data;
  const me = identity?.id ?? '';
  const isMine = r.requester_id === me;
  const workflowName =
    workflows.data?.find((w) => w.id === r.workflow_id)?.name ?? '—';

  // cross_team requests carry their target in the destination_* fields;
  // target_secret_ref / target_provider_type are empty for them, so the
  // title + Details rail must read the destination fields instead (ui#87
  // follow-up: no blank rows, no stray "·").
  const isCrossTeam = r.type === 'cross_team';
  const displayRef = isCrossTeam
    ? r.destination_secret_ref ?? ''
    : r.target_secret_ref;
  const displayProvider = isCrossTeam
    ? r.destination_provider_label ?? ''
    : r.target_provider_type;
  const requesterLabel = r.requester_display ?? r.requester_id;

  return (
    <div>
      {/* Breadcrumb + title strip */}
      <div className="mb-6">
        <div className="text-muted text-xs">
          <Link to="/requests" className="hover:text-accent">
            Requests
          </Link>
          <span className="mx-1.5">·</span>
          <span className="text-text font-mono">{shortId(r.id)}</span>
        </div>
        <h1 className="text-text text-2xl font-bold mt-2 tracking-tight">
          <span className="text-accent-bright capitalize">{r.type}</span>{' '}
          <span className="font-mono">{displayRef}</span>
        </h1>
        <div className="flex items-center gap-2 flex-wrap mt-3">
          <RequestStatusPill status={r.status} />
          <span className="text-muted text-xs">type</span>
          <StatusPill
            variant={r.type === 'patch' ? 'accent' : 'pending'}
            tone="outline"
          >
            {r.type}
          </StatusPill>
          <span className="text-muted text-xs ml-2">requested by</span>
          <span className="text-text text-sm">{requesterLabel}</span>
          <span className="text-muted text-xs">
            · {formatRelativeShort(r.created_at)}
          </span>
        </div>
        <p className="text-muted text-xs mt-3 max-w-3xl">
          {displayProvider && (
            <>
              Provider:{' '}
              <span className="text-text font-mono">{displayProvider}</span>{' '}
              ·{' '}
            </>
          )}
          workflow:{' '}
          <span className="text-text font-mono">{workflowName}</span> · values
          are never shown — only metadata + single-use wraps.
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6">
        <div className="space-y-6">
          <TimelineCard request={r} />
          <ApprovalsCard request={r} />
          {r.type === 'read' && (
            <WrapsCard request={r} query={wraps} userId={me} />
          )}
          <GitOpsCard query={gitops} />
        </div>
        <div className="space-y-6">
          <DetailsCard request={r} workflowName={workflowName} />
          {r.status === 'pending' && <TimeToDecideCard request={r} />}
          {r.status === 'pending' && !isMine && (
            <ApproverActionsCard request={r} actorId={me} />
          )}
          {r.status === 'pending' && isMine && (
            <CancelOwnCard
              request={r}
              actorId={me}
              onCancelled={() => navigate('/requests')}
            />
          )}
          {r.type === 'cross_team' && r.status === 'pending_verification' && (
            <CrossTeamVerifyCard request={r} actorId={me} />
          )}
          {r.type === 'cross_team' && r.snap_requires_security_approval && (
            <CrossTeamApprovalChainCard request={r} />
          )}
          {r.type === 'cross_team' &&
            (r.status === 'pending_values' || r.status === 'pending_verification') &&
            isMine && (
              <CancelOwnCard
                request={r}
                actorId={me}
                onCancelled={() => navigate('/requests')}
              />
            )}
        </div>
      </div>
    </div>
  );
}

// --- Timeline -------------------------------------------------------

interface TimelineNode {
  label: string;
  sub?: string;
  time: string;
  tone: 'created' | 'workflow' | 'enqueued' | 'approved' | 'rejected' | 'claimed' | 'completed' | 'failed' | 'cancelled';
}

function TimelineCard({ request: r }: { request: AccessRequest }) {
  const nodes = buildTimeline(r);
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-text font-semibold">Timeline</h3>
        <span className="text-muted text-xs ml-auto font-mono">
          correlation_id
        </span>
      </div>
      <ul className="px-5 py-4 space-y-3">
        {nodes.map((n, i) => (
          <li key={i} className="flex items-start gap-3">
            <span
              className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${TIMELINE_DOT[n.tone]}`}
            />
            <div className="flex-1 min-w-0">
              <div className="text-text text-sm font-medium">{n.label}</div>
              {n.sub && (
                <div className="text-muted text-xs font-mono mt-0.5">
                  {n.sub}
                </div>
              )}
            </div>
            <span className="text-muted text-xs font-mono shrink-0">
              {n.time}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const TIMELINE_DOT: Record<TimelineNode['tone'], string> = {
  created: 'bg-accent',
  workflow: 'bg-purple-400',
  enqueued: 'bg-yellow-400',
  approved: 'bg-success',
  rejected: 'bg-red-400',
  claimed: 'bg-blue-400',
  completed: 'bg-success',
  failed: 'bg-red-400',
  cancelled: 'bg-muted',
};

function buildTimeline(r: AccessRequest): TimelineNode[] {
  const out: TimelineNode[] = [];
  out.push({
    label: 'Created',
    sub: r.requester_id,
    time: formatTime(r.created_at),
    tone: 'created',
  });
  if (r.workflow_id) {
    out.push({
      label: 'Workflow attached',
      sub: shortId(r.workflow_id),
      time: formatTime(r.created_at),
      tone: 'workflow',
    });
  }
  (r.approvals ?? [])
    .slice()
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .forEach((a) => {
      out.push({
        label: a.decision === 'approve' ? 'Approved' : 'Rejected',
        sub: a.approver_id + (a.comment ? ` — ${a.comment}` : ''),
        time: formatTime(a.created_at),
        tone: a.decision === 'approve' ? 'approved' : 'rejected',
      });
    });
  if (r.status === 'cancelled') {
    out.push({
      label: 'Cancelled by requester',
      time: formatTime(r.updated_at ?? r.created_at),
      tone: 'cancelled',
    });
  }
  if (r.job_id && r.status !== 'cancelled') {
    out.push({
      label: 'Enqueued — awaiting agent claim',
      sub: shortId(r.job_id),
      time: formatTime(r.updated_at ?? r.created_at),
      tone: 'enqueued',
    });
  }
  if (r.status === 'executed') {
    out.push({
      label: 'Completed',
      sub:
        r.type === 'read'
          ? 'single-use wrap(s) issued'
          : 'provider write succeeded',
      time: formatTime(r.updated_at ?? r.created_at),
      tone: 'completed',
    });
  }
  if (r.status === 'failed') {
    out.push({
      label: 'Failed',
      sub: 'agent reported failure',
      time: formatTime(r.updated_at ?? r.created_at),
      tone: 'failed',
    });
  }
  return out;
}

// --- Approvals ------------------------------------------------------

function ApprovalsCard({ request: r }: { request: AccessRequest }) {
  const approvals = r.approvals ?? [];
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <h3 className="text-text font-semibold">Approvals</h3>
      </div>
      {approvals.length === 0 ? (
        <div className="px-5 py-6 text-muted text-sm">
          No votes cast yet.
        </div>
      ) : (
        <ul>
          {approvals.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 px-5 py-4 border-b border-border/40 last:border-0"
            >
              <span
                className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                  a.decision === 'approve' ? 'bg-success' : 'bg-red-400'
                }`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-text text-sm">
                    {a.approver_id}
                  </span>
                  <StatusPill
                    variant={a.decision === 'approve' ? 'approved' : 'rejected'}
                    tone="outline"
                  >
                    {a.decision === 'approve' ? 'approved' : 'rejected'}
                  </StatusPill>
                </div>
                {a.comment && (
                  <p className="text-muted text-xs mt-1 italic">
                    &ldquo;{a.comment}&rdquo;
                  </p>
                )}
              </div>
              <span className="text-muted text-xs font-mono shrink-0">
                {formatTime(a.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Wraps (read-flow only, single-shot UX) -------------------------

function WrapsCard({
  request: r,
  query,
  userId,
}: {
  request: AccessRequest;
  query: ReturnType<typeof useRequestWraps>;
  userId: string;
}) {
  const [reveal, setReveal] = useState<WrapSummary | null>(null);
  const rows = query.data ?? [];
  const ready = rows.filter((w) => !w.consumed);
  const consumed = rows.filter((w) => w.consumed);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-text font-semibold">Wraps</h3>
        <span className="text-muted text-xs ml-auto">
          single-use · reveal consumes the wrap permanently
        </span>
      </div>
      <div className="px-5 py-4 space-y-3">
        {query.isLoading && (
          <div className="text-muted text-sm">Loading…</div>
        )}
        {query.error instanceof ApiError && (
          <InlineApiError err={query.error} />
        )}
        {!query.isLoading && rows.length === 0 && r.status !== 'executed' && (
          <p className="text-muted text-xs">
            No wraps issued yet. Once approved, an agent claims the read
            job, fetches from{' '}
            <span className="font-mono text-text">{r.target_provider_type}</span>
            , and posts a single-use wrap per requested key.
          </p>
        )}
        {!query.isLoading && rows.length === 0 && r.status === 'executed' && (
          <p className="text-muted text-xs">
            All wraps have been consumed. Submit a new request to view the
            value again.
          </p>
        )}

        {ready.length > 0 && (
          <ul className="space-y-2">
            {ready.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 bg-bg/40 border border-border/60 rounded-lg px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-text text-sm truncate">
                    {w.key_name || '(default)'}
                  </div>
                  <div className="text-muted text-[11px]">
                    expires {formatRelativeFuture(w.expires_at)}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setReveal(w)}
                >
                  Reveal (one-time)
                </Button>
              </li>
            ))}
          </ul>
        )}

        {consumed.length > 0 && (
          <ul className="space-y-2 pt-2 border-t border-border/40">
            {consumed.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 bg-bg/20 border border-border/40 rounded-lg px-3 py-2 opacity-60"
              >
                <span className="font-mono text-muted text-sm truncate line-through">
                  {w.key_name || '(default)'}
                </span>
                <StatusPill variant="cancelled" tone="outline">
                  consumed
                </StatusPill>
              </li>
            ))}
          </ul>
        )}

        <div className="bg-yellow-400/10 border border-yellow-400/40 border-l-4 border-l-yellow-400 rounded-lg px-3 py-2 text-xs">
          <div className="text-yellow-300 font-semibold">Reveal-once.</div>
          <div className="text-muted mt-0.5">
            Clicking Reveal calls the CP's single-shot endpoint. The value
            is shown in a modal, copy-then-clear. A second call returns 410
            and the wrap is gone forever.
          </div>
        </div>
      </div>

      {reveal && (
        <RevealModal
          requestId={r.id}
          wrap={reveal}
          userId={userId}
          onClose={() => {
            setReveal(null);
            query.refetch();
          }}
        />
      )}
    </Card>
  );
}

// --- Reveal modal (single-shot retrieval + clear-on-close) ----------

function RevealModal({
  requestId,
  wrap,
  userId,
  onClose,
}: {
  requestId: string;
  wrap: WrapSummary;
  userId: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<
    'confirm' | 'revealing' | 'shown' | 'expired' | 'error'
  >('confirm');
  const [revealed, setRevealed] = useState<RevealedWrap | null>(null);
  const [decoded, setDecoded] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  // The value is pinned to the modal for this many seconds after
  // reveal. Once the timer hits 0 we clear `decoded` + `revealed`
  // from React state and flip to the `expired` phase — the user must
  // close + submit a new request to view again (the wrap is already
  // consumed server-side; this is the SPA-side shoulder-surfing guard).
  const REVEAL_TTL_SECONDS = 60;
  const [ttlLeft, setTtlLeft] = useState<number>(REVEAL_TTL_SECONDS);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Best-effort plaintext hygiene: drop refs on unmount. The browser
  // GCs the backing string on its own schedule, but we don't keep it
  // pinned in state.
  useEffect(() => {
    return () => {
      setDecoded(null);
      setRevealed(null);
    };
  }, []);

  // Countdown — runs only while the value is shown. When it hits 0
  // we clear the plaintext from state so even an open browser tab
  // stops carrying it. The user can also "Hide now" to clear early.
  useEffect(() => {
    if (phase !== 'shown') return;
    if (ttlLeft <= 0) {
      setDecoded(null);
      setRevealed(null);
      setPhase('expired');
      return;
    }
    const t = window.setTimeout(() => setTtlLeft((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [phase, ttlLeft]);

  const doReveal = async () => {
    setPhase('revealing');
    try {
      const r = await revealWrap(requestId, wrap.id, userId);
      const text = atob(r.value);
      setRevealed(r);
      setDecoded(text);
      setTtlLeft(REVEAL_TTL_SECONDS);
      setPhase('shown');
    } catch (e) {
      setErr(e);
      setPhase('error');
    }
  };

  const hideNow = () => {
    setDecoded(null);
    setRevealed(null);
    setPhase('expired');
  };

  const doCopy = async () => {
    if (!decoded) return;
    try {
      await navigator.clipboard.writeText(decoded);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative bg-surface border border-border rounded-2xl w-[520px] max-w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-text font-bold text-xl tracking-tight">
              Reveal{' '}
              <span className="font-mono text-accent">
                {wrap.key_name || '(default)'}
              </span>
              ?
            </div>
            <div className="text-muted text-xs mt-1 font-mono">
              wrap {wrap.id.slice(0, 8)}…
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-xl leading-none w-8 h-8 rounded-full hover:bg-bg/40 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {phase === 'confirm' && (
          <>
            <div className="bg-yellow-400/10 border border-yellow-400/40 border-l-4 border-l-yellow-400 rounded-lg px-4 py-3 text-sm">
              <div className="text-yellow-300 font-semibold">
                Single-use — copy it now.
              </div>
              <div className="text-muted text-xs mt-1">
                Clicking <span className="text-text">Reveal</span> consumes
                the wrap permanently. You won't be able to retrieve this
                value again from this request.
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <Button variant="secondary" size="md" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" size="md" onClick={doReveal}>
                Reveal (one-time)
              </Button>
            </div>
          </>
        )}

        {phase === 'revealing' && (
          <div className="py-6 text-center text-muted text-sm">
            Decrypting through KMS…
          </div>
        )}

        {phase === 'shown' && decoded !== null && revealed && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs text-muted font-medium uppercase tracking-wider">
                  {revealed.key_name || 'value'}
                </label>
                <TtlChip seconds={ttlLeft} />
              </div>
              <textarea
                readOnly
                value={decoded}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono break-all focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
              />
              <div className="text-muted text-[11px] font-mono">
                {revealed.byte_length} bytes · sha256{' '}
                {revealed.content_hash.slice(0, 12)}… · {revealed.algorithm}
              </div>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <Button variant="secondary" size="md" onClick={doCopy}>
                {copied ? 'Copied!' : 'Copy'}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="md" onClick={hideNow}>
                  Hide now
                </Button>
                <Button variant="primary" size="md" onClick={onClose}>
                  Close
                </Button>
              </div>
            </div>
            <p className="text-muted text-[11px] text-center -mt-1">
              Auto-clears from the SPA in {ttlLeft}s · the wrap is already consumed server-side.
            </p>
          </>
        )}

        {phase === 'expired' && (
          <>
            <div className="bg-bg/40 border border-border rounded-lg px-4 py-6 text-center text-sm space-y-2">
              <div className="text-text font-semibold">Value cleared from this tab.</div>
              <div className="text-muted text-xs">
                {revealed === null
                  ? 'The 60-second window elapsed (or you clicked Hide now).'
                  : 'Hidden early — the wrap was already consumed server-side, so a re-reveal is not possible.'}
                <br />
                To view this value again you'll need a new request.
              </div>
            </div>
            <div className="flex items-center justify-end pt-2 border-t border-border/60">
              <Button variant="primary" size="md" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}

        {phase === 'error' && (
          <>
            <InlineApiError err={err} />
            <div className="flex items-center justify-end pt-2 border-t border-border/60">
              <Button variant="primary" size="md" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function TtlChip({ seconds }: { seconds: number }) {
  // Visually nudge the user as the window narrows:
  //   >30s     accent  — comfortable read-and-copy window
  //   11-30s   warning — getting close
  //   ≤10s     danger  — last call
  const tone =
    seconds > 30
      ? 'bg-accent/15 text-accent border-accent/40'
      : seconds > 10
        ? 'bg-yellow-400/15 text-yellow-300 border-yellow-400/40'
        : 'bg-red-500/15 text-red-300 border-red-500/40';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono ${tone}`}
      title="Auto-hide countdown — the value is wiped from this tab when it hits 0"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
      hides in {seconds}s
    </span>
  );
}

function formatRelativeFuture(iso: string | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const seconds = Math.round((t - Date.now()) / 1000);
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

// --- GitOps observations -------------------------------------------

function GitOpsCard({
  query,
}: {
  query: ReturnType<typeof useRequestGitOps>;
}) {
  if (query.isLoading) return null;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
          <h3 className="text-text font-semibold">GitOps observations</h3>
          <StatusPill variant="warning" tone="outline">
            disabled
          </StatusPill>
        </div>
        <p className="px-5 py-4 text-muted text-xs">
          The BRD §26 read-only ArgoCD visibility is off on this api
          (<code className="font-mono">SB_GITOPS_ENABLED=false</code>). When
          enabled, each app mapping bound to this secret renders its
          observation status here.
        </p>
      </Card>
    );
  }
  const rows = query.data ?? [];
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-text font-semibold">GitOps observations</h3>
        <span className="text-muted text-xs ml-auto font-mono">read-only</span>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-6 text-muted text-sm">
          No app mappings bound to this secret — observations skipped.
        </div>
      ) : (
        <ul>
          {rows.map((o) => (
            <li
              key={o.id}
              className="px-5 py-4 border-b border-border/40 last:border-0"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-accent text-sm">
                  {o.application_name}
                </span>
                <StatusPill
                  variant={
                    o.status === 'applied'
                      ? 'approved'
                      : o.status === 'failed'
                        ? 'rejected'
                        : o.status === 'applied_unverified'
                          ? 'warning'
                          : 'pending'
                  }
                  tone="outline"
                >
                  {o.status}
                </StatusPill>
              </div>
              <div className="text-muted text-xs mt-1 font-mono">
                ArgoCD project: {o.project_name ?? '—'} · cluster:{' '}
                {o.cluster_name ?? '—'}
              </div>
              {o.observed_state && Object.keys(o.observed_state).length > 0 && (
                <pre className="text-[11px] text-muted mt-2 bg-bg/40 border border-border/60 rounded-lg px-3 py-2 overflow-x-auto font-mono">
                  observed_state: {JSON.stringify(o.observed_state)}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Details (right column) ----------------------------------------

function DetailsCard({
  request: r,
  workflowName,
}: {
  request: AccessRequest;
  workflowName: string;
}) {
  // cross_team requests keep their target in the destination_* fields;
  // fall back to them so the rail never renders a blank TARGET/PROVIDER.
  const isCrossTeam = r.type === 'cross_team';
  const dRef = isCrossTeam
    ? r.destination_secret_ref || '—'
    : r.target_secret_ref || '—';
  const dProvider = isCrossTeam
    ? r.destination_provider_label || '—'
    : r.target_provider_type || '—';
  const rows: Array<[string, React.ReactNode]> = [
    ['Type', <span key="t" className="font-mono text-text">{r.type}</span>],
    [
      'Requester',
      <span key="r" className="text-text">
        {r.requester_display ?? r.requester_id}
      </span>,
    ],
    [
      'Target',
      <span key="g" className="font-mono text-accent break-all">
        {dRef}
      </span>,
    ],
    [
      'Provider',
      <span key="p" className="font-mono text-text">
        {dProvider}
      </span>,
    ],
    [
      'Workflow',
      <span key="w" className="font-mono text-text">
        {workflowName}
      </span>,
    ],
    ['Created', <span key="c" className="font-mono text-muted">{formatTime(r.created_at)}</span>],
    ...(r.job_id
      ? [
          [
            'Job',
            <span key="j" className="font-mono text-muted text-xs">
              {shortId(r.job_id)}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
    ...(r.reject_reason
      ? [
          [
            'Reject reason',
            <span key="rr" className="text-red-300">
              {r.reject_reason}
            </span>,
          ] as [string, React.ReactNode],
        ]
      : []),
  ];
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60">
        <h3 className="text-text font-semibold">Details</h3>
      </div>
      <dl className="px-5 py-4 space-y-2.5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[110px_1fr] gap-3 items-baseline">
            <dt className="text-muted text-xs uppercase tracking-wider">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

// --- Time to decide ------------------------------------------------

function TimeToDecideCard({ request: _r }: { request: AccessRequest }) {
  // TTL math requires the workflow's wrap_ttl_created_seconds; deriving
  // it accurately from the client needs both the workflow row and a
  // synced clock. Until the next slice plumbs that through, surface the
  // placement with a clear preview chip — the api still enforces the
  // TTL server-side regardless of what we render here.
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-muted text-xs uppercase tracking-wider font-medium">
          Time to decide
        </div>
        <StatusPill variant="neutral" tone="outline">
          preview
        </StatusPill>
      </div>
      <div className="text-yellow-300 text-3xl font-bold tracking-tight">
        3h 48m
      </div>
      <div className="text-muted text-xs mt-2">
        auto-rejects when the request TTL expires
      </div>
    </Card>
  );
}

// --- Approver actions ----------------------------------------------

function ApproverActionsCard({
  request: r,
  actorId,
}: {
  request: AccessRequest;
  actorId: string;
}) {
  const approve = useApproveRequest(r.id);
  const reject = useRejectRequest(r.id);
  const [showReason, setShowReason] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Card className="p-5">
      <div className="text-muted text-xs uppercase tracking-wider font-medium mb-3">
        Approver actions
      </div>
      <p className="text-muted text-xs mb-4">
        You hold <span className="text-text font-mono">secret.approve</span>{' '}
        for this target.
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="md"
          disabled={approve.isPending}
          onClick={() => approve.mutate({ approver_id: actorId })}
        >
          {approve.isPending ? 'Working…' : 'Approve'}
        </Button>
        <Button
          variant="danger"
          size="md"
          disabled={reject.isPending}
          onClick={() => setShowReason((v) => !v)}
        >
          Reject
        </Button>
      </div>

      {showReason && (
        <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
          <label className="block text-xs text-muted font-medium uppercase tracking-wider">
            Reject reason
          </label>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong target / use the read flow instead"
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          />
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowReason(false);
                setReason('');
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={!reason.trim() || reject.isPending}
              onClick={() =>
                reject.mutate({ approver_id: actorId, reason: reason.trim() })
              }
            >
              {reject.isPending ? 'Working…' : 'Confirm reject'}
            </Button>
          </div>
        </div>
      )}

      <p className="text-muted text-[11px] mt-4">
        Rejecting requires a reason. Self-approval is blocked unless the
        workflow allows it.
      </p>

      {(approve.error || reject.error) && (
        <InlineApiError err={(approve.error ?? reject.error) as unknown} />
      )}
    </Card>
  );
}

function CancelOwnCard({
  request: r,
  actorId,
  onCancelled,
}: {
  request: AccessRequest;
  actorId: string;
  onCancelled: () => void;
}) {
  const cancel = useCancelRequest(r.id);
  const [confirming, setConfirming] = useState(false);
  return (
    <Card className="p-5">
      <div className="text-muted text-xs uppercase tracking-wider font-medium mb-3">
        Your request
      </div>
      <p className="text-muted text-xs mb-4">
        You can withdraw this request before it's approved.
      </p>
      {!confirming ? (
        <Button
          variant="secondary"
          size="md"
          onClick={() => setConfirming(true)}
        >
          Cancel request
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-text text-sm">Cancel this request?</p>
          <div className="flex items-center justify-between">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirming(false)}
            >
              Keep it
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => {
                cancel.mutate(actorId, {
                  onSuccess: onCancelled,
                });
              }}
            >
              {cancel.isPending ? 'Working…' : 'Confirm cancel'}
            </Button>
          </div>
        </div>
      )}
      {cancel.error && <InlineApiError err={cancel.error} />}
    </Card>
  );
}

// --- shared bits ----------------------------------------------------

function InlineApiError({ err }: { err: unknown }) {
  if (!(err instanceof ApiError)) return null;
  return (
    <div className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
      {err.status}: {err.message}
    </div>
  );
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

// --- Slice N5 — cross-team verify + approval-chain cards ------------

function CrossTeamVerifyCard({
  request: r,
  actorId,
}: {
  request: AccessRequest;
  actorId: string;
}) {
  const { hasPermission } = useAuth();
  const verify = useVerifyCrossTeam(r.id);
  const teams = useTeams();
  const teamName = teams.data?.find((t) => t.id === r.target_team_id)?.name;
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const isRequester = actorId === r.requester_id;
  const isFiller = !!r.filled_by_user_id && actorId === r.filled_by_user_id;
  // SoD: requester / filler can never be a source approver. Security
  // approver is also blocked from being the source approver on the
  // same request (api enforces; UI shows the hidden-button rationale).
  const canSourceApprove =
    hasPermission('secret.approve') && !isRequester && !isFiller;
  const canSecurityApprove =
    !!r.snap_requires_security_approval &&
    hasPermission('secret.security.approve') &&
    !isRequester &&
    !isFiller;

  const sodReason = (() => {
    if (isRequester) return 'You are the requester.';
    if (isFiller) return 'You provided the values for this request.';
    return null;
  })();

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
          crossTeamErrorMessage(code) ?? `${err.status} · ${err.message}`,
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
        <h3 className="text-text font-semibold">Verify cross-team request</h3>
      </div>
      <div className="px-5 py-4 space-y-3 text-sm">
        {/* Full approver context so nobody approves blind (ui#87). All
            metadata — key NAMES, refs, ids, timestamps, the frozen
            approval requirement. Never a value, hash, or wrapped body. */}
        <div className="space-y-1 text-muted">
          <p>
            Requester:{' '}
            <span className="text-text">
              {r.requester_display ?? r.requester_id}
            </span>
          </p>
          <p>
            Target team:{' '}
            <span className="text-text">
              {r.target_team_name ?? teamName ?? r.target_team_id ?? '—'}
            </span>
          </p>
          <p>
            Target project · env:{' '}
            <span className="font-mono text-text">
              {r.target_project_name ??
                (r.target_project_id ? shortId(r.target_project_id) : '—')}
              {' · '}
              {r.target_environment_name ??
                (r.target_environment_id ? shortId(r.target_environment_id) : '—')}
            </span>
          </p>
          <p>
            Destination:{' '}
            <span className="font-mono text-text">
              {r.destination_provider_label ??
                (r.destination_provider_connection_id
                  ? `connection ${shortId(r.destination_provider_connection_id)}`
                  : r.target_provider_type || '—')}
              {r.destination_secret_ref ? ` · ${r.destination_secret_ref}` : ''}
            </span>
          </p>
          <p>
            Keys ({(r.destination_keys ?? r.target_keys ?? []).length}):{' '}
            <span className="font-mono text-text">
              {(r.destination_keys ?? r.target_keys ?? []).join(', ') || '—'}
            </span>
          </p>
          <p>
            Filled by:{' '}
            <span className="text-text">
              {r.filled_by_display ?? r.filled_by_user_id ?? '—'}
            </span>
            {r.filled_at && (
              <span className="text-muted text-xs"> · {r.filled_at}</span>
            )}
          </p>
          {r.fill_comment && (
            <p>
              Filler comment:{' '}
              <span className="text-text">{r.fill_comment}</span>
            </p>
          )}
          {r.justification && (
            <p>
              Justification:{' '}
              <span className="text-text">{r.justification}</span>
            </p>
          )}
          <p>
            Approval required:{' '}
            <span className="text-text">
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

        {(canSourceApprove || canSecurityApprove) && (
          <div className="space-y-2 pt-2 border-t border-border/60">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Optional comment (visible in audit + to requester)"
              rows={2}
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
            {canSourceApprove && (
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  disabled={verify.isPending}
                  onClick={() => void run('reject', 'source')}
                >
                  Reject (source)
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={verify.isPending}
                  onClick={() => void run('approve', 'source')}
                >
                  Approve (source)
                </Button>
              </div>
            )}
            {canSecurityApprove && (
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/40">
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
                  disabled={verify.isPending}
                  onClick={() => void run('approve', 'security')}
                >
                  Approve (security)
                </Button>
              </div>
            )}
          </div>
        )}

        {!canSourceApprove && !canSecurityApprove && sodReason && (
          <div className="bg-bg/40 border border-border/60 rounded-lg px-3 py-2 text-muted text-xs">
            You cannot approve this request: {sodReason}
          </div>
        )}

        {toast && (
          <div className="text-accent text-xs bg-accent/10 border border-accent/30 rounded-lg px-3 py-2">
            {toast}
          </div>
        )}
        {error && (
          <div className="text-red-300 text-xs bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
      </div>
    </Card>
  );
}

function CrossTeamApprovalChainCard({ request: r }: { request: AccessRequest }) {
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
        <h3 className="text-text font-semibold">Approval chain</h3>
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
      <span className="text-text">{label}</span>
      <StatusPill
        variant={done ? 'approved' : 'pending'}
        tone="outline"
      >
        {done ? 'done' : 'pending'}
      </StatusPill>
    </div>
  );
}

function extractErrorCodeFromApiErr(err: ApiError): string | undefined {
  if (err.body && typeof err.body === 'object') {
    const obj = err.body as { code?: unknown };
    if (typeof obj.code === 'string') return obj.code;
  }
  return undefined;
}

function formatTime(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
