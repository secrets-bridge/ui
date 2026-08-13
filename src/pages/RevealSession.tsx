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
 *   - Copy button uses navigator.clipboard.writeText only; we don't
 *     stash the value anywhere else.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useMe } from '../api/me';
import {
  expireSessionUnmount,
  useExpireRevealSession,
  useOpenRevealSession,
  type RevealSessionResponse,
} from '../api/revealSessions';
import { revealWrap } from '../api/requests';
import { useRequest } from '../api/requests';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';

type Phase = 'preparing' | 'opening' | 'fetching' | 'shown' | 'expired' | 'error';

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

  // userID is needed for the per-wrap single-shot fetch (stub auth
  // until OIDC + middleware-stashed identity land).
  const userId = me.data?.id ?? '';

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
  // returns 410. Poll the request every 2s while preparing.
  useEffect(() => {
    if (phase !== 'preparing') return;
    if (!request.data) return;
    const s = request.data.status;
    if (s === 'approved' || s === 'executed') {
      setPhase('opening');
      return;
    }
    if (s !== 'pending') {
      // cancelled / rejected / failed / expired — surface and stop.
      setPhase('error');
      setError(`Request status is ${s}; cannot reveal.`);
    }
  }, [phase, request.data]);

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
        // 410 → wraps may not have landed yet; back off a tick and
        // let the request poller re-arm.
        if (err instanceof ApiError && err.status === 410) {
          setPhase('preparing');
          window.setTimeout(() => {
            // Force a refetch of the request which retriggers step 1.
            void request.refetch();
          }, 2000);
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

  // --- step 3: fetch each wrap's plaintext ---------------------------
  useEffect(() => {
    if (phase !== 'fetching') return;
    if (!session || !userId) return;
    let cancelled = false;
    (async () => {
      const fetched: RevealedRow[] = [];
      const errs: string[] = [];
      for (const w of session.wraps) {
        try {
          const r = await revealWrap(requestId, w.wrap_id, userId);
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
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session, userId, requestId]);

  // --- countdown (drives TTL=0 auto-clear) ---------------------------
  useEffect(() => {
    if (phase !== 'shown') return;
    if (!session) return;
    if (ttlLeft <= 0) {
      // Wipe every plaintext from state at TTL=0. Replace with empty
      // strings so React still renders the rows (with masked
      // placeholders) instead of unmounting + losing the audit trail.
      setRows((prev) =>
        prev.map((r) => ({ ...r, value: '' })),
      );
      setPhase('expired');
      return;
    }
    const t = window.setTimeout(() => {
      setTtlLeft(deriveTtlSeconds(session.expires_at, clockOffsetRef.current));
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
      setTtlLeft(deriveTtlSeconds(session.expires_at, clockOffsetRef.current));
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
  };

  if (!projectId || !envId || !requestId) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <PageHeader title="Reveal" />
        <Card>
          <CardBody>
            <p className="text-red-300 text-sm">
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

      <div className="bg-yellow-400/10 border border-yellow-400/40 border-l-4 border-l-yellow-400 rounded-lg px-4 py-3 text-sm">
        <div className="text-yellow-300 font-semibold">
          These secrets are visible for a limited time.
        </div>
        <div className="text-muted text-xs mt-1">
          Do not screenshot, paste into chat, or forward outside the trusted
          systems they were issued for. The values auto-clear from this tab
          when the countdown hits 0, and the underlying wraps are invalidated
          server-side at the same moment.
        </div>
      </div>

      {(phase === 'preparing' || phase === 'opening' || phase === 'fetching') && (
        <Card>
          <CardBody>
            <div className="flex items-center gap-3 py-2">
              <span className="w-2.5 h-2.5 rounded-full bg-accent animate-pulse" />
              <span className="text-text text-sm">
                {phase === 'preparing'
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
            <div className="text-red-300 text-sm whitespace-pre-wrap">
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
            <div className="text-text font-semibold text-sm">
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
              <div className="bg-bg/40 border border-border rounded-lg px-4 py-3 mt-3 text-sm">
                <div className="text-text font-semibold">
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
      await navigator.clipboard.writeText(row.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="bg-bg/40 border border-border/60 rounded-lg px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-text text-sm truncate">
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
        className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono break-all focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-60"
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
        ? 'bg-yellow-400/15 text-yellow-300 border-yellow-400/40'
        : 'bg-red-500/15 text-red-300 border-red-500/40';
  const mm = Math.max(0, Math.floor(seconds / 60));
  const ss = Math.max(0, seconds % 60);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono ${tone}`}
      title="Session TTL — values auto-clear when this hits 0"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
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

function safeAtob(b64: string): string {
  try {
    return atob(b64);
  } catch {
    return '';
  }
}

function formatErr(err: unknown): string {
  if (err instanceof ApiError) return `${err.status} · ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
