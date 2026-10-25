/**
 * Pieces shared by the agent onboarding and key rotation panels:
 *
 * - `CommandBlock`: a command with a Copy command button. Commands hold
 *   no secret (the token is read at a silent prompt), so they're copied
 *   with the plain clipboard API.
 * - `OnceToken`: a one-time token, masked, copied once with
 *   `copySecret`. The parent drops the token from its state as soon as
 *   the copy succeeds, so after that the page no longer holds it.
 * - `StorePicker`: where the operator keeps the credential and private
 *   key, and the name it goes under.
 * - `KeyCustodyNote`: what is created where.
 */

import { useState } from 'react';

import { copySecret } from '../../lib/secretClipboard';
import {
  AGENT_IDENTITY_SECRET,
  AGENT_NAMESPACE,
  CREDENTIAL_STORES,
  type CredentialStore,
  externalSecretManifest,
  isExternalStore,
  isInstallSafe,
} from '../../lib/agentInstall';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Field';
import { TabPanel, Tabs } from '../../ui/Tabs';

export const MASK = '••••••••••••';

export function CommandBlock({ command, label, copyLabel = 'Copy command' }: { command: string; label: string; copyLabel?: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <pre
        aria-label={label}
        className="overflow-x-auto rounded-md border border-border bg-sunken px-3 py-2.5 font-mono text-mono-small leading-relaxed text-ink"
      >
        {command}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={async () => {
            setFailed(false);
            try {
              // No secret in a command: tokens are read at a prompt.
              await navigator.clipboard.writeText(command);
              setCopied(true);
            } catch {
              setCopied(false);
              setFailed(true);
            }
          }}
        >
          {copied ? 'Copied' : copyLabel}
        </Button>
        {failed && <span className="text-caption text-bad">Couldn't copy. Select the command and copy it by hand.</span>}
      </div>
    </div>
  );
}

/**
 * A one-time token, copied once. `token` is null once it was copied: the
 * parent drops it from state in `onCopied`, so nothing on the page holds
 * it any more.
 */
export function OnceToken({ label, token, onCopied }: { label: string; token: string | null; onCopied: () => void }) {
  const [copyError, setCopyError] = useState<string | null>(null);
  const copied = token === null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <code aria-label={label} className="min-w-0 break-all rounded-md border border-border bg-sunken px-3 py-1.5 font-mono text-mono-small text-ink">
          {copied ? 'Copied and cleared from this page' : MASK}
        </code>
        <Button
          variant="secondary"
          size="sm"
          disabled={copied}
          onClick={async () => {
            if (!token) return;
            setCopyError(null);
            try {
              await copySecret(token);
              onCopied();
            } catch {
              setCopyError("Couldn't copy: the browser refused clipboard access. Allow it for this site, then copy again.");
            }
          }}
        >
          {copied ? 'Copied' : 'Copy token'}
        </Button>
      </div>
      <p className={'text-caption ' + (copyError ? 'text-bad' : 'text-muted')} aria-live="polite">
        {copyError ??
          (copied
            ? 'Paste it at the waiting prompt. The clipboard is cleared in a minute, or when you close this panel, if it still holds the token.'
            : 'You can copy it once. This page then forgets it. Copy it when the command is waiting at its prompt.')}
      </p>
    </div>
  );
}

export function KeyCustodyNote() {
  return (
    <Banner title="The private key never leaves your machine.">
      The command creates the agent's X25519 wire-encryption key and its agent secret on the machine you run it on, and
      pipes them straight into your secret store. Neither reaches this browser or the control plane: the control plane
      keeps only the public key and a hash of the agent secret. The wire key encrypts what the control plane sends the
      agent; it is not a TLS certificate.
    </Banner>
  );
}

export function StorePicker({
  idPrefix,
  store,
  onStore,
  path,
  onPath,
}: {
  idPrefix: string;
  store: CredentialStore;
  onStore: (s: CredentialStore) => void;
  path: string;
  onPath: (p: string) => void;
}) {
  const pathError = isExternalStore(store) && (!path || path.length > 200 || !isInstallSafe(path)) ? 'Use letters, digits and . _ - : / @ % + only.' : undefined;
  return (
    <div className="flex flex-col gap-3">
      <Tabs tabs={CREDENTIAL_STORES} value={store} onChange={(id) => onStore(id as CredentialStore)} label="Where the credential goes" idPrefix={idPrefix} />
      <TabPanel idPrefix={idPrefix} value={store}>
        {isExternalStore(store) ? (
          <Field
            id={`${idPrefix}-path`}
            label={store === 'aws-sm' ? 'Secret name in AWS Secrets Manager' : 'Path in Vault KV'}
            hint={
              store === 'aws-sm'
                ? 'Create the secret first, with no value. The command writes a new version; only this machine needs secretsmanager:PutSecretValue on it.'
                : 'The command writes a new version at this path. Only this machine needs create and update on it.'
            }
            error={pathError}
          >
            {(p) => <Input {...p} value={path} onChange={(e) => onPath(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} />}
          </Field>
        ) : store === 'kubectl' ? (
          <p className="text-caption text-muted">
            Writes the Secret {AGENT_IDENTITY_SECRET} in the {AGENT_NAMESPACE} namespace straight from the command's output. Create
            the namespace first if it doesn't exist.
          </p>
        ) : (
          <Banner title="Never commit this manifest.">
            It holds the private key and the agent secret in plain base64. Pipe it into kubectl apply as shown and don't redirect
            it to a file, a Git repository or a CI log.
          </Banner>
        )}
      </TabPanel>
    </div>
  );
}

/** For AWS Secrets Manager and Vault: how the bundle reaches the cluster. */
export function SyncToCluster({ path }: { path: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-ui font-normal text-muted">
        With External Secrets Operator, this ExternalSecret keeps the Secret {AGENT_IDENTITY_SECRET} in step with your store. It holds
        names only, so it is safe to keep in Git. Without ESO, create the Secret from the same three keys yourself. The agent only
        reads the Secret and never writes one.
      </p>
      <CommandBlock label="ExternalSecret manifest" copyLabel="Copy manifest" command={externalSecretManifest(path)} />
    </div>
  );
}
