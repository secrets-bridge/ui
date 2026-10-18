/**
 * The approved-read reveal, inline on the request page (handoff, Reveal
 * flow):
 *
 * 1. Intent. "Reveal values…" shows only to the requester while the
 *    reveal is ready, with the deadline. Nothing starts on page load,
 *    refresh or navigation.
 * 2. Step-up. The click asks for the authentication code first. Closing
 *    that dialog retrieves nothing and leaves the reveal ready. The
 *    server checks the code.
 * 3. Retrieve. A reveal session is opened (the server sets the viewing
 *    window) and each value is fetched once. Values live in this
 *    component's memory only: no storage, URL, query cache, logs or
 *    error reports.
 * 4. View. Each key with its value, its own Copy button, the time left
 *    and Hide now.
 * 5. Clear. Hide now, the deadline, leaving the page and unmounting all
 *    drop the values and end the session; focus moves to the state
 *    heading, which then says the reveal was consumed.
 *
 * The countdown follows the server's `expires_at`, corrected for clock
 * skew with the session's `opened_at`, and resyncs when the tab comes
 * back into view.
 */

import { useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { revealWrap } from '../../api/requests';
import { describeRevealError } from '../../api/revealErrors';
import { expireRevealSession, openRevealSession, type RevealSessionResponse } from '../../api/revealSessions';
import type { AccessRequest } from '../../api/types';
import { requestStepUp } from '../../auth/stepUp';
import { decodeSecret } from '../../lib/decodeSecret';
import { requestRef } from '../../lib/requestRef';
import { clearCopiedSecret, copySecret } from '../../lib/secretClipboard';
import { formatExact, formatRemaining } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { InfoIcon } from '../../ui/icons';
import { RevealPanel, type RevealedValue } from '../../ui/RevealPanel';

type Phase = 'idle' | 'confirming' | 'opening' | 'fetching' | 'viewing';

interface Props {
  request: AccessRequest;
  /** Deadline of the ready reveal, from the wrap summaries. */
  deadline: string;
  now: number;
  /** True from the moment values may be on screen until they are gone. */
  onActiveChange: (active: boolean) => void;
  /** The reveal ended (hidden, timed out or refused as already used). */
  onFinished: () => void;
}

export function Reveal({ request: r, deadline, now, onActiveChange, onFinished }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<{ title: string; text: string } | null>(null);
  const [values, setValues] = useState<RevealedValue[]>([]);
  const [session, setSession] = useState<RevealSessionResponse | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [announce, setAnnounce] = useState('');
  const sessionId = useRef<string | null>(null);
  const clockOffset = useRef(0);
  const mounted = useRef(true);
  const revealButton = useRef<HTMLButtonElement>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);

  // Leaving the page (or anything else that unmounts this) ends the
  // session and drops the values with the component.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (sessionId.current) expireRevealSession(sessionId.current, 'unmount');
      sessionId.current = null;
      void clearCopiedSecret();
    };
  }, []);

  const left = (s: RevealSessionResponse) =>
    Math.max(0, Math.round((Date.parse(s.expires_at) - (Date.now() + clockOffset.current)) / 1000));

  const finish = (reason: 'hide' | 'timeout' | 'gone') => {
    if (reason === 'hide' && sessionId.current) expireRevealSession(sessionId.current, 'user_hide');
    sessionId.current = null;
    setValues([]);
    setSession(null);
    setPhase('idle');
    void clearCopiedSecret();
    onActiveChange(false);
    onFinished();
  };

  // Countdown, from the server's deadline. At 0 the values are dropped.
  useEffect(() => {
    if (phase !== 'viewing' || !session) return;
    const tick = () => {
      const s = left(session);
      setSecondsLeft(s);
      if (s === 10) setAnnounce('10 seconds left before the values are hidden.');
      if (s <= 0) finish('timeout');
    };
    const t = window.setInterval(tick, 1000);
    const resync = () => {
      if (document.visibilityState !== 'hidden') tick();
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', resync);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', resync);
    };
    // finish and left only read refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session]);

  // Move focus to the panel heading once the values are on screen.
  useEffect(() => {
    if (phase === 'viewing') panelHeading.current?.focus();
  }, [phase]);

  const start = async () => {
    setError(null);
    setPhase('confirming');
    const outcome = await requestStepUp('reveal');
    if (!mounted.current) return;
    if (outcome !== 'verified') {
      setPhase('idle');
      revealButton.current?.focus();
      return;
    }

    setPhase('opening');
    onActiveChange(true);
    let s: RevealSessionResponse;
    try {
      s = await openRevealSession(r.id);
    } catch (err) {
      if (!mounted.current) return;
      const e = openError(err);
      setError(e);
      setPhase('idle');
      onActiveChange(false);
      if (err instanceof ApiError && err.status === 410) onFinished();
      return;
    }
    if (!mounted.current) {
      expireRevealSession(s.session_id, 'unmount');
      return;
    }
    sessionId.current = s.session_id;
    clockOffset.current = Date.parse(s.opened_at) - Date.now() || 0;
    setPhase('fetching');

    // One value at a time; each fetch consumes that value on the server.
    const out: RevealedValue[] = [];
    for (const w of s.wraps) {
      const key = w.key_name || 'value';
      try {
        const got = await revealWrap(r.id, w.wrap_id);
        out.push({ key: got.key_name || key, value: decodeSecret(got.value) });
      } catch (err) {
        out.push({ key, value: { kind: 'text', text: '' }, error: `Couldn't fetch this value. ${describeRevealError(err)}` });
      }
      if (!mounted.current) return;
    }
    setSession(s);
    setSecondsLeft(left(s));
    setValues(out);
    setPhase(left(s) > 0 ? 'viewing' : 'idle');
    if (left(s) <= 0) finish('timeout');
  };

  const copy = async (key: string) => {
    const v = values.find((x) => x.key === key);
    if (!v || v.error) return;
    try {
      await copySecret(v.value.kind === 'text' ? v.value.text : v.value.base64);
    } catch {
      return;
    }
    setValues((prev) => prev.map((x) => ({ ...x, copied: x.key === key })));
    window.setTimeout(() => {
      if (mounted.current) setValues((prev) => prev.map((x) => (x.key === key ? { ...x, copied: false } : x)));
    }, 2500);
  };

  if (phase === 'viewing' && session) {
    return (
      <div className="px-5 py-[18px]">
        <h2 id="state-heading" ref={panelHeading} tabIndex={-1} className="text-[17px] font-semibold leading-[22px] text-ink">
          Values revealed
        </h2>
        <p className="mb-4 mt-1.5 max-w-[68ch] text-body text-muted">
          This reveal is now consumed. Copy what you need, then hide. The values disappear when the timer ends or you
          leave this page.
        </p>
        <RevealPanel
          reference={requestRef(r.id)}
          values={values}
          secondsLeft={secondsLeft}
          totalSeconds={session.ttl_seconds}
          onCopy={(k) => void copy(k)}
          onHide={() => finish('hide')}
        />
        <p className="mt-4 flex items-start gap-2 rounded-md border border-border bg-sunken px-3.5 py-3 text-ui font-normal">
          <InfoIcon size={16} className="mt-px text-muted" />
          Copying is explicit. Don't rely on the clipboard being cleared.
        </p>
        <p role="status" className="sr-only">
          {announce}
        </p>
      </div>
    );
  }

  const busy = phase !== 'idle';
  return (
    <div className="px-5 py-[18px]">
      <h2 id="state-heading" tabIndex={-1} className="text-[17px] font-semibold leading-[22px] text-ink">
        Values are ready to reveal
      </h2>
      <p className="mt-1.5 max-w-[68ch] text-body text-muted">
        You can reveal them once, until {formatExact(deadline)} ({formatRemaining(deadline, now)}). Revealing
        retrieves the values once.
      </p>
      {error && (
        <Banner tone="error" title={error.title} className="mt-4">
          {error.text}
        </Banner>
      )}
      <div className="mt-4 flex flex-wrap gap-2.5 max-[600px]:[&>button]:flex-1">
        <Button ref={revealButton} variant="primary" onClick={() => void start()} disabled={busy} aria-busy={busy}>
          {phase === 'confirming'
            ? 'Waiting for your code…'
            : phase === 'opening' || phase === 'fetching'
              ? 'Retrieving the values…'
              : 'Reveal values…'}
        </Button>
      </div>
      <p className="mt-3 text-caption text-muted">You confirm with your authentication code first.</p>
    </div>
  );
}

function openError(err: unknown): { title: string; text: string } {
  if (err instanceof ApiError) {
    const code = (err.body as { error?: unknown } | undefined)?.error;
    if (err.status === 503 && code === 'wrap_not_ready')
      return { title: "The values aren't ready yet.", text: "The agent hasn't stored them yet. Try again in a moment." };
    if (err.status === 410)
      return { title: 'Nothing to reveal.', text: 'These values were already revealed or have expired. Nothing was shown.' };
    if (err.status === 429)
      return { title: 'Too many reveal attempts.', text: 'Wait a minute, then try again. Nothing was retrieved.' };
    if (err.status === 401)
      return { title: "Your code wasn't confirmed.", text: 'Nothing was retrieved. Try again.' };
    return { title: 'Nothing was retrieved.', text: describeRevealError(err) };
  }
  return { title: 'Nothing was retrieved.', text: err instanceof Error ? err.message : String(err) };
}
