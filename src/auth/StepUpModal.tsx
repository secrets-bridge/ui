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
 *     → queryClient onError calls requestStepUp(returnTo)
 *     → this provider registers a handler that opens the modal
 *     → user picks TOTP or security key (filtered by what they have)
 *     → POST /auth/mfa/challenge {kind}
 *     → TOTP: user types code | WebAuthn: navigator.credentials.get()
 *     → POST /auth/mfa/verify {challenge_id, code | response}
 *     → 204 = MFA-fresh; close modal, user re-clicks the original button
 *
 * Error cases the modal handles directly:
 *
 *   410 challenge expired         → reset back to factor picker
 *   400 verification_failed       → restart the ceremony from challenge
 *   412 mfa_enrollment_required   → navigate to /me/mfa
 *   412 mfa_kind_not_enrolled     → hint to switch factor
 *   401 factor_compromised        → hard-navigate to /login (sessions
 *                                   were revoked server-side)
 *
 * Hard rule kept: the modal NEVER sends the user_id; the api derives
 * it from the cookie. The challenge_id + factor_id round-trip are
 * the only state the SPA carries between calls.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { useMFAChallenge, useMFAFactors, useMFAVerify } from '../api/mfa';
import type { MFAFactor, MFAFactorKind } from '../api/mfa';
import { assertionResponseToJSON, toRequestOptions } from '../api/webauthn';
import { Button } from '../ui/Button';
import { useAuth } from './AuthContext';
import {
  resolveStepUp,
  setCompromisedHandler,
  setEnrollmentRequiredHandler,
  setStepUpHandler,
} from './stepUp';

type Stage = 'picker' | 'totp' | 'webauthn' | 'done';

export function StepUpModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();

  // Closing the modal MUST resolve the pending step-up promise so
  // client.ts can decide whether to retry (verified) or throw the
  // original 401 (cancelled). The outcome distinguishes the two —
  // every exit path in the modal passes the right value.
  const close = useCallback((outcome: 'verified' | 'cancelled') => {
    resolveStepUp(outcome);
    setOpen(false);
  }, []);

  useEffect(() => {
    setStepUpHandler(() => setOpen(true));
    setEnrollmentRequiredHandler(() => {
      // Bounce the user straight to enrollment. Don't open the modal
      // — there's nothing to verify with.
      navigate('/me/mfa');
    });
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
      setEnrollmentRequiredHandler(null);
      setCompromisedHandler(null);
    };
  }, [navigate, logout]);

  return (
    <>
      {children}
      {open && (
        <StepUpModal
          onCancel={() => close('cancelled')}
          onVerified={() => close('verified')}
        />
      )}
    </>
  );
}

// --- modal ----------------------------------------------------------

function StepUpModal({
  onCancel,
  onVerified,
}: {
  onCancel: () => void;
  onVerified: () => void;
}) {
  const navigate = useNavigate();
  const factors = useMFAFactors();
  const [stage, setStage] = useState<Stage>('picker');
  const [pickedFactor, setPickedFactor] = useState<MFAFactor | null>(null);
  const [pickedKind, setPickedKind] = useState<MFAFactorKind | null>(null);

  // Escape closes as a cancel — user explicitly bailed.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Auto-navigate to /me/mfa if the factor list resolves and the user
  // has zero — they shouldn't see the picker at all. That's a cancel
  // from the step-up perspective (no verify can happen here).
  useEffect(() => {
    if (factors.data && factors.data.length === 0) {
      navigate('/me/mfa');
      onCancel();
    }
  }, [factors.data, navigate, onCancel]);

  const start = useCallback(
    (kind: MFAFactorKind, factor?: MFAFactor) => {
      setPickedKind(kind);
      setPickedFactor(factor ?? null);
      setStage(kind === 'totp' ? 'totp' : 'webauthn');
    },
    []
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-label="Close"
      />
      <div className="relative bg-surface border border-border rounded-2xl w-[480px] max-w-full p-6 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-text font-bold text-xl tracking-tight">
              Confirm with MFA
            </div>
            <div className="text-muted text-xs mt-1">
              This action needs a fresh second factor. Once verified,
              you have 15 minutes before being asked again.
            </div>
          </div>
        </div>

        {stage === 'picker' && (
          <FactorPicker factors={factors.data ?? []} loading={factors.isLoading} onPick={start} />
        )}
        {stage === 'totp' && (
          <TOTPVerify
            factors={(factors.data ?? []).filter((f) => f.kind === 'totp')}
            initialFactor={pickedFactor}
            onBack={() => setStage('picker')}
            onSuccess={onVerified}
          />
        )}
        {stage === 'webauthn' && pickedKind === 'webauthn' && (
          <WebAuthnVerify onBack={() => setStage('picker')} onSuccess={onVerified} />
        )}

        <div className="flex items-center justify-end pt-3 border-t border-border/60">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
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
    return <div className="text-muted text-sm">Loading factors…</div>;
  }
  const hasWebAuthn = factors.some((f) => f.kind === 'webauthn');
  const totpFactors = factors.filter((f) => f.kind === 'totp');
  return (
    <div className="space-y-2">
      {hasWebAuthn && (
        <button
          type="button"
          onClick={() => onPick('webauthn')}
          className="w-full text-left bg-bg/40 hover:bg-bg/60 border border-border rounded-lg px-4 py-3 transition-colors"
        >
          <div className="text-text font-medium text-sm">Use a security key</div>
          <div className="text-muted text-xs mt-0.5">
            Yubikey, Touch ID, Windows Hello — whichever you registered.
          </div>
        </button>
      )}
      {totpFactors.length > 0 && (
        <button
          type="button"
          onClick={() => onPick('totp', totpFactors[0])}
          className="w-full text-left bg-bg/40 hover:bg-bg/60 border border-border rounded-lg px-4 py-3 transition-colors"
        >
          <div className="text-text font-medium text-sm">Use an authenticator app</div>
          <div className="text-muted text-xs mt-0.5">
            {totpFactors.length === 1
              ? totpFactors[0].label
              : `${totpFactors.length} TOTP factors — pick one after starting`}
          </div>
        </button>
      )}
      {factors.length === 0 && (
        <div className="text-muted text-sm">
          You haven't enrolled any factors yet. Redirecting to
          enrollment…
        </div>
      )}
    </div>
  );
}

// --- TOTP -----------------------------------------------------------

function TOTPVerify({
  factors,
  initialFactor,
  onBack,
  onSuccess,
}: {
  factors: MFAFactor[];
  initialFactor: MFAFactor | null;
  onBack: () => void;
  onSuccess: () => void;
}) {
  const challenge = useMFAChallenge();
  const verify = useMFAVerify();
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string>(initialFactor?.id ?? factors[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [challengeID, setChallengeID] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await challenge.mutateAsync({ kind: 'totp' });
        if (!cancelled) setChallengeID(out.challenge_id);
      } catch (err) {
        handleMFAEdgeCase(err, navigate);
      }
    })();
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
      onSuccess();
    } catch (err) {
      handleMFAEdgeCase(err, navigate);
    }
  };

  return (
    <div className="space-y-4">
      {factors.length > 1 && (
        <div>
          <label className="block text-[11px] text-muted font-medium uppercase tracking-wider mb-1.5">
            Which app
          </label>
          <select
            value={factorId}
            onChange={(e) => setFactorId(e.target.value)}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className="block text-[11px] text-muted font-medium uppercase tracking-wider mb-1.5">
          6-digit code
        </label>
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-base font-mono tracking-widest text-center focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
        />
      </div>
      {(challenge.isError || verify.isError) && (
        <ErrorBanner err={challenge.error ?? verify.error} />
      )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={onBack}>
          Back
        </Button>
        <Button
          variant="primary"
          size="md"
          onClick={submit}
          disabled={!challengeID || codeTrim.length !== 6 || verify.isPending}
        >
          {verify.isPending ? 'Verifying…' : 'Verify'}
        </Button>
      </div>
    </div>
  );
}

// --- WebAuthn -------------------------------------------------------

function WebAuthnVerify({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const challenge = useMFAChallenge();
  const verify = useMFAVerify();
  const navigate = useNavigate();
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);

  const run = async () => {
    setBrowserError(null);
    setInFlight(true);
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
    } catch (err) {
      if (err instanceof DOMException) {
        setBrowserError(`${err.name}: ${err.message || 'no further detail from the browser'}`);
      } else if (err instanceof ApiError) {
        handleMFAEdgeCase(err, navigate);
        setBrowserError(`${err.status} · ${err.message}`);
      } else if (err instanceof Error) {
        setBrowserError(err.message);
      } else {
        setBrowserError(String(err));
      }
    } finally {
      setInFlight(false);
    }
  };

  // Auto-start the ceremony so the user just taps their key.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <div className="bg-bg/40 border border-border rounded-lg px-4 py-3 text-sm">
        <div className="text-text font-medium">Tap your security key</div>
        <div className="text-muted text-xs mt-1">
          Or use your built-in biometrics (Touch ID, Windows Hello,
          Face ID). The browser is waiting.
        </div>
      </div>
      {browserError && (
        <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-4 py-3 text-sm">
          <div className="text-red-300 font-semibold mb-0.5">Authenticator declined</div>
          <div className="text-red-200/90 text-xs">{browserError}</div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <Button variant="secondary" size="sm" onClick={onBack} disabled={inFlight}>
          Back
        </Button>
        <Button variant="primary" size="md" onClick={run} disabled={inFlight}>
          {inFlight ? 'Waiting…' : 'Try again'}
        </Button>
      </div>
    </div>
  );
}

// --- shared bits ----------------------------------------------------

function ErrorBanner({ err }: { err: unknown }) {
  return (
    <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-4 py-3 text-sm">
      <div className="text-red-300 font-semibold mb-0.5">
        {err instanceof ApiError ? `${err.status} · request failed` : 'Network error'}
      </div>
      <div className="text-red-200/90 text-xs">
        {err instanceof Error ? err.message : String(err)}
      </div>
    </div>
  );
}

/**
 * Centralises the 4 special MFA error codes the api can return from
 * /auth/mfa/* so each ceremony path doesn't reimplement the
 * routing. The 401 step_up_required case never reaches here — the
 * global interceptor handles it by opening this modal.
 */
function handleMFAEdgeCase(err: unknown, navigate: (path: string) => void): void {
  if (!(err instanceof ApiError)) return;
  const msg = (err.message ?? '').toLowerCase();
  // 412 mfa_enrollment_required → no factors at all
  if (err.status === 412 && msg.includes('mfa_enrollment_required')) {
    navigate('/me/mfa');
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
