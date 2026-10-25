/**
 * Rotate an agent's wire key (skills#116, agent.mint).
 *
 * 1. Create a one-time rotation token: POST /admin/agents/:id/key-rotation.
 *    The api asks for a fresh second factor, so `client.ts` opens the
 *    step-up modal first and retries. Cancelling it creates nothing.
 * 2. Run `secrets-bridge-agent rotate-key` on the operator's machine. It
 *    reads the token at a silent prompt, creates the new X25519 private
 *    key there, proves it holds it, and writes the new bundle (same
 *    agent credential, new private key) into the secret store.
 * 3. Restart the agent so it reads the new Secret. Until then the
 *    control plane answers it with `agent_key_mismatch`.
 *
 * The rotation token follows the enrollment token's rules: component
 * state only, masked, copied once with `copySecret`, then dropped from
 * state, and dropped on close and unmount. The new private key never
 * reaches this page.
 */

import { useState } from 'react';

import { type AdminAgent, useAdminAgents, useCreateKeyRotation } from '../../api/agents';
import { ApiError } from '../../api/client';
import { missingFactorText } from '../../api/mfaErrors';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import { type CredentialStore, defaultStorePath, isExternalStore, restartCommand, rotateCommand } from '../../lib/agentInstall';
import { useClearCopiedSecretOnUnmount } from '../../lib/secretClipboard';
import { formatClock, formatRemaining } from '../../lib/time';
import { useNow } from '../../lib/useNow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { CommandBlock, OnceToken, StorePicker } from './parts';

interface Issued {
  /** Null once copied. */
  token: string | null;
  expiresAt: string;
  /** The key version when the token was made; rotation moves it up by one. */
  fromVersion: number;
}

export function RotateKeyDrawer({ agent, onClose }: { agent: AdminAgent; onClose: () => void }) {
  const rotate = useCreateKeyRotation();
  useClearCopiedSecretOnUnmount();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [closeWarned, setCloseWarned] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);

  const submit = async () => {
    setFailed(null);
    try {
      const res = await rotate.mutateAsync({ id: agent.id });
      setIssued({ token: res.rotation_token, expiresAt: res.expires_at, fromVersion: agent.public_key_version ?? 1 });
    } catch (e) {
      setFailed(e);
    } finally {
      // The response held the token: drop the MutationCache copy now.
      rotate.reset();
    }
  };

  const copied = issued !== null && issued.token === null;
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
        title={`Rotate the key of ${agent.name}`}
        subtitle="Run the rotation on your machine, then restart the agent."
        onClose={close}
        wide
        footer={
          <Button variant={closeWarned && !copied ? 'danger' : 'primary'} onClick={close}>
            {closeWarned && !copied ? 'Close anyway' : 'Done'}
          </Button>
        }
      >
        <RotateSteps agent={agent} issued={issued} onCopied={() => setIssued((i) => (i ? { ...i, token: null } : i))} closeWarned={closeWarned && !copied} />
      </Drawer>
    );
  }

  return (
    <Drawer
      title={`Rotate the key of ${agent.name}?`}
      subtitle="Replaces the agent's X25519 wire key. The agent id and agent secret stay the same."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={rotate.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={rotate.isPending} aria-busy={rotate.isPending}>
            {rotate.isPending ? 'Creating…' : 'Create rotation token'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-ui font-normal text-muted">
          This creates a one-time rotation token that works for 15 minutes. It needs a fresh second factor. The rotation command then
          creates the new private key on your machine and registers its public key; the private key never reaches this browser or the
          control plane.
        </p>
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-ui font-normal text-muted">
          <li>Until the agent restarts with the new Secret, the control plane refuses its calls with agent_key_mismatch.</li>
          <li>Queued work is sealed to the key that is registered when the agent fetches it, so nothing sealed to the old key is left waiting.</li>
          <li>The rotation is in the audit log, with the old and the new fingerprint.</li>
        </ul>
        {agent.public_key_fingerprint && (
          <p className="text-ui font-normal text-muted">
            Current key, version {agent.public_key_version ?? 1}: <span className="break-all font-mono text-mono-small text-ink">{agent.public_key_fingerprint}</span>
          </p>
        )}
        {failed != null && (
          <Banner tone="error" title="No rotation token was created.">
            {rotateErrorText(failed)}
          </Banner>
        )}
      </div>
    </Drawer>
  );
}

function RotateSteps({ agent, issued, onCopied, closeWarned }: { agent: AdminAgent; issued: Issued; onCopied: () => void; closeWarned: boolean }) {
  const now = useNow(15_000);
  const agents = useAdminAgents();
  const [store, setStore] = useState<CredentialStore>(agent.provider_type === 'vault' ? 'vault' : agent.provider_type === 'aws-sm' ? 'aws-sm' : 'kubectl');
  const [path, setPath] = useState(defaultStorePath(agent.cluster_name ?? ''));
  const endpoint = window.location.origin;
  // For the Vault mount; listing connections needs integration.edit, so
  // without it the mount stays a placeholder.
  const connections = useProviderConnectionsAdmin();
  const connection = (connections.data ?? []).find((c) => c.id === agent.provider_connection_id);
  const command = rotateCommand({ endpoint, store, path, connection });
  const expired = Date.parse(issued.expiresAt) <= now;
  const copied = issued.token === null;
  const current = (agents.data ?? []).find((a) => a.id === agent.id) ?? agent;
  const rotated = (current.public_key_version ?? 1) > issued.fromVersion;

  return (
    <div className="flex flex-col gap-6">
      {closeWarned ? (
        <Banner tone="error" title="You haven't copied the rotation token.">
          It can't be shown again. If you close now, create a new one when you're ready to rotate.
        </Banner>
      ) : expired ? (
        <Banner tone="error" title="This rotation token has expired.">
          Close this panel and create a new one when you're ready to rotate.
        </Banner>
      ) : (
        <Banner title={copied ? 'Token copied. This page no longer holds it.' : 'You can copy the rotation token once.'}>
          It works once and expires at {formatClock(issued.expiresAt)} ({formatRemaining(issued.expiresAt, now)}).
        </Banner>
      )}

      <section aria-labelledby="rotate-run" className="flex flex-col gap-3">
        <h3 id="rotate-run" className="text-body font-semibold text-ink">
          1. Run the rotation command on your machine
        </h3>
        <StorePicker idPrefix="rotate-store" store={store} onStore={setStore} path={path} onPath={setPath} />
        <CommandBlock label="Rotation command" command={command} />
        <p className="text-caption text-muted">
          &lt;credentials-dir&gt; is a directory only you can read (mode 0700) holding this agent's current agent_id and agent_secret
          files, for example fetched from your secret store. Remove it afterwards. The command waits at a silent prompt for the token and
          writes a new private key with the same agent credential.
        </p>
      </section>

      <section aria-labelledby="rotate-token" className="flex flex-col gap-2">
        <h3 id="rotate-token" className="text-body font-semibold text-ink">
          2. Paste the rotation token at the prompt
        </h3>
        <OnceToken label="Rotation token" token={issued.token} onCopied={onCopied} />
      </section>

      <section aria-labelledby="rotate-restart" className="flex flex-col gap-2">
        <h3 id="rotate-restart" className="text-body font-semibold text-ink">
          3. Restart the agent
        </h3>
        <CommandBlock label="Restart command" command={restartCommand()} />
        <p className="text-caption text-muted">
          {isExternalStore(store)
            ? 'Wait until External Secrets Operator has synced the new version into the Secret (or force a sync), then restart.'
            : 'The Secret is updated in place; restart so the agent reads it.'}
        </p>
        <div aria-live="polite" className="rounded-md border border-border bg-surface px-3.5 py-3 text-ui font-normal">
          {rotated ? (
            <p className="text-ink">
              Key version {current.public_key_version} is registered
              {current.public_key_fingerprint && (
                <>
                  : <span className="break-all font-mono text-mono-small">{current.public_key_fingerprint}</span>
                </>
              )}
              . It should match the fingerprint the command printed.
            </p>
          ) : (
            <p className="text-muted">Still on key version {issued.fromVersion}. This updates on its own once the rotation command finishes.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function rotateErrorText(err: unknown): string {
  const noFactor = missingFactorText(err, 'no rotation token was created');
  if (noFactor) return noFactor;
  if (!(err instanceof ApiError)) return 'Network error. Try again.';
  if (err.stepUp) return '401: This needs a fresh second factor, so no rotation token was created. Try again to confirm with your second factor.';
  if (err.status === 403) return "403: You don't have permission to rotate agent keys (agent.mint).";
  if (err.status === 404) return '404: This agent no longer exists.';
  if (err.status === 409) return '409: This agent is revoked. Enroll a new agent instead.';
  if (err.status === 429) return '429: Too many rotation tokens were created just now. Wait a minute and try again.';
  return `${err.status}: ${err.message}`;
}
