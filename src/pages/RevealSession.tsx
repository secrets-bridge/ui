/**
 * Slice M4 — bulk reveal session page.
 *
 * Routed at `/projects/:id/env/:env_id/reveal/:request_id` — the URL
 * param is the access_request_id; the session itself is created by
 * this page on mount via POST /api/v1/reveal-sessions.
 *
 * Lifecycle (see api#83 + worker#9):
 *
 *   1. Mount → poll the request until status == approved | executed AND
 *      its wraps have landed (the agent's ReadExecutor runs async after
 *      a direct-reveal request is auto-approved; until it completes the
 *      request has zero wraps).
 *   2. Open the bulk reveal session: POST /reveal-sessions returns the
 *      session_id + TTL + the wrap_id + key_name handles (NO values).
 *      Only 503 `wrap_not_ready` (wraps not produced yet, api#160) is
 *      retried, every 2s. Every other refusal is terminal and stops all
 *      polling: 410 (every wrap already consumed or expired), 403
 *      (binding / ownership), 409, a 4xx on the request itself, or a
 *      request status other than pending / approved / executed.
 *   3. Fetch each plaintext via the existing single-shot user retrieval
 *      endpoint (one shot per wrap; rate-limited 20/60s per user).
 *   4. Render countdown over `expires_at - now`; per-row Copy CTAs;
 *      "Hide Now" → POST /reveal-sessions/:id/expire { reason='user_hide' }.
 *   5. On TTL=0 OR unmount: drop every decoded plaintext from React
 *      state; show "expired" banner; fire-and-forget unmount POST with
 *      reason='unmount' (server-side sweeper M3 is the safety net).
 *
 * Hard rules enforced here:
 *   - Never persist plaintext to localStorage / sessionStorage / cookies.
 *     The page only writes to React refs/state which die on unmount.
 *   - All decoded values cleared on TTL=0 (countdown effect + state
 *     transition).
 *   - Re-fetching after expiry is impossible — the wraps are single-shot
 *     server-side AND the M3 sweeper advances their expires_at when the
 *     session row flips expired. Any attempt returns 410.
 *   - Copy goes through `copySecret` (UI-N-03): the clipboard is
 *     cleared on Hide now, at TTL=0, on unmount and 60s after the copy,
 *     but only while it still holds the copied value. We don't stash
 *     the value anywhere else.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useMe } from '../api/me';
import { describeRevealError } from '../api/revealErrors';
import {
  expireSessionUnmount,
  useExpireRevealSession,
  useOpenRevealSession,
  type RevealSessionResponse,
} from '../api/revealSessions';
import { revealWrap } from '../api/requests';
import { useRequest } from '../api/requests';
import { clearCopiedSecret, copySecret } from '../lib/secretClipboard';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';

// `waiting` = Open answered 503 wrap_not_ready; retry after OPEN_RETRY_MS.
type Phase =
  | 'preparing'
  | 'opening'
  | 'waiting'
  | 'fetching'
  | 'shown'
  | 'expired'
  | 'error';

const OPEN_RETRY_MS = 2000;

interface RevealedRow {
  wrap_id: string;
  key_name: string;
  value: string; // decoded plaintext — lives ONLY in React state
  byte_length: number;
  content_hash: string;
}

export function RevealSession() {
  const { id: projectId = '', env_id: envId = '', request_id: requestId = '' } =
    useParams<{ id: string; env_id: string; request_id: string }>();
  const navigate = useNavigate();

  const me = useMe();
  const request = useRequest(requestId);
  const openSession = useOpenRevealSession();
  const expireSession = useExpireRevealSession();

  const [phase, setPhase] = useState<Phase>('preparing');
  const [session, setSession] = useState<RevealSessionResponse | null>(null);
  const [rows, setRows] = useState<RevealedRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ttlLeft, setTtlLeft] = useState<number>(0);

  // ui#85: the countdown is anchored to the server's `expires_at`, not a
  // local page-load timer. `clockOffsetRef` corrects for client/server
  // clock skew — computed once from the response's `opened_at` (server
  // "now" at session creation) so `remaining = expires_at - adjustedNow`
  // reflects the authoritative TTL regardless of a wrong client clock.
  const clockOffsetRef = useRef<number>(0);

  // Apply a freshly derived TTL. At 0 wipe every plaintext from state:
  // replace values with empty strings so React still renders the rows
  // (with masked placeholders) instead of unmounting + losing the
  // audit trail, then flip to 'expired' and clear a copied value.
  const applyTtl = (next: number) => {
    if (next <= 0) {
      setTtlLeft(0);
      setRows((prev) => prev.map((r) => ({ ...r, value: '' })));
      setPhase('expired');
      void clearCopiedSecret();
      return;
    }
    setTtlLeft(next);
  };

  // Resolve the env metadata for breadcrumbs from the /me payload.
  const env = useMemo(() => {
    const proj = me.data?.projects?.find((p) => p.id === projectId);
    return proj?.environments?.find((e) => e.id === envId);
  }, [me.data, projectId, envId]);
  const projectName =
    me.data?.projects?.find((p) => p.id === projectId)?.name ?? projectId;

  // --- step 1: wait for the request to be retrievable ----------------
  //
  // Direct-reveal requests land as `approved` and become `executed`
  // once the agent's ReadExecutor finishes. Either is retrievable
  // server-side, but until the agent posted the wraps the bulk Open
  // returns 503 wrap_not_ready. Poll the request every 2s while
  // preparing; a 4xx on the request itself won't change by polling.
  //
  // The phase follows the request query's state, so it is adjusted
  // during render (React's "adjust state when props change" pattern)
  // instead of in an effect: same transitions, without first
  // committing a stale 'preparing' render. Every branch leaves
  // 'preparing', so this settles after one extra render.
  if (phase === 'preparing') {
    const reqErr = request.error;
    const status = request.data?.status;
    if (reqErr instanceof ApiError && reqErr.status >= 400 && reqErr.status < 500) {
      setError(formatErr(reqErr));
      setPhase('error');
    } else if (status === 'approved' || status === 'executed') {
      setPhase('opening');
    } else if (status !== undefined && status !== 'pending') {
      // cancelled / rejected / failed / expired — surface and stop.
      setPhase('error');
      setError(`Request status is ${status}; cannot reveal.`);
    }
  }

  // Re-poll the request every 2s while preparing — the direct-reveal
  // request transitions approved→executed only after the agent claims
  // and completes its read job (no server-sent events surface here).
  useEffect(() => {
    if (phase !== 'preparing') return;
    const t = window.setInterval(() => {
      void request.refetch();
    }, 2000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // --- step 2: Open the bulk session ---------------------------------
  useEffect(() => {
    if (phase !== 'opening') return;
    if (!requestId) return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await openSession.mutateAsync({
          access_request_id: requestId,
        });
        if (cancelled) return;
        setSession(resp);
        // Anchor the countdown to the server clock: offset = server
        // opened_at − client now-at-receive. Applied to every subsequent
        // derive so the display tracks the real remaining time.
        clockOffsetRef.current = computeClockOffset(resp.opened_at);
        setTtlLeft(deriveTtlSeconds(resp.expires_at, clockOffsetRef.current));
        setPhase('fetching');
      } catch (err) {
        if (cancelled) return;
        // Wraps genuinely pending (agent still working): retry Open
        // after a delay. Anything else is terminal, including 410: the
        // wraps existed and are all consumed or expired, and polling
        // would only hammer Open forever.
        if (isWrapNotReady(err)) {
          setPhase('waiting');
          return;
        }
        setError(formatErr(err));
        setPhase('error');
      }
    })();
    return () => {
      cancelled = true;
    };
    // openSession is stable from useMutation; intentional dep set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, requestId]);

  // 503 wrap_not_ready: one Open retry per OPEN_RETRY_MS, no faster.
  useEffect(() => {
    if (phase !== 'waiting') return;
    const t = window.setTimeout(() => setPhase('opening'), OPEN_RETRY_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // --- step 3: fetch each wrap's plaintext ---------------------------
  useEffect(() => {
    if (phase !== 'fetching') return;
    if (!session) return;
    let cancelled = false;
    (async () => {
      const fetched: RevealedRow[] = [];
      const errs: string[] = [];
      for (const w of session.wraps) {
        try {
          const r = await revealWrap(requestId, w.wrap_id);
          fetched.push({
            wrap_id: w.wrap_id,
            key_name: r.key_name ?? w.key_name ?? '(value)',
            value: safeAtob(r.value),
            byte_length: r.byte_length,
            content_hash: r.content_hash,
          });
        } catch (err) {
          errs.push(`${w.key_name ?? w.wrap_id}: ${formatErr(err)}`);
        }
      }
      if (cancelled) return;
      setRows(fetched);
      if (errs.length > 0 && fetched.length === 0) {
        setError(errs.join('\n'));
        setPhase('error');
        return;
      }
      if (errs.length > 0) {
        setError(`Partial reveal: ${errs.length} wrap(s) failed.`);
      }
      setPhase('shown');
      // A session that lapsed while the wraps were being fetched is
      // cleared in the same batch, so plaintext never renders.
      applyTtl(deriveTtlSeconds(session.expires_at, clockOffsetRef.current));
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, session, requestId]);

  // --- countdown (drives TTL=0 auto-clear) ---------------------------
  //
  // Every place that recomputes the remaining TTL (fetch completion,
  // the 1s tick, the focus/visibility resync) goes through applyTtl,
  // which performs the TTL=0 clear itself. The effects therefore only
  // set state from timer/event callbacks, never synchronously.
  useEffect(() => {
    if (phase !== 'shown') return;
    if (!session) return;
    const t = window.setTimeout(() => {
      applyTtl(deriveTtlSeconds(session.expires_at, clockOffsetRef.current));
    }, 1000);
    return () => window.clearTimeout(t);
  }, [phase, ttlLeft, session]);

  // ui#85: re-sync the countdown the instant the tab regains focus or
  // visibility. Background tabs throttle setTimeout, so without this the
  // display would sit stale until the next (delayed) tick; recomputing
  // from `expires_at` on return makes it jump straight to the true
  // remaining time (and triggers the TTL=0 auto-clear if it lapsed while
  // hidden).
  useEffect(() => {
    if (phase !== 'shown' || !session) return;
    const resync = () => {
      if (document.visibilityState === 'hidden') return;
      applyTtl(deriveTtlSeconds(session.expires_at, clockOffsetRef.current));
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
  }, [phase, session]);

  // --- best-effort plaintext hygiene on unmount ----------------------
  //
  // useRef carries the live session id past the unmount tick so the
  // cleanup can POST /expire?reason=unmount without holding the
  // navigation. Browser GCs the value strings on its own schedule but
  // we drop the refs immediately.
  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = session?.session_id ?? null;
  }, [session]);
  useEffect(() => {
    return () => {
      const sid = sessionIdRef.current;
      if (sid) {
        expireSessionUnmount(sid);
      }
      void clearCopiedSecret();
      // Drop refs so the GC isn't blocked on this component's closure.
      setRows([]);
      setSession(null);
    };
  }, []);

  const hideNow = async () => {
    if (!session) return;
    try {
      await expireSession.mutateAsync({
        sessionId: session.session_id,
        body: { reason: 'user_hide' },
      });
    } catch {
      /* best-effort — the timer will catch it anyway */
    }
    setRows((prev) => prev.map((r) => ({ ...r, value: '' })));
    setPhase('expired');
    void clearCopiedSecret();
  };

  if (!projectId || !envId || !requestId) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <PageHeader title="Reveal" />
        <Card>
          <CardBody>
            <p className="text-bad text-sm">
              Missing route parameters. Go back to{' '}
              <Link to="/projects" className="text-accent underline">
                My Projects
              </Link>{' '}
              and try again.
            </p>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <PageHeader
        title="Reveal secrets"
        description={`${projectName} · ${env?.name ?? envId}${env?.kind === 'prod' ? ' · prod environment' : ''}`}
        actions={
          phase === 'shown' ? (
            <div className="flex items-center gap-3">
              <CountdownChip seconds={ttlLeft} />
              <Button variant="ghost" size="md" onClick={hideNow}>
                Hide now
              </Button>
            </div>
          ) : phase === 'expired' ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => navigate(`/projects/${projectId}/env/${envId}`)}
            >
              Back to environment
            </Button>
          ) : null
        }
      />

      <div className="bg-warn-bg border border-warn-line border-l-4 border-l-warn rounded-md px-4 py-3 text-sm">
        <div className="text-warn font-semibold">
          These secrets are visible for a limited time.
        </div>
        <div className="text-muted text-xs mt-1">
          Do not screenshot, paste into chat, or forward outside the trusted
          systems they were issued for. The values auto-clear from this tab
          when the countdown hits 0, and the underlying wraps are invalidated
          server-side at the same moment. A copied value is cleared from your
          clipboard after 60 seconds, on Hide now, at 0 or when you leave this
          page.
        </div>
      </div>

      {(phase === 'preparing' ||
        phase === 'opening' ||
        phase === 'waiting' ||
        phase === 'fetching') && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-3 py-2">
              <span className="w-2.5 h-2.5 rounded-sm bg-accent animate-pulse" />
              <span className="text-ink text-sm">
                {phase === 'preparing' || phase === 'waiting'
                  ? 'Waiting for the agent to fetch the wraps…'
                  : phase === 'opening'
                  ? 'Opening reveal session…'
                  : 'Decrypting through KMS…'}
              </span>
            </div>
          </CardBody>
        </Card>
      )}

      {phase === 'error' && (
        <Card>
          <CardBody>
            <div className="text-bad text-sm whitespace-pre-wrap">
              {error ?? 'Reveal failed.'}
            </div>
            <div className="mt-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => navigate(`/projects/${projectId}/env/${envId}`)}
              >
                Back to environment
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {(phase === 'shown' || phase === 'expired') && (
        <Card>
          <CardHeader>
            <div className="text-ink font-semibold text-sm">
              {rows.length} key{rows.length === 1 ? '' : 's'} revealed
            </div>
          </CardHeader>
          <CardBody className="space-y-2">
            {rows.length === 0 && (
              <p className="text-muted text-sm">
                No wraps came back. The request may have already been
                consumed.
              </p>
            )}
            {rows.map((row) => (
              <SecretRow key={row.wrap_id} row={row} expired={phase === 'expired'} />
            ))}

            {phase === 'expired' && (
              <div className="bg-bg/40 border border-border rounded-md px-4 py-3 mt-3 text-sm">
                <div className="text-ink font-semibold">
                  Reveal session expired.
                </div>
                <div className="text-muted text-xs mt-1">
                  Every value has been cleared from this tab and invalidated
                  server-side. To view these secrets again, submit a new
                  request.
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function SecretRow({
  row,
  expired,
}: {
  row: RevealedRow;
  expired: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (expired) return;
    try {
      await copySecret(row.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bg-bg/40 border border-border/60 rounded-md px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-ink text-sm truncate">
            {row.key_name}
          </div>
          <div className="text-muted text-[11px] font-mono">
            {row.byte_length} bytes · sha256 {row.content_hash.slice(0, 12)}…
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCopy}
          disabled={expired || !row.value}
        >
          {expired ? 'Expired' : copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <textarea
        readOnly
        value={expired || !row.value ? '••••••••' : row.value}
        rows={2}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full bg-surface border border-edge rounded-md px-3 py-2 text-ink text-sm font-mono break-all focus:border-accent disabled:opacity-60"
        disabled={expired || !row.value}
      />
    </div>
  );
}

function CountdownChip({ seconds }: { seconds: number }) {
  const tone =
    seconds > 30
      ? 'bg-accent/15 text-accent border-accent/40'
      : seconds > 10
        ? 'bg-warn-bg text-warn border-warn-line'
        : 'bg-bad-bg text-bad border-bad-line';
  const mm = Math.max(0, Math.floor(seconds / 60));
  const ss = Math.max(0, seconds % 60);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-[11px] font-mono ${tone}`}
      title="Session TTL — values auto-clear when this hits 0"
    >
      <span className="w-1.5 h-1.5 rounded-sm bg-current animate-pulse" />
      {String(mm).padStart(2, '0')}:{String(ss).padStart(2, '0')}
    </span>
  );
}

// deriveTtlSeconds returns the whole seconds remaining until the server's
// `expires_at`, using the server-anchored clock (Date.now() + clockOffset).
// It always recomputes from the absolute timestamp — never decrements a
// local counter — so refresh, navigation, and tab-throttle can't drift it.
// Clamped at 0.
function deriveTtlSeconds(expiresAtISO: string, clockOffsetMs = 0): number {
  const t = Date.parse(expiresAtISO);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((t - (Date.now() + clockOffsetMs)) / 1000));
}

// computeClockOffset returns (serverNow − clientNow) in ms, derived from the
// reveal-session response's `opened_at` (the server's timestamp at session
// creation). Adding it to Date.now() yields a server-anchored "now", so a
// skewed client clock doesn't distort the countdown. No Date header / API
// change needed — the offset comes from a field already in the response.
// Falls back to 0 (plain client clock) when opened_at is missing/unparseable.
function computeClockOffset(openedAtISO: string): number {
  const serverNow = Date.parse(openedAtISO);
  if (Number.isNaN(serverNow)) return 0;
  return serverNow - Date.now();
}

// api#160: Open answers 503 {"error":"wrap_not_ready", "message": ...}
// while the agent hasn't produced the wraps. ApiError.message carries the
// `message` field, so match on the body's `error` code.
function isWrapNotReady(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 503) return false;
  const body = err.body as { error?: unknown } | undefined;
  return body?.error === 'wrap_not_ready';
}

function safeAtob(b64: string): string {
  try {
    return atob(b64);
  } catch {
    return '';
  }
}

// Binding and session refusals (api#201) get readable copy; anything
// else shows the api's own message with its status.
function formatErr(err: unknown): string {
  return describeRevealError(err, ' · ');
}
