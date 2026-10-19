/**
 * Adding a second factor: the two enrollment drawers.
 *
 * Used from the Second factor page (`/me/mfa`) and from the step-up
 * modal, which opens them over the current page when an action needs a
 * second factor and the account has none. The page underneath stays
 * mounted, so a half-filled form keeps what was typed.
 *
 * `onEnrolled` gets the saved factor; without it, success closes the
 * drawer like Cancel does.
 */

import { useState } from 'react';

import { QRCodeSVG } from 'qrcode.react';

import { ApiError } from '../api/client';
import {
  type MFAFactor,
  type TOTPEnrollResponse,
  useConfirmTOTP,
  useEnrollTOTP,
  useWebAuthnRegisterFinish,
  useWebAuthnRegisterStart,
} from '../api/mfa';
import { attestationResponseToJSON, toCreationOptions } from '../api/webauthn';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { Field, Input } from '../ui/Field';

interface EnrollProps {
  onClose: () => void;
  onEnrolled?: (factor: MFAFactor) => void;
}

// --- TOTP enrollment drawer -----------------------------------------

export function TOTPEnrollDrawer({ onClose, onEnrolled }: EnrollProps) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<TOTPEnrollResponse | null>(null);
  // Set after a wrong code: the api spends the enrollment challenge on
  // any attempt, so a new code to scan is issued straight away.
  const [restarted, setRestarted] = useState(false);

  const enroll = useEnrollTOTP();
  const confirm = useConfirmTOTP();

  const labelTrim = label.trim();
  const codeTrim = code.trim();

  const startEnroll = async () => {
    if (!labelTrim) return;
    setChallenge(null);
    setCode('');
    try {
      const out = await enroll.mutateAsync({ label: labelTrim });
      // The drawer renders from `challenge`; drop the cache's copy of
      // the seed now (UI-N-02).
      enroll.reset();
      setChallenge(out);
    } catch {
      // Shown from enroll.error below.
    }
  };

  const submitCode = async () => {
    if (!challenge || codeTrim.length !== 6) return;
    try {
      const factor = await confirm.mutateAsync({ challenge_id: challenge.challenge_id, code: codeTrim });
      confirm.reset();
      setChallenge(null);
      if (onEnrolled) onEnrolled(factor);
      else onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 410)) {
        confirm.reset();
        setRestarted(true);
        await startEnroll();
      }
    }
  };

  return (
    <Drawer
      title="Add authenticator app"
      subtitle="Any app that shows 6-digit codes works, such as 1Password, Bitwarden or Google Authenticator."
      onClose={onClose}
      footer={
        challenge ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={confirm.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void submitCode()}
              disabled={codeTrim.length !== 6 || confirm.isPending || enroll.isPending}
              aria-busy={confirm.isPending}
            >
              {confirm.isPending ? 'Checking…' : 'Add app'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={enroll.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void startEnroll()}
              disabled={!labelTrim || enroll.isPending}
              aria-busy={enroll.isPending}
            >
              {enroll.isPending ? 'Preparing…' : 'Show the code to scan'}
            </Button>
          </>
        )
      }
    >
      {!challenge && (
        <div className="flex flex-col gap-4">
          <Field id="totp-label" label="Name" hint="How this app shows in your list, so you can tell your factors apart.">
            {(p) => (
              <Input
                {...p}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Phone, password manager"
                autoFocus
                maxLength={64}
                className="w-full"
              />
            )}
          </Field>
          {enroll.isError && <ErrorBanner err={enroll.error} />}
        </div>
      )}

      {challenge && (
        <div className="flex flex-col gap-5">
          {restarted && (
            <Banner tone="error" title="That code wasn't accepted.">
              The code to scan has changed. Remove the entry you just added in your app, scan this new one and type
              its code.
            </Banner>
          )}
          <section>
            <h3 className="mb-2 text-body font-semibold text-ink">1. Scan this with your app</h3>
            <div className="flex flex-col items-center gap-4 rounded-md border border-border px-5 py-5">
              <div className="rounded-md bg-white p-3">
                <QRCodeSVG value={challenge.provisioning_uri} size={192} level="M" marginSize={0} />
              </div>
              <details className="w-full text-caption text-muted">
                <summary className="cursor-pointer hover:text-ink">Can't scan? Type the setup key instead</summary>
                <code className="mt-3 block select-all break-all rounded-sm border border-dashed border-edge bg-sunken px-3 py-2 font-mono text-mono text-ink">
                  {challenge.secret_base32}
                </code>
                <p className="mt-2">Time-based, 6 digits, 30-second period, SHA-1.</p>
              </details>
            </div>
          </section>
          <Field id="totp-code" label="2. Type the 6-digit code your app shows" hint="The code changes every 30 seconds.">
            {(p) => (
              <Input
                {...p}
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                className="w-40 font-mono tracking-[0.3em]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCode();
                }}
              />
            )}
          </Field>
          {confirm.isError && <ErrorBanner err={confirm.error} />}
        </div>
      )}
    </Drawer>
  );
}

// --- WebAuthn enrollment drawer -------------------------------------

export function WebAuthnEnrollDrawer({ onClose, onEnrolled }: EnrollProps) {
  const [label, setLabel] = useState('');
  const [stage, setStage] = useState<'label' | 'browser' | 'done'>('label');
  const [browserError, setBrowserError] = useState<string | null>(null);

  const start = useWebAuthnRegisterStart();
  const finish = useWebAuthnRegisterFinish();

  const labelTrim = label.trim();

  const run = async () => {
    if (!labelTrim) return;
    setBrowserError(null);
    start.reset();
    finish.reset();
    setStage('browser');
    try {
      const challenge = await start.mutateAsync({ label: labelTrim });
      const opts = toCreationOptions(challenge.options);
      const cred = (await navigator.credentials.create({
        publicKey: opts,
      })) as PublicKeyCredential | null;
      if (!cred) {
        throw new Error('No credential returned by the authenticator');
      }
      const response = attestationResponseToJSON(cred);
      const factor = await finish.mutateAsync({
        challenge_id: challenge.challenge_id,
        response,
      });
      setStage('done');
      if (onEnrolled) onEnrolled(factor);
      else onClose();
    } catch (err) {
      // DOMException is what the browser throws on user-abort,
      // already-registered, NotAllowed, etc. Surface a friendly
      // message; the precise DOMException name is the detail.
      if (err instanceof DOMException) {
        setBrowserError(
          `${err.name}: ${err.message || 'no further detail from the browser'}`
        );
      } else if (err instanceof Error) {
        setBrowserError(err.message);
      } else {
        setBrowserError(String(err));
      }
      setStage('label');
    }
  };

  const inFlight = start.isPending || finish.isPending || stage === 'browser';

  return (
    <Drawer
      title="Add security key / passkey"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={inFlight}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={run}
            disabled={!labelTrim || inFlight}
            aria-busy={inFlight}
          >
            {inFlight ? 'Waiting for your key…' : 'Add security key'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field id="webauthn-label" label="Name" hint="How this key shows in your list, so you can tell your factors apart.">
          {(p) => (
            <Input
              {...p}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Hardware key, laptop fingerprint"
              autoFocus
              disabled={inFlight}
              maxLength={64}
              className="w-full"
            />
          )}
        </Field>

        <div className="rounded-md border border-border bg-sunken px-3.5 py-3 text-ui font-normal">
          <p className="font-semibold text-ink">What happens next</p>
          <ol className="mt-1 list-inside list-decimal text-muted">
            <li>Your browser asks you to choose a security key or passkey.</li>
            <li>Tap the key, or use your fingerprint or face.</li>
            <li>The key is added once the browser confirms it.</li>
          </ol>
          <p className="mt-1.5 text-caption text-muted">A key you already added can't be added twice.</p>
        </div>

        {browserError && (
          <Banner tone="error" title="The authenticator didn't confirm.">
            {browserError}
          </Banner>
        )}
        {start.isError && <ErrorBanner err={start.error} />}
        {finish.isError && <ErrorBanner err={finish.error} />}
      </div>
    </Drawer>
  );
}

// --- shared bits ----------------------------------------------------

function ErrorBanner({ err }: { err: unknown }) {
  if (err instanceof ApiError && err.status === 409) {
    return (
      <Banner tone="error" title="That name is taken.">
        Each of your factors needs its own name.
      </Banner>
    );
  }
  return (
    <Banner tone="error" title={err instanceof ApiError ? `${err.status} · it didn't work` : 'Network error'}>
      {err instanceof Error ? err.message : String(err)}
    </Banner>
  );
}
