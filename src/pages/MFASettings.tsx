/**
 * MFA settings page (`/me/mfa`).
 *
 * Slice I1. Lets the signed-in user enroll, view, and remove their
 * own MFA factors. Backed by api slices H1–H5:
 *
 *   GET    /users/me/mfa/factors             list
 *   DELETE /users/me/mfa/factors/:id         remove
 *   POST   /users/me/mfa/totp/{enroll,confirm}
 *   POST   /users/me/mfa/webauthn/register/{start,finish}
 *
 * Two enrollment flows:
 *
 *   TOTP     — user gives a label, scans the QR with an authenticator
 *              app (or types the base32 secret manually), then types
 *              the 6-digit code back. The api persists the factor only
 *              when the code verifies; a wrong code BURNS the
 *              challenge and the user restarts.
 *
 *   WebAuthn — user gives a label, the browser runs
 *              `navigator.credentials.create()` against the api-issued
 *              challenge, and the attestation is POSTed back. The
 *              browser refuses to re-register the same authenticator
 *              because the api populates `excludeCredentials` with the
 *              user's existing rawIds.
 *
 * Hard rules:
 *   - The api enforces user-scoped operations; this page never sends
 *     a user_id field. The session cookie is the only auth surface.
 *   - Plaintext TOTP secret is shown ONCE during enrollment + zeroed
 *     from React state as soon as the user navigates away from the
 *     ceremony. After confirm the secret never re-appears.
 *   - WebAuthn requires a secure context (HTTPS or localhost). On
 *     plain HTTP non-localhost, the browser blocks
 *     `navigator.credentials.create()` and we surface a clear error.
 */

import { useState } from 'react';

import { QRCodeSVG } from 'qrcode.react';

import { ApiError } from '../api/client';
import {
  type MFAFactor,
  useConfirmTOTP,
  useDeleteFactor,
  useEnrollTOTP,
  useMFAFactors,
  useWebAuthnRegisterFinish,
  useWebAuthnRegisterStart,
  type TOTPEnrollResponse,
} from '../api/mfa';
import { attestationResponseToJSON, toCreationOptions } from '../api/webauthn';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Drawer } from '../ui/Drawer';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

type EnrollMode = 'totp' | 'webauthn' | null;

export function MFASettings() {
  const list = useMFAFactors();
  const factors = list.data ?? [];

  const [enrollMode, setEnrollMode] = useState<EnrollMode>(null);
  const [deleteTarget, setDeleteTarget] = useState<MFAFactor | null>(null);
  const deleteMutation = useDeleteFactor();

  const supportsWebAuthn =
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    window.isSecureContext;

  return (
    <div>
      <PageHeader
        title="Multi-factor authentication"
        description="Add a security key or an authenticator app. We require a second factor on sensitive actions — approving requests, revealing secrets, editing roles."
      />

      <div className="flex flex-wrap gap-3 mb-6">
        <Button variant="primary" onClick={() => setEnrollMode('totp')}>
          Add authenticator app
        </Button>
        <Button
          variant="secondary"
          onClick={() => setEnrollMode('webauthn')}
          disabled={!supportsWebAuthn}
          title={
            supportsWebAuthn
              ? undefined
              : 'WebAuthn requires HTTPS (or localhost) and a browser that supports it.'
          }
        >
          Add security key / passkey
        </Button>
      </div>

      {list.isLoading && (
        <Card className="p-6 text-center text-muted text-sm">Loading factors…</Card>
      )}
      {list.isError && (
        <Card className="border-red-500/40 p-5 mb-4">
          <div className="text-red-300 font-medium">Failed to load factors</div>
          <div className="text-muted text-xs mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.data && factors.length === 0 && (
        <Card className="p-10 text-center">
          <div className="text-text font-semibold mb-2">No factors enrolled yet</div>
          <div className="text-muted text-sm">
            Add a security key or authenticator app to satisfy step-up
            on Tier 2 actions.
          </div>
        </Card>
      )}

      {factors.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>Label</Th>
                <Th>Kind</Th>
                <Th>Added</Th>
                <Th>Last used</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {factors.map((f) => (
                <tr key={f.id} className="border-b border-border/40 last:border-0 align-middle">
                  <Td>
                    <div className="text-text">{f.label}</div>
                  </Td>
                  <Td>
                    <StatusPill
                      variant={f.kind === 'webauthn' ? 'success' : 'accent'}
                      tone="outline"
                    >
                      {f.kind === 'webauthn' ? 'Security key' : 'TOTP'}
                    </StatusPill>
                  </Td>
                  <Td className="text-muted">{shortDate(f.created_at)}</Td>
                  <Td className="text-muted">
                    {f.last_used_at ? shortDate(f.last_used_at) : 'never'}
                  </Td>
                  <Td className="text-right">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setDeleteTarget(f)}
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {enrollMode === 'totp' && (
        <TOTPEnrollDrawer onClose={() => setEnrollMode(null)} />
      )}
      {enrollMode === 'webauthn' && (
        <WebAuthnEnrollDrawer onClose={() => setEnrollMode(null)} />
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Remove this factor?"
          body={
            `“${deleteTarget.label}” will be removed. ` +
            `If it was your only factor, you'll be asked to enroll a new one before performing Tier 2 actions.`
          }
          confirmText="Remove"
          danger
          loading={deleteMutation.isPending}
          error={deleteMutation.error}
          onCancel={() => {
            setDeleteTarget(null);
            deleteMutation.reset();
          }}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

// --- TOTP enrollment drawer -----------------------------------------

function TOTPEnrollDrawer({ onClose }: { onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState<TOTPEnrollResponse | null>(null);

  const enroll = useEnrollTOTP();
  const confirm = useConfirmTOTP();

  const labelTrim = label.trim();
  const codeTrim = code.trim();

  const startEnroll = async () => {
    if (!labelTrim) return;
    confirm.reset();
    setChallenge(null);
    setCode('');
    const out = await enroll.mutateAsync({ label: labelTrim });
    setChallenge(out);
  };

  const submitCode = async () => {
    if (!challenge || codeTrim.length !== 6) return;
    await confirm.mutateAsync({
      challenge_id: challenge.challenge_id,
      code: codeTrim,
    });
    onClose();
  };

  return (
    <Drawer
      title="Add authenticator app"
      onClose={onClose}
      footer={
        challenge ? (
          <>
            <Button variant="secondary" onClick={onClose} disabled={confirm.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitCode}
              disabled={codeTrim.length !== 6 || confirm.isPending}
            >
              {confirm.isPending ? 'Verifying…' : 'Verify + add'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose} disabled={enroll.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={startEnroll}
              disabled={!labelTrim || enroll.isPending}
            >
              {enroll.isPending ? 'Generating…' : 'Show QR code'}
            </Button>
          </>
        )
      }
    >
      {!challenge && (
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] text-muted font-medium uppercase tracking-wider mb-1.5">
              Label
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="iPhone backup, Bitwarden, 1Password…"
              autoFocus
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
            <div className="text-[11px] text-muted/80 mt-1">
              How this factor will show up in your list. Must be unique
              across your factors.
            </div>
          </div>
          {enroll.isError && <ErrorBanner err={enroll.error} />}
        </div>
      )}

      {challenge && (
        <div className="space-y-5">
          <div>
            <div className="text-[11px] text-muted font-medium uppercase tracking-wider mb-2">
              1 · Scan with your authenticator
            </div>
            <Card className="p-5 flex flex-col items-center gap-4">
              <div className="bg-white rounded-lg p-3">
                <QRCodeSVG
                  value={challenge.provisioning_uri}
                  size={192}
                  level="M"
                  marginSize={0}
                />
              </div>
              <details className="text-xs text-muted w-full">
                <summary className="cursor-pointer hover:text-text">
                  Can't scan? Show the secret to type manually
                </summary>
                <div className="mt-3 font-mono text-[11px] break-all bg-bg/40 border border-border/60 rounded-md px-3 py-2 text-text">
                  {challenge.secret_base32}
                </div>
                <div className="mt-2 text-[11px] text-muted/80">
                  Algorithm SHA1 · 6 digits · 30 second period.
                </div>
              </details>
            </Card>
          </div>
          <div>
            <div className="text-[11px] text-muted font-medium uppercase tracking-wider mb-2">
              2 · Type the 6-digit code your app shows
            </div>
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
            <div className="text-[11px] text-muted/80 mt-1">
              If the code is wrong, the challenge resets — close this
              drawer and start over.
            </div>
          </div>
          {confirm.isError && <ErrorBanner err={confirm.error} />}
        </div>
      )}
    </Drawer>
  );
}

// --- WebAuthn enrollment drawer -------------------------------------

function WebAuthnEnrollDrawer({ onClose }: { onClose: () => void }) {
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
      await finish.mutateAsync({
        challenge_id: challenge.challenge_id,
        response,
      });
      setStage('done');
      onClose();
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
          >
            {inFlight ? 'Waiting for authenticator…' : 'Add factor'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] text-muted font-medium uppercase tracking-wider mb-1.5">
            Label
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Yubikey 5C, iPhone Touch ID, Windows Hello…"
            autoFocus
            disabled={inFlight}
            className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:opacity-50"
          />
          <div className="text-[11px] text-muted/80 mt-1">
            How this factor will show up in your list. Must be unique
            across your factors.
          </div>
        </div>

        <Card className="p-4 text-sm space-y-2">
          <div className="text-text font-medium">When you click “Add factor”…</div>
          <ol className="list-decimal list-inside text-muted text-xs space-y-1">
            <li>Your browser will prompt you to choose an authenticator.</li>
            <li>Tap your security key or use your built-in biometrics.</li>
            <li>The factor is added once the browser hands back proof.</li>
          </ol>
          <div className="text-[11px] text-muted/80 pt-1">
            The browser blocks re-registering an authenticator you
            already added.
          </div>
        </Card>

        {browserError && (
          <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-4 py-3 text-sm">
            <div className="text-red-300 font-semibold mb-0.5">Authenticator declined</div>
            <div className="text-red-200/90 text-xs">{browserError}</div>
          </div>
        )}
        {start.isError && <ErrorBanner err={start.error} />}
        {finish.isError && <ErrorBanner err={finish.error} />}
      </div>
    </Drawer>
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

function shortDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  return new Date(t).toISOString().slice(0, 10);
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-5 py-3 font-medium ${className}`}>{children}</th>;
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-5 py-3.5 ${className}`}>{children}</td>;
}
