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
 * Two enrollment flows (the drawers are in `auth/FactorEnroll.tsx`, shared
 * with the step-up modal):
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
import { useLocation, useNavigate } from 'react-router-dom';

import { ApiError } from '../api/client';
import { type MFAFactor, useDeleteFactor, useMFAFactors } from '../api/mfa';
import { canUseWebAuthn } from '../api/webauthn';
import { TOTPEnrollDrawer, WebAuthnEnrollDrawer } from '../auth/FactorEnroll';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Banner } from '../ui/Banner';
import { DataTable, type Column } from '../ui/DataTable';
import { EmptyState } from '../ui/EmptyState';
import { PageHeader } from '../ui/PageHeader';
import { formatExact } from '../lib/time';

type EnrollMode = 'totp' | 'webauthn' | null;

export function MFASettings() {
  const list = useMFAFactors();
  const factors = list.data ?? [];
  // Sent here because a page wouldn't load without a second factor
  // (the login gate, ui#171).
  const location = useLocation();
  const navigate = useNavigate();
  const required = (location.state as { factorRequired?: boolean } | null)?.factorRequired === true;

  const [enrollMode, setEnrollMode] = useState<EnrollMode>(null);
  const [deleteTarget, setDeleteTarget] = useState<MFAFactor | null>(null);
  const deleteMutation = useDeleteFactor();

  const supportsWebAuthn = canUseWebAuthn();

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

      {required && list.data && factors.length === 0 && (
        <Banner title="Add a second factor to continue." className="mb-4">
          This install asks for one before anything else. Once it's added, you're asked for it once and can carry on.
        </Banner>
      )}
      {required && factors.length > 0 && (
        <Banner
          title="Your second factor is added."
          className="mb-4"
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/', { replace: true })}>
              Continue
            </Button>
          }
        >
          Continue and confirm with it once.
        </Banner>
      )}

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

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
