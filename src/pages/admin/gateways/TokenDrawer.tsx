/**
 * Create a Gateway enrollment token (gateway.mint, fresh second factor).
 *
 * The token is in the mint response only. It lives in this component's
 * state while the drawer is open: the sensitive mutation is reset as soon
 * as the token is copied into state, the field is masked until "Show
 * token", the copy goes through copySecret, and the clipboard is cleared
 * (best effort) when the drawer closes. Nothing is written to browser
 * storage. Closing before copying asks once, because the token can't be
 * shown again.
 */

import { useState } from 'react';

import { ApiError } from '../../../api/client';
import { missingFactorText } from '../../../api/mfaErrors';
import { type Gateway, useMintGatewayToken } from '../../../api/gateways';
import { copySecret, useClearCopiedSecretOnUnmount } from '../../../lib/secretClipboard';
import { formatClock, formatRemaining } from '../../../lib/time';
import { useNow } from '../../../lib/useNow';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Drawer } from '../../../ui/Drawer';
import { Field, Input, Select } from '../../../ui/Field';

const LIFETIMES = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '24 hours' },
];

const CLUSTER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MASK = '••••••••••••';

interface Issued {
  token: string;
  expiresAt: string;
}

export function TokenDrawer({ gateway, onClose }: { gateway: Gateway; onClose: () => void }) {
  const mint = useMintGatewayToken();
  useClearCopiedSecretOnUnmount();
  const [ttl, setTtl] = useState(900);
  const [cluster, setCluster] = useState('');
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [closeWarned, setCloseWarned] = useState(false);
  // The error is kept here because the mutation is reset right away.
  const [failed, setFailed] = useState<unknown>(null);

  const clusterError = cluster && !CLUSTER_RE.test(cluster) ? 'Letters, digits and . _ - only, up to 128, starting with a letter or digit.' : undefined;

  const submit = async () => {
    setTried(true);
    if (clusterError) {
      document.getElementById('gwt-cluster')?.focus();
      return;
    }
    setFailed(null);
    try {
      const res = await mint.mutateAsync({
        gatewayId: gateway.id,
        expires_in_seconds: ttl,
        ...(cluster ? { expected_cluster_name: cluster } : {}),
      });
      setIssued({ token: res.enrollment_token, expiresAt: res.expires_at });
    } catch (e) {
      setFailed(e);
    } finally {
      // The response held the token: drop the MutationCache copy now.
      mint.reset();
    }
  };

  const close = () => {
    if (issued && !copied && !closeWarned) {
      setCloseWarned(true);
      return;
    }
    setIssued(null);
    onClose();
  };

  if (issued) {
    return (
      <Drawer
        title="Enrollment token"
        subtitle={`Gateway ${gateway.name} · ${gateway.boundary}`}
        onClose={close}
        footer={
          <Button variant={closeWarned && !copied ? 'danger' : 'primary'} onClick={close}>
            {closeWarned && !copied ? 'Close anyway' : 'Done'}
          </Button>
        }
      >
        <ShownOnce issued={issued} copied={copied} onCopied={() => setCopied(true)} closeWarned={closeWarned && !copied} />
      </Drawer>
    );
  }

  return (
    <Drawer
      title="Create enrollment token"
      subtitle={`A one-time token that Gateway ${gateway.name} trades for its own credential on first start.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mint.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="mint-gateway-token" variant="primary" disabled={mint.isPending} aria-busy={mint.isPending}>
            {mint.isPending ? 'Creating…' : 'Create token'}
          </Button>
        </>
      }
    >
      <form
        id="mint-gateway-token"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <Field id="gwt-ttl" label="Token lifetime" hint="Unused tokens expire. Pick the shortest time you need to install the Gateway.">
          {(p) => (
            <Select {...p} value={ttl} onChange={(e) => setTtl(Number(e.target.value))} data-autofocus>
              {LIFETIMES.map((l) => (
                <option key={l.seconds} value={l.seconds}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id="gwt-cluster"
          label="Cluster name (optional)"
          hint="Bound into the token: enrollment from a Gateway that reports another cluster is refused."
          error={tried ? clusterError : undefined}
        >
          {(p) => <Input {...p} value={cluster} onChange={(e) => setCluster(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} placeholder="tenant-a-uat" />}
        </Field>
        {failed != null && (
          <Banner tone="error" title="No token was created.">
            {mintErrorText(failed)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function ShownOnce({ issued, copied, onCopied, closeWarned }: { issued: Issued; copied: boolean; onCopied: () => void; closeWarned: boolean }) {
  const now = useNow(15_000);
  const [show, setShow] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const expired = Date.parse(issued.expiresAt) <= now;

  return (
    <div className="flex flex-col gap-5">
      {closeWarned ? (
        <Banner tone="error" title="You haven't copied the token.">
          It can't be shown again. If you close now, create a new token when you're ready to install.
        </Banner>
      ) : expired ? (
        <Banner tone="error" title="This token has expired.">
          A Gateway can't enroll with it any more. Close this panel and create a new token.
        </Banner>
      ) : (
        <Banner title="Copy the token now. It is shown only once.">
          It works once and expires at {formatClock(issued.expiresAt)} ({formatRemaining(issued.expiresAt, now)}).
        </Banner>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <code
            aria-label="Enrollment token"
            className="min-w-0 break-all rounded-md border border-border bg-sunken px-3 py-1.5 font-mono text-mono-small text-ink"
          >
            {show ? issued.token : MASK}
          </code>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              setCopyError(null);
              try {
                await copySecret(issued.token);
                onCopied();
              } catch {
                setCopyError("Couldn't copy. Show the token and copy it by hand.");
              }
            }}
          >
            {copied ? 'Copied' : 'Copy token'}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setShow((s) => !s)} aria-pressed={show}>
            {show ? 'Hide token' : 'Show token'}
          </Button>
        </div>
        <p className="text-caption text-muted" aria-live="polite">
          {copyError ??
            (copied
              ? 'Copied. Closing this panel clears the clipboard if it still holds the token.'
              : 'Store it as a Kubernetes Secret next to the Gateway, never as a chart value or on a command line.')}
        </p>
      </div>
      <p className="text-ui font-normal text-muted">
        Once the Gateway enrolls, its status turns Active and its advertised Argo CD connector shows up here for approval.
      </p>
    </div>
  );
}

function mintErrorText(err: unknown): string {
  const noFactor = missingFactorText(err, 'no token was made');
  if (noFactor) return noFactor;
  if (!(err instanceof ApiError)) return 'Network error. Try again.';
  if (err.status === 409) return '409: This Gateway has already enrolled. A token is only for a pending Gateway.';
  if (err.status === 404) return '404: This Gateway no longer exists.';
  if (err.status === 403) return "403: You don't have permission to create enrollment tokens (gateway.mint).";
  return `${err.status}: ${err.message}`;
}
