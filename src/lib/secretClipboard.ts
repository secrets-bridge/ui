/**
 * Clipboard copy for secret values (UI-N-03). Every surface that copies
 * a revealed value, an agent secret or a snippet containing one goes
 * through here.
 *
 * `copySecret` writes the value and remembers a SHA-256 fingerprint of
 * it (never the value itself, so the plaintext doesn't outlive the page
 * that showed it). `clearCopiedSecret` empties the clipboard only while
 * it still holds exactly that value: read, compare, then write ''.
 * Whatever the user copied afterwards is left alone.
 *
 * A clear runs:
 *   - on a timer, 60s after the copy by default;
 *   - when the page calls `clearCopiedSecret()` (Hide now, TTL expiry);
 *   - when a reveal surface unmounts (`useClearCopiedSecretOnUnmount`);
 *   - on session expiry, before the hard navigation to /login.
 *
 * Chromium rejects clipboard reads and writes from a document that
 * doesn't have focus, and that's the usual state when the timer fires
 * (the user went off to paste somewhere). A clear that comes due while
 * the tab is unfocused or hidden waits for the next `focus` /
 * `visibilitychange` and runs then.
 *
 * If the read is refused while the tab IS focused (permission denied,
 * or a browser that only allows reads from a user gesture), nothing is
 * cleared: without the read we can't tell our value from the user's
 * own clipboard, so we don't blind-clear. Changing that is an owner
 * decision.
 *
 * Never logs the value or the clipboard contents.
 */

import { useEffect } from 'react';

export const SECRET_CLIPBOARD_CLEAR_MS = 60_000;

interface CopiedSecret {
  length: number;
  digest: Promise<string | null>;
  timer: number | undefined;
}

let copied: CopiedSecret | null = null;
let stopWaitingForFocus: (() => void) | null = null;

export async function copySecret(
  value: string,
  opts: { clearAfterMs?: number } = {},
): Promise<void> {
  await navigator.clipboard.writeText(value);
  // The clipboard now holds this value, so an earlier copy can't be in
  // it any more; track only the latest one.
  forget();
  const entry: CopiedSecret = {
    length: value.length,
    digest: fingerprint(value),
    timer: undefined,
  };
  entry.timer = window.setTimeout(() => {
    entry.timer = undefined;
    void clearCopiedSecret();
  }, opts.clearAfterMs ?? SECRET_CLIPBOARD_CLEAR_MS);
  copied = entry;
}

export async function clearCopiedSecret(): Promise<void> {
  const entry = copied;
  if (!entry) return;
  if (entry.timer !== undefined) {
    window.clearTimeout(entry.timer);
    entry.timer = undefined;
  }
  if (!canTouchClipboard()) {
    waitForFocus();
    return;
  }

  let current: string;
  try {
    current = await navigator.clipboard.readText();
  } catch {
    if (!canTouchClipboard()) {
      waitForFocus();
      return;
    }
    // Refused while focused: no blind clear (see the header).
    forget(entry);
    return;
  }

  const expected = await entry.digest;
  const same =
    expected !== null &&
    current.length === entry.length &&
    (await fingerprint(current)) === expected;
  // A newer copy may have replaced this one while we were reading.
  if (copied !== entry) return;
  if (!same) {
    forget(entry);
    return;
  }

  try {
    await navigator.clipboard.writeText('');
    forget(entry);
  } catch {
    if (!canTouchClipboard()) {
      waitForFocus();
      return;
    }
    forget(entry);
  }
}

/** Clears a still-copied secret when the calling component unmounts. */
export function useClearCopiedSecretOnUnmount(): void {
  useEffect(
    () => () => {
      void clearCopiedSecret();
    },
    [],
  );
}

function canTouchClipboard(): boolean {
  return document.visibilityState !== 'hidden' && document.hasFocus();
}

function waitForFocus(): void {
  if (stopWaitingForFocus) return;
  const retry = () => {
    if (!canTouchClipboard()) return;
    stop();
    void clearCopiedSecret();
  };
  const stop = () => {
    window.removeEventListener('focus', retry);
    document.removeEventListener('visibilitychange', retry);
    stopWaitingForFocus = null;
  };
  window.addEventListener('focus', retry);
  document.addEventListener('visibilitychange', retry);
  stopWaitingForFocus = stop;
}

function forget(entry?: CopiedSecret): void {
  if (entry && copied !== entry) return;
  if (copied?.timer !== undefined) {
    window.clearTimeout(copied.timer);
  }
  copied = null;
  stopWaitingForFocus?.();
}

function fingerprint(text: string): Promise<string | null> {
  try {
    return crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(text))
      .then(
        (buf) =>
          Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join(''),
        () => null,
      );
  } catch {
    return Promise.resolve(null);
  }
}
