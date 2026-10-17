/**
 * The reveal path the console had before the inline reveal panel:
 * a single-wrap modal for approver-approved reads, and a link to the
 * reveal session page for direct reveals. Kept as is while the request
 * page is rebuilt; the inline reveal replaces it in the next change.
 */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { ApiError } from '../../api/client';
import {
  revealWrap,
  useRequestWraps,
  type RevealedWrap,
  type WrapSummary,
} from '../../api/requests';
import { describeRevealError } from '../../api/revealErrors';
import { isRevealSessionFlow, revealSessionPath } from '../../api/revealSessions';
import { useEnvironmentsForProject } from '../../api/tenancy';
import type { AccessRequest } from '../../api/types';
import { useAuth } from '../../auth/AuthContext';
import { clearCopiedSecret, copySecret } from '../../lib/secretClipboard';
import { Button } from '../../ui/Button';
import { Card } from '../../ui/Card';
import { StatusPill } from '../../ui/StatusPill';

// --- Wraps (read-flow only, single-shot UX) -------------------------

export function WrapsCard({
  request: r,
  query,
}: {
  request: AccessRequest;
  query: ReturnType<typeof useRequestWraps>;
}) {
  const { identity } = useAuth();
  const [reveal, setReveal] = useState<WrapSummary | null>(null);
  const rows = query.data ?? [];
  const ready = rows.filter((w) => !w.consumed);
  const consumed = rows.filter((w) => w.consumed);
  // Direct-reveal wraps are only handed out inside an open reveal
  // session (api#201, API-S-20), so those requests go to the reveal
  // session page. The per-wrap modal stays for approver-approved reads.
  const sessionFlow = isRevealSessionFlow(r);
  const isOwner = !!identity && identity.id === r.requester_id;
  const showSessionLink =
    sessionFlow &&
    isOwner &&
    (ready.length > 0 ||
      (r.status === 'approved' && !query.isLoading && rows.length === 0));

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2">
        <h3 className="text-ink font-semibold">Wraps</h3>
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
            <span className="font-mono text-ink">{r.target_provider_type}</span>
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
                className="flex items-center justify-between gap-3 bg-bg/40 border border-border/60 rounded-md px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-mono text-ink text-sm truncate">
                    {w.key_name || '(default)'}
                  </div>
                  <div className="text-muted text-[11px]">
                    expires {formatRelativeFuture(w.expires_at)}
                  </div>
                </div>
                {sessionFlow ? (
                  <StatusPill variant="pending" tone="outline">
                    ready
                  </StatusPill>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setReveal(w)}
                  >
                    Reveal (one-time)
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {showSessionLink && <RevealSessionLink request={r} />}

        {consumed.length > 0 && (
          <ul className="space-y-2 pt-2 border-t border-border/40">
            {consumed.map((w) => (
              <li
                key={w.id}
                className="flex items-center justify-between gap-3 bg-bg/20 border border-border/40 rounded-md px-3 py-2 opacity-60"
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

        <div className="bg-warn-bg border border-warn-line border-l-4 border-l-warn rounded-md px-3 py-2 text-xs">
          <div className="text-warn font-semibold">Reveal-once.</div>
          <div className="text-muted mt-0.5">
            {sessionFlow
              ? 'This is a direct reveal: its values open together in a timed reveal session and clear when the session ends. Each wrap is single-use.'
              : "Clicking Reveal calls the CP's single-shot endpoint. The value is shown in a modal, copy-then-clear. A second call returns 410 and the wrap is gone forever."}
          </div>
        </div>
      </div>

      {reveal && (
        <RevealModal
          requestId={r.id}
          wrap={reveal}
          onClose={() => {
            setReveal(null);
            query.refetch();
          }}
        />
      )}
    </Card>
  );
}

// Opens the reveal-session page for a direct-reveal request. The page
// route needs the environment id; the request carries the project id and
// environment name in target_scope, so resolve the id from the project's
// environments.
function RevealSessionLink({ request: r }: { request: AccessRequest }) {
  const navigate = useNavigate();
  const projectId = r.target_scope?.project_id;
  const envName = r.target_scope?.environment;
  const envs = useEnvironmentsForProject(projectId);
  const envId = envs.data?.find((e) => e.name === envName)?.id;
  const path =
    projectId && envId ? revealSessionPath(projectId, envId, r.id) : null;

  return (
    <div className="bg-bg/40 border border-border/60 rounded-md px-3 py-2 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted text-xs">
          Direct reveal values are shown in a reveal session.
        </span>
        <Button
          variant="primary"
          size="sm"
          disabled={!path}
          onClick={() => {
            if (path) navigate(path);
          }}
        >
          Open reveal session
        </Button>
      </div>
      {!path && !envs.isLoading && (
        <p className="text-xs text-bad">
          Couldn't find this request's environment. Open it from{' '}
          <Link to="/projects" className="text-accent underline">
            My Projects
          </Link>{' '}
          instead.
        </p>
      )}
    </div>
  );
}

// --- Reveal modal (single-shot retrieval + clear-on-close) ----------

function RevealModal({
  requestId,
  wrap,
  onClose,
}: {
  requestId: string;
  wrap: WrapSummary;
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
  // pinned in state. Closing the modal also clears a copied value from
  // the clipboard if it's still there (UI-N-03).
  useEffect(() => {
    return () => {
      setDecoded(null);
      setRevealed(null);
      void clearCopiedSecret();
    };
  }, []);

  // Countdown — runs only while the value is shown. When it hits 0
  // we clear the plaintext from state so even an open browser tab
  // stops carrying it. The user can also "Hide now" to clear early.
  //
  // The clear happens in the timer callback on the tick that reaches
  // 0, rather than in a follow-up effect run, so the effect body never
  // sets state synchronously. `ttlLeft` is always seeded to
  // REVEAL_TTL_SECONDS before `shown`, so 0 is only reachable by a
  // tick; timing is the same as before (cleared 60s after reveal).
  useEffect(() => {
    if (phase !== 'shown') return;
    const t = window.setTimeout(() => {
      if (ttlLeft <= 1) {
        setTtlLeft(0);
        setDecoded(null);
        setRevealed(null);
        setPhase('expired');
        void clearCopiedSecret();
        return;
      }
      setTtlLeft(ttlLeft - 1);
    }, 1000);
    return () => window.clearTimeout(t);
  }, [phase, ttlLeft]);

  const doReveal = async () => {
    setPhase('revealing');
    try {
      const r = await revealWrap(requestId, wrap.id);
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
    void clearCopiedSecret();
  };

  const doCopy = async () => {
    if (!decoded) return;
    try {
      await copySecret(decoded);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="relative bg-surface border border-border rounded-md w-[520px] max-w-full p-6 space-y-4 shadow-overlay">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-ink font-semibold text-xl tracking-tight">
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
            className="text-muted hover:text-ink text-xl leading-none w-8 h-8 rounded-sm hover:bg-bg/40 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {phase === 'confirm' && (
          <>
            <div className="bg-warn-bg border border-warn-line border-l-4 border-l-warn rounded-md px-4 py-3 text-sm">
              <div className="text-warn font-semibold">
                Single-use — copy it now.
              </div>
              <div className="text-muted text-xs mt-1">
                Clicking <span className="text-ink">Reveal</span> consumes
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
                <label className="block text-xs text-muted font-medium">
                  {revealed.key_name || 'value'}
                </label>
                <TtlChip seconds={ttlLeft} />
              </div>
              <textarea
                readOnly
                value={decoded}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full bg-surface border border-edge rounded-md px-3 py-2 text-ink text-sm font-mono break-all focus:border-accent"
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
              A copied value is cleared from your clipboard when this closes, so paste it first.
            </p>
          </>
        )}

        {phase === 'expired' && (
          <>
            <div className="bg-bg/40 border border-border rounded-md px-4 py-6 text-center text-sm space-y-2">
              <div className="text-ink font-semibold">Value cleared from this tab.</div>
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
        ? 'bg-warn-bg text-warn border-warn-line'
        : 'bg-bad-bg text-bad border-bad-line';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-mono ${tone}`}
      title="Auto-hide countdown — the value is wiped from this tab when it hits 0"
    >
      <span className="w-1.5 h-1.5 rounded-sm bg-current animate-pulse" />
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

function InlineApiError({ err }: { err: unknown }) {
  if (!(err instanceof ApiError)) return null;
  return (
    <div className="mt-3 text-xs text-bad bg-bad-bg border border-bad-line border-l-4 border-l-bad rounded-md px-3 py-2">
      {describeRevealError(err)}
    </div>
  );
}

