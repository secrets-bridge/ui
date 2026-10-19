/**
 * Step-up modal (Slice I2). Catches the api's 401 step_up_required
 * response and drives the user through `/auth/mfa/{challenge,verify}`
 * directly. Replaces the Slice D fallback path that bounced through
 * `/auth/oidc/start?step_up=mfa` (which only worked for IdPs whose
 * `amr` claim could be coerced — Authentik and similar can't).
 *
 * Flow:
 *
 *   Tier-2 op → 401 step_up_required
 *     → client.ts calls requestStepUp() (the reveal calls it up front)
 *     → this provider registers a handler that opens the modal
 *     → user picks TOTP or security key (filtered by what they have)
 *     → POST /auth/mfa/challenge {kind}
 *     → TOTP: user types code | WebAuthn: navigator.credentials.get()
 *     → POST /auth/mfa/verify {challenge_id, code | response}
 *     → 204 = MFA-fresh; close modal, user re-clicks the original button
 *
 *   Tier-2 op from an account with no factor → 412 mfa_enrollment_required
 *     → client.ts calls requestStepUp() the same way
 *     → the modal asks the user to add a factor and opens the enrollment
 *       drawer over the current page. The page stays mounted, so a
 *       half-filled form keeps what was typed (it used to navigate to
 *       /me/mfa and lose it).
 *     → once the factor is added, the user confirms with it and the
 *       original request retries
 *
 * Error cases the modal handles directly:
 *
 *   400 verification failed and
 *   410 challenge expired         → ask for a fresh challenge (each
 *                                   one is single-shot) and let the
 *                                   user type the code again
 *   412 mfa_enrollment_required   → ask the user to add a factor
 *   412 mfa_kind_not_enrolled     → hint to switch factor
 *   401 factor_compromised        → hard-navigate to /login (sessions
 *                                   were revoked server-side)
 *
 * Hard rule kept: the modal NEVER sends the user_id; the api derives
 * it from the cookie. The challenge_id + factor_id round-trip are
 * the only state the SPA carries between calls.
 */

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { ApiError } from '../api/client';
import { mfaKey, useMFAChallenge, useMFAFactors, useMFAVerify } from '../api/mfa';
import type { MFAFactor, MFAFactorKind } from '../api/mfa';
import { assertionResponseToJSON, canUseWebAuthn, toRequestOptions } from '../api/webauthn';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input, Select } from '../ui/Field';
import { useAuth } from './AuthContext';
import { TOTPEnrollDrawer, WebAuthnEnrollDrawer } from './FactorEnroll';
import {
  resolveStepUp,
  setCompromisedHandler,
  setStepUpHandler,
  type StepUpPurpose,
} from './stepUp';

type Stage = 'picker' | 'totp' | 'webauthn' | 'enroll' | 'enroll-totp' | 'enroll-webauthn';

export function StepUpModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState<StepUpPurpose | null>(null);
  const { logout } = useAuth();

  // Closing the modal MUST resolve the pending step-up promise so
  // client.ts can decide whether to retry (verified) or throw the
  // original 401 (cancelled). The outcome distinguishes the two —
  // every exit path in the modal passes the right value.
  const close = useCallback((outcome: 'verified' | 'cancelled') => {
    resolveStepUp(outcome);
    setOpen(null);
  }, []);

  useEffect(() => {
    setStepUpHandler((purpose) => setOpen(purpose));
    setCompromisedHandler(() => {
      // Sign-count regression on a WebAuthn factor. The api's verify
      // service revoked every session for the user before returning
      // 401 factor_compromised. Hard-navigate so React state can't
      // leak past the auth boundary.
      void logout().catch(() => undefined);
      window.location.assign('/login');
    });
    return () => {
      setStepUpHandler(null);
      setCompromisedHandler(null);
    };
  }, [logout]);

  return (
    <>
      {children}
      {open && (
        <StepUpModal
          purpose={open}
          onCancel={() => close('cancelled')}
          onVerified={() => close('verified')}
        />
      )}
    </>
  );
}

// --- modal ----------------------------------------------------------

function StepUpModal({
  purpose,
  onCancel,
  onVerified,
}: {
  purpose: StepUpPurpose;
  onCancel: () => void;
  onVerified: () => void;
}) {
  const qc = useQueryClient();
  const factors = useMFAFactors();
  const [stage, setStage] = useState<Stage>('picker');
  const [pickedFactor, setPickedFactor] = useState<MFAFactor | null>(null);
  const [pickedKind, setPickedKind] = useState<MFAFactorKind | null>(null);
  // Set once the user adds a factor here, for the wording of the
  // confirm step that follows.
  const [added, setAdded] = useState(false);

  const start = useCallback(
    (kind: MFAFactorKind, factor?: MFAFactor) => {
      setPickedKind(kind);
      setPickedFactor(factor ?? null);
      setStage(kind === 'totp' ? 'totp' : 'webauthn');
    },
    []
  );

  // With only an authenticator app enrolled there is nothing to pick:
  // go straight to the code. Adjusted during render, like the other
  // derived-state transitions in this codebase.
  const list = factors.data ?? [];
  const totpOnly =
    list.length > 0 && list.every((f) => f.kind === 'totp');
  if (stage === 'picker' && totpOnly) {
    setPickedKind('totp');
    setPickedFactor(list[0]);
    setStage('totp');
  }

  // No factor yet: offer to add one here rather than leave the page,
  // which would drop whatever the user was in the middle of. Only on a
  // settled list, so a refetch in flight can't land here.
  if (stage === 'picker' && factors.data && list.length === 0 && !factors.isFetching) {
    setStage('enroll');
  }

  // The api says there is no factor although the list showed one (it
  // was removed in another tab): refresh the list and offer to add one.
  const noFactor = useCallback(() => {
    void qc.invalidateQueries({ queryKey: mfaKey.factors });
    setStage('enroll');
  }, [qc]);

  // Enrolling doesn't verify the session, so the new factor is used
  // once more. The list must include it before that step reads it.
  const afterEnroll = async (factor: MFAFactor) => {
    const refreshed = qc.refetchQueries({ queryKey: mfaKey.factors });
    setAdded(true);
    setStage('picker');
    await refreshed;
    start(factor.kind, factor);
  };

  if (stage === 'enroll-totp') {
    return <TOTPEnrollDrawer onClose={() => setStage('enroll')} onEnrolled={(f) => void afterEnroll(f)} />;
  }
  if (stage === 'enroll-webauthn') {
    return <WebAuthnEnrollDrawer onClose={() => setStage('enroll')} onEnrolled={(f) => void afterEnroll(f)} />;
  }
  if (stage === 'enroll') {
    const webAuthn = canUseWebAuthn();
    return (
      <Dialog
        title="Add a second factor"
        onClose={onCancel}
        actions={
          <>
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStage('enroll-webauthn')}
              disabled={!webAuthn}
              title={webAuthn ? undefined : 'Security keys need HTTPS (or localhost) and a browser that supports WebAuthn.'}
            >
              Add security key…
            </Button>
            <Button variant="primary" onClick={() => setStage('enroll-totp')} data-autofocus>
              Add authenticator app…
            </Button>
          </>
        }
      >
        <p className="text-muted">
          {purpose === 'reveal'
            ? "Revealing needs a second factor, and your account doesn't have one yet. Add one now to carry on. Nothing is retrieved until you confirm with it."
            : "This needs a second factor, and your account doesn't have one yet. Add one now to carry on. Nothing you've entered on this page is lost."}
        </p>
      </Dialog>
    );
  }

  // Escape, the scrim and Cancel all close the dialog as a cancel.
  return (
    <Dialog
      title="Confirm it's you"
      onClose={onCancel}
      actions={
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      }
    >
      <p className="text-muted">
        {added
          ? purpose === 'reveal'
            ? 'Your second factor is added. Use it once more to reveal the values. Nothing is retrieved until you confirm.'
            : "Your second factor is added. Use it once more to finish. After that, you won't be asked again for 15 minutes."
          : purpose === 'reveal'
            ? 'Enter your authentication code to reveal the values. Nothing is retrieved until you confirm, and closing this retrieves nothing.'
            : "This action needs your second factor. After you confirm, you won't be asked again for 15 minutes."}
      </p>

      {stage === 'picker' && (
        <FactorPicker factors={list} loading={factors.isLoading || (list.length === 0 && factors.isFetching)} onPick={start} />
      )}
      {stage === 'totp' && (
        <TOTPVerify
          purpose={purpose}
          factors={list.filter((f) => f.kind === 'totp')}
          initialFactor={pickedFactor}
          canGoBack={!totpOnly}
          onBack={() => setStage('picker')}
          onSuccess={onVerified}
          onNoFactor={noFactor}
        />
      )}
      {stage === 'webauthn' && pickedKind === 'webauthn' && (
        <WebAuthnVerify onBack={() => setStage('picker')} onSuccess={onVerified} onNoFactor={noFactor} />
      )}
    </Dialog>
  );
}

// --- picker ---------------------------------------------------------

function FactorPicker({
  factors,
  loading,
  onPick,
}: {
  factors: MFAFactor[];
  loading: boolean;
  onPick: (kind: MFAFactorKind, factor?: MFAFactor) => void;
}) {
  if (loading) {
    return <p className="text-muted">Loading your factors…</p>;
  }
  const hasWebAuthn = factors.some((f) => f.kind === 'webauthn');
  const totpFactors = factors.filter((f) => f.kind === 'totp');
  return (
    <div className="space-y-2">
      {hasWebAuthn && (
        <button
          type="button"
          onClick={() => onPick('webauthn')}
          className="w-full rounded-md border border-edge bg-surface px-3.5 py-2.5 text-left hover:bg-sunken"
        >
          <div className="text-ui font-medium text-ink">Use a security key</div>
          <div className="mt-0.5 text-caption text-muted">
            A hardware key, Touch ID or Windows Hello, whichever you registered.
          </div>
        </button>
      )}
      {totpFactors.length > 0 && (
        <button
          type="button"
          onClick={() => onPick('totp', totpFactors[0])}
          className="w-full rounded-md border border-edge bg-surface px-3.5 py-2.5 text-left hover:bg-sunken"
        >
          <div className="text-ui font-medium text-ink">Use an authenticator app</div>
          <div className="mt-0.5 text-caption text-muted">
            {totpFactors.length === 1
              ? totpFactors[0].label
              : `${totpFactors.length} apps registered. Pick one on the next step.`}
          </div>
        </button>
      )}
    </div>
  );
}

// --- TOTP -----------------------------------------------------------

function TOTPVerify({
  purpose,
  factors,
  initialFactor,
  canGoBack,
  onBack,
  onSuccess,
  onNoFactor,
}: {
  purpose: StepUpPurpose;
  factors: MFAFactor[];
  initialFactor: MFAFactor | null;
  canGoBack: boolean;
  onBack: () => void;
  onSuccess: () => void;
  onNoFactor: () => void;
}) {
  const challenge = useMFAChallenge();
  const verify = useMFAVerify();
  const [factorId, setFactorId] = useState<string>(initialFactor?.id ?? factors[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [challengeID, setChallengeID] = useState<string | null>(null);

  // A challenge is single-shot: the api consumes it on every verify,
  // right or wrong. Ask for a fresh one up front and after each failed
  // attempt, so a mistyped code can simply be typed again.
  const newChallenge = async () => {
    try {
      const out = await challenge.mutateAsync({ kind: 'totp' });
      return out.challenge_id;
    } catch (err) {
      handleMFAEdgeCase(err, onNoFactor);
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;
    void newChallenge().then((id) => {
      if (!cancelled) setChallengeID(id);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const codeTrim = code.trim();
  const submit = async () => {
    if (!challengeID || codeTrim.length !== 6 || !factorId) return;
    try {
      await verify.mutateAsync({
        challenge_id: challengeID,
        factor_id: factorId,
        code: codeTrim,
      });
      // Drop the code from the MutationCache (UI-N-02). On failure the
      // banner reads `verify.error`, so the unmount reset covers that.
      verify.reset();
      onSuccess();
    } catch (err) {
      handleMFAEdgeCase(err, onNoFactor);
      setCode('');
      setChallengeID(null);
      setChallengeID(await newChallenge());
    }
  };

  return (
    <form
      className="flex flex-col gap-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {factors.length > 1 && (
        <Field id="stepup-factor" label="Authenticator app">
          {(p) => (
            <Select {...p} value={factorId} onChange={(e) => setFactorId(e.target.value)}>
              {factors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field id="stepup-code" label="Authentication code" hint="The 6-digit code from your authenticator app.">
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
            data-autofocus
            className="w-40 font-mono tracking-[0.3em]"
          />
        )}
      </Field>
      {(challenge.isError || verify.isError) && (
        <ErrorBanner err={challenge.error ?? verify.error} purpose={purpose} />
      )}
      <div className="flex items-center gap-2.5">
        <Button
          type="submit"
          variant="primary"
          disabled={!challengeID || codeTrim.length !== 6 || verify.isPending}
          aria-busy={verify.isPending}
        >
          {verify.isPending ? 'Checking…' : 'Confirm'}
        </Button>
        {canGoBack && (
          <Button variant="quiet" onClick={onBack}>
            Use another factor
          </Button>
        )}
      </div>
    </form>
  );
}

// --- WebAuthn -------------------------------------------------------

function WebAuthnVerify({
  onBack,
  onSuccess,
  onNoFactor,
}: {
  onBack: () => void;
  onSuccess: () => void;
  onNoFactor: () => void;
}) {
  const challenge = useMFAChallenge();
  const verify = useMFAVerify();
  const [browserError, setBrowserError] = useState<string | null>(null);
  // Starts true: the ceremony auto-starts on mount (effect below), so
  // the first render already shows the waiting state.
  const [inFlight, setInFlight] = useState(true);

  // The ceremony resolves to the error text to show (null on success)
  // and never sets state itself; `finish` applies the outcome from the
  // promise callback. That keeps the mount effect free of synchronous
  // setState (react-hooks/set-state-in-effect) without changing the
  // flow: auto-start on mount, "Try again" restarts it.
  const ceremony = async (): Promise<string | null> => {
    try {
      const out = await challenge.mutateAsync({ kind: 'webauthn' });
      if (!out.options) {
        throw new Error('Server returned no WebAuthn options');
      }
      const opts = toRequestOptions(out.options);
      const cred = (await navigator.credentials.get({
        publicKey: opts,
      })) as PublicKeyCredential | null;
      if (!cred) {
        throw new Error('No credential returned by the authenticator');
      }
      const response = assertionResponseToJSON(cred);
      await verify.mutateAsync({
        challenge_id: out.challenge_id,
        response,
      });
      onSuccess();
      return null;
    } catch (err) {
      if (err instanceof DOMException) {
        return `${err.name}: ${err.message || 'no further detail from the browser'}`;
      } else if (err instanceof ApiError) {
        handleMFAEdgeCase(err, onNoFactor);
        return `${err.status} · ${err.message}`;
      } else if (err instanceof Error) {
        return err.message;
      }
      return String(err);
    }
  };

  const finish = (error: string | null) => {
    // The error shows from `browserError`, so the mutation can go
    // either way (UI-N-02).
    verify.reset();
    setBrowserError(error);
    setInFlight(false);
  };

  const retry = () => {
    setBrowserError(null);
    setInFlight(true);
    void ceremony().then(finish);
  };

  // Auto-start the ceremony so the user just taps their key.
  useEffect(() => {
    void ceremony().then(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-3.5">
      <Banner title="Use your security key">
        Tap the key, or use Touch ID, Windows Hello or Face ID. The browser
        is waiting for it.
      </Banner>
      {browserError && (
        <Banner tone="error" title="The authenticator didn't confirm">
          {browserError}
        </Banner>
      )}
      <div className="flex items-center gap-2.5">
        <Button variant="primary" onClick={retry} disabled={inFlight} aria-busy={inFlight}>
          {inFlight ? 'Waiting for the key…' : 'Try again'}
        </Button>
        <Button variant="quiet" onClick={onBack} disabled={inFlight}>
          Use another factor
        </Button>
      </div>
    </div>
  );
}

// --- shared bits ----------------------------------------------------

function ErrorBanner({ err, purpose }: { err: unknown; purpose: StepUpPurpose }) {
  // A wrong or stale code is the common case: say so plainly. The
  // original action has not run yet, so nothing happened.
  if (err instanceof ApiError && (err.status === 400 || err.status === 410)) {
    return (
      <Banner tone="error" title="That code wasn't accepted.">
        {purpose === 'reveal' ? 'Nothing was retrieved.' : 'Nothing has happened yet.'} Check the code in your
        authenticator app and try again.
      </Banner>
    );
  }
  if (err instanceof ApiError && err.status === 429) {
    return (
      <Banner tone="error" title="Too many attempts.">
        Wait a few minutes before you try again.
      </Banner>
    );
  }
  return (
    <Banner tone="error" title={err instanceof ApiError ? `${err.status} · request failed` : 'Network error'}>
      {err instanceof Error ? err.message : String(err)}
    </Banner>
  );
}

/**
 * Centralises the 4 special MFA error codes the api can return from
 * /auth/mfa/* so each ceremony path doesn't reimplement the
 * routing. The 401 step_up_required case never reaches here — the
 * global interceptor handles it by opening this modal.
 */
function handleMFAEdgeCase(err: unknown, onNoFactor: () => void): void {
  if (!(err instanceof ApiError)) return;
  const msg = (err.message ?? '').toLowerCase();
  // 412 mfa_enrollment_required → no factors at all: offer to add one
  if (err.status === 412 && msg.includes('mfa_enrollment_required')) {
    onNoFactor();
    return;
  }
  // 412 mfa_kind_not_enrolled → wrong kind requested; the picker
  // already filters by enrolled set, so this should be rare. Letting
  // the user click Back and pick the other kind is the right answer.
  // 401 factor_compromised → sessions revoked; hard-navigate to login.
  if (err.status === 401 && msg.includes('factor_compromised')) {
    window.location.assign('/login');
  }
}
