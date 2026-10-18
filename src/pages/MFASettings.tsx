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
 *     ceremony. After confirm the secret never re-appears. The enroll
 *     and confirm mutations are reset once they resolve so the seed
 *     and the code don't sit in TanStack's MutationCache (UI-N-02).
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
import { ConfirmModal } from '../ui/ConfirmModal';
import { Drawer } from '../ui/Drawer';
import { Banner } from '../ui/Banner';
import { DataTable, type Column } from '../ui/DataTable';
import { Field, Input } from '../ui/Field';
import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';
import { formatExact } from '../lib/time';

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

  const columns: Column<MFAFactor>[] = [
    { key: 'label', header: 'Name', render: (f) => <span className="text-ink">{f.label}</span> },
    { key: 'kind', header: 'Kind', render: (f) => (f.kind === 'webauthn' ? 'Security key or passkey' : 'Authenticator app') },
    { key: 'added', header: 'Added', render: (f) => <span className="whitespace-nowrap text-muted">{formatExact(f.created_at)}</span> },
    {
      key: 'used',
      header: 'Last used',
      render: (f) => <span className="whitespace-nowrap text-muted">{f.last_used_at ? formatExact(f.last_used_at) : 'Never'}</span>,
    },
    {
      key: 'act',
      header: 'Action',
      hiddenHeader: true,
      align: 'right',
      render: (f) => (
        <Button variant="danger" size="sm" onClick={() => setDeleteTarget(f)}>
          Remove…<span className="sr-only"> {f.label}</span>
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Second factor"
        description="Approving, rejecting and revealing ask for a second factor. Add an authenticator app, a security key or a passkey."
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => setEnrollMode('webauthn')}
              disabled={!supportsWebAuthn}
              title={supportsWebAuthn ? undefined : 'Security keys need HTTPS (or localhost) and a browser that supports WebAuthn.'}
            >
              Add security key…
            </Button>
            <Button variant="primary" onClick={() => setEnrollMode('totp')}>
              Add authenticator app…
            </Button>
          </>
        }
      />

      {list.isLoading && <p className="text-muted">Loading your factors…</p>}
      {list.isError && (
        <Banner tone="error" title="Couldn't load your factors.">
          {stringifyError(list.error)}
        </Banner>
      )}

      {list.data && factors.length === 0 && (
        <EmptyState title="You haven't added a second factor yet.">
          Add an authenticator app or a security key. Until you do, you can't approve, reject or reveal.
        </EmptyState>
      )}

      {factors.length > 0 && (
        <DataTable label="Your second factors" columns={columns} rows={factors} rowKey={(f) => f.id} minWidth={560} />
      )}

      {enrollMode === 'totp' && (
        <TOTPEnrollDrawer onClose={() => setEnrollMode(null)} />
      )}
      {enrollMode === 'webauthn' && (
        <WebAuthnEnrollDrawer onClose={() => setEnrollMode(null)} />
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Remove “${deleteTarget.label}”?`}
          body={
            factors.length === 1
              ? "This is your only second factor. Without one you can't approve, reject or reveal until you add another."
              : 'You can still use your other factors. You may be asked to confirm with one of them first.'
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
      await confirm.mutateAsync({ challenge_id: challenge.challenge_id, code: codeTrim });
      confirm.reset();
      setChallenge(null);
      onClose();
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

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
