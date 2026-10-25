/**
 * Onboard an agent (enrollment v2, skills#116). Two views in one drawer:
 *
 * 1. Choose the provider connection the agent will serve, the cluster it
 *    runs in, its name and how long the token lives (15 minutes to 24
 *    hours), then create a one-time enrollment token. The cluster name
 *    is bound into the token, so an enrollment that reports another
 *    cluster is refused.
 * 2. The steps, in order:
 *    a. run `secrets-bridge-agent enroll` on the operator's machine. It
 *       reads the token at a silent prompt (stdin, never an argument),
 *       creates the X25519 private key and the agent secret there, proves
 *       it holds the key, and pipes the bundle into AWS Secrets Manager,
 *       Vault or a Kubernetes Secret;
 *    b. copy the token once and paste it at the prompt;
 *    c. for an external store, sync it into the cluster (ESO, optional);
 *    d. install the chart with `identity.existingSecret`;
 *    e. watch the agent connect, with the fingerprint of the key it
 *       registered.
 *
 * Token hygiene: the token lives only in this component's state, never in
 * storage. The mutation is reset as soon as the token is in state, it is
 * never rendered (masked), it is copied once with `copySecret` and then
 * dropped from state, and it is dropped on close and unmount too. Closing
 * before copying asks once, because the token can't be shown again. The
 * private key and the agent secret never reach this page.
 */

import { useState } from 'react';

import { useAdminAgents, useCreateEnrollmentToken } from '../../api/agents';
import { ApiError } from '../../api/client';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import type { ProviderConnection } from '../../api/types';
import {
  type CredentialStore,
  defaultStorePath,
  enrollCommand,
  helmInstallCommand,
  isExternalStore,
  isInstallSafe,
} from '../../lib/agentInstall';
import { providerLabel } from '../../lib/providers';
import { useClearCopiedSecretOnUnmount } from '../../lib/secretClipboard';
import { formatClock, formatRemaining } from '../../lib/time';
import { useNow } from '../../lib/useNow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { Field, Input, Select } from '../../ui/Field';
import { AgentStatusWord } from './AgentStatusWord';
import { CommandBlock, KeyCustodyNote, OnceToken, StorePicker, SyncToCluster } from './parts';

const LIFETIMES = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '24 hours' },
];

interface Issued {
  /** Null once copied: the page no longer holds it. */
  token: string | null;
  expiresAt: string;
  /** Server time the token was issued (expiry minus lifetime). */
  issuedAt: number;
  connection: ProviderConnection;
  cluster: string;
  name: string;
}

export function EnrollAgentDrawer({ initialConnectionId, onClose }: { initialConnectionId?: string; onClose: () => void }) {
  const connections = useProviderConnectionsAdmin();
  const create = useCreateEnrollmentToken();
  useClearCopiedSecretOnUnmount();

  const [connectionId, setConnectionId] = useState(initialConnectionId ?? '');
  const [clusterTyped, setClusterTyped] = useState<string | null>(null);
  const [nameTyped, setNameTyped] = useState<string | null>(null);
  const [ttl, setTtl] = useState(900);
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [closeWarned, setCloseWarned] = useState(false);
  // Kept here because the mutation is reset right away.
  const [failed, setFailed] = useState<unknown>(null);

  const all = connections.data ?? [];
  const connection = all.find((c) => c.id === connectionId);
  // The connection's own cluster name is the default; typing replaces it.
  const cluster = (clusterTyped ?? connection?.cluster_name ?? '').trim();
  const name = (nameTyped ?? (cluster ? `${cluster}-agent` : '')).trim();

  const errors: Record<string, string> = {};
  if (!connection) errors.connection = 'Choose the connection this agent will serve.';
  else if (connection.status !== 'active') errors.connection = 'This connection is disabled. Enable it first.';
  if (!cluster) errors.cluster = 'Name the cluster the agent runs in.';
  // Both go into the commands the next view shows.
  else if (cluster.length > 100 || !isInstallSafe(cluster)) errors.cluster = 'Use the cluster identifier: letters, digits and . _ - : / @ % + only.';
  if (!name) errors.name = 'Name the agent.';
  else if (name.length > 100 || !isInstallSafe(name)) errors.name = 'Use letters, digits and . _ - : / @ % + only.';
  const show = (k: string) => (tried ? errors[k] : undefined);

  const submit = async () => {
    setTried(true);
    const first = ['connection', 'cluster', 'name'].find((k) => errors[k]);
    if (first || !connection) {
      document.getElementById(`enroll-${first ?? 'connection'}`)?.focus();
      return;
    }
    setFailed(null);
    try {
      const res = await create.mutateAsync({ connectionId: connection.id, expected_cluster_name: cluster, expires_in_seconds: ttl });
      setIssued({ token: res.enrollment_token, expiresAt: res.expires_at, issuedAt: Date.parse(res.expires_at) - ttl * 1000, connection, cluster, name });
    } catch (e) {
      setFailed(e);
    } finally {
      // The response held the token: drop the MutationCache copy now.
      create.reset();
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
        title="Onboard the agent"
        subtitle={`${issued.connection.name} · ${providerLabel(issued.connection.type)} · cluster ${issued.cluster}`}
        onClose={close}
        wide
        footer={
          <Button variant={closeWarned && !copied ? 'danger' : 'primary'} onClick={close}>
            {closeWarned && !copied ? 'Close anyway' : 'Done'}
          </Button>
        }
      >
        <Steps issued={issued} onCopied={() => setIssued((i) => (i ? { ...i, token: null } : i))} closeWarned={closeWarned && !copied} />
      </Drawer>
    );
  }

  return (
    <Drawer
      title="Enroll an agent"
      subtitle="Creates a one-time token. You trade it for the agent's credential with the enrollment command on your own machine."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="enroll-agent" variant="primary" disabled={create.isPending} aria-busy={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create enrollment token'}
          </Button>
        </>
      }
    >
      <form
        id="enroll-agent"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-[18px]"
      >
        {connections.isError ? (
          <Banner tone="error" title="Couldn't load the provider connections.">
            {connections.error instanceof ApiError && connections.error.status === 403
              ? '403: Listing connections needs integration.edit as well as agent.mint. Ask an administrator.'
              : 'Try again in a moment.'}
          </Banner>
        ) : (
          <Field id="enroll-connection" label="Provider connection" hint="The agent is bound to this connection for good. One agent per connection and cluster." error={show('connection')}>
            {(p) => (
              <Select {...p} value={connectionId} onChange={(e) => setConnectionId(e.target.value)} data-autofocus>
                <option value="">{connections.isLoading ? 'Loading connections…' : 'Choose a connection'}</option>
                {[...all]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} · {providerLabel(c.type)}
                      {c.status !== 'active' ? ' (disabled)' : ''}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        )}

        <Field id="enroll-cluster" label="Cluster name" hint="The clusterName the agent chart is installed with. Enrollment is refused from any other cluster." error={show('cluster')}>
          {(p) => (
            <Input
              {...p}
              value={clusterTyped ?? connection?.cluster_name ?? ''}
              onChange={(e) => setClusterTyped(e.target.value)}
              placeholder="payments-dev"
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </Field>

        <Field id="enroll-name" label="Agent name" hint="How this console lists the agent. The enrollment command sends it." error={show('name')}>
          {(p) => <Input {...p} value={nameTyped ?? name} onChange={(e) => setNameTyped(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />}
        </Field>

        <Field id="enroll-ttl" label="Token lifetime" hint="Unused tokens expire. Pick the shortest time you need to run the enrollment command.">
          {(p) => (
            <Select {...p} value={ttl} onChange={(e) => setTtl(Number(e.target.value))}>
              {LIFETIMES.map((l) => (
                <option key={l.seconds} value={l.seconds}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {failed != null && (
          <Banner tone="error" title="No token was created.">
            {createErrorText(failed)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function Steps({ issued, onCopied, closeWarned }: { issued: Issued; onCopied: () => void; closeWarned: boolean }) {
  const now = useNow(15_000);
  const agents = useAdminAgents();
  const [store, setStore] = useState<CredentialStore>(issued.connection.type === 'vault' ? 'vault' : issued.connection.type === 'aws-sm' ? 'aws-sm' : 'kubectl');
  const [path, setPath] = useState(defaultStorePath(issued.cluster));

  const endpoint = window.location.origin;
  const enroll = enrollCommand({ endpoint, connection: issued.connection, cluster: issued.cluster, name: issued.name, store, path });
  const helm = helmInstallCommand(issued.connection, issued.cluster, endpoint);
  const expired = Date.parse(issued.expiresAt) <= now;
  const copied = issued.token === null;

  // The new agent: bound to this connection, from this cluster, created
  // after the token was issued (both times come from the server).
  const enrolled = (agents.data ?? []).find(
    (a) => a.provider_connection_id === issued.connection.id && a.cluster_name === issued.cluster && Date.parse(a.created_at) >= issued.issuedAt - 60_000,
  );

  return (
    <div className="flex flex-col gap-6">
      {closeWarned ? (
        <Banner tone="error" title="You haven't copied the token.">
          It can't be shown again. If you close now, create a new token when you're ready to enroll.
        </Banner>
      ) : expired ? (
        <Banner tone="error" title="This token has expired.">
          The enrollment command can't use it any more. Close this panel and create a new token when you're ready.
        </Banner>
      ) : (
        <Banner title={copied ? 'Token copied. This page no longer holds it.' : 'You can copy the token once.'}>
          It works once and expires at {formatClock(issued.expiresAt)} ({formatRemaining(issued.expiresAt, now)}).
        </Banner>
      )}

      <KeyCustodyNote />

      <section aria-labelledby="step-enroll" className="flex flex-col gap-3">
        <h3 id="step-enroll" className="text-body font-semibold text-ink">
          1. Run the enrollment command on your machine
        </h3>
        <p className="text-ui font-normal text-muted">
          Use a trusted machine inside your boundary that can reach this control plane and write to your secret store. Pick where the
          agent's credential and private key go:
        </p>
        <StorePicker idPrefix="enroll-store" store={store} onStore={setStore} path={path} onPath={setPath} />
        <CommandBlock label="Enrollment command" command={enroll} />
        <p className="text-caption text-muted">
          Run it in bash or zsh. It waits at a silent prompt for the token (step 2). The token goes to the command on stdin, never as an
          argument, so it stays out of your shell history and the process list. Only the agent id and the key fingerprint are printed.
          {endpoint.startsWith('http:') && ' This console is on plain HTTP; the command refuses an http endpoint, so use the control plane HTTPS address.'}
        </p>
      </section>

      <section aria-labelledby="step-token" className="flex flex-col gap-2">
        <h3 id="step-token" className="text-body font-semibold text-ink">
          2. Paste the one-time token at the prompt
        </h3>
        <OnceToken label="Enrollment token" token={issued.token} onCopied={onCopied} />
      </section>

      {isExternalStore(store) && (
        <section aria-labelledby="step-sync" className="flex flex-col gap-2">
          <h3 id="step-sync" className="text-body font-semibold text-ink">
            3. Sync it into the cluster
          </h3>
          <SyncToCluster path={path} />
        </section>
      )}

      <section aria-labelledby="step-helm" className="flex flex-col gap-2">
        <h3 id="step-helm" className="text-body font-semibold text-ink">
          {isExternalStore(store) ? '4.' : '3.'} Deploy the agent
        </h3>
        <CommandBlock label="Helm command" command={helm} />
        <p className="text-caption text-muted">
          The chart mounts the Secret read-only and the agent refuses to start if a key is missing or malformed. Replace the
          &lt;placeholders&gt;: pin the chart version and the agent image digest, and fill in the provider settings. No token, key or
          credential goes into chart values.
        </p>
      </section>

      <section aria-labelledby="step-watch" className="flex flex-col gap-2">
        <h3 id="step-watch" className="text-body font-semibold text-ink">
          {isExternalStore(store) ? '5.' : '4.'} Watch it connect
        </h3>
        <div aria-live="polite" className="rounded-md border border-border bg-surface px-3.5 py-3 text-ui font-normal">
          {enrolled ? (
            <div className="flex flex-col gap-1">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium text-ink">{enrolled.name}</span>
                <AgentStatusWord status={enrolled.status} />
                <span className="text-muted">
                  {enrolled.status === 'active' ? 'Heartbeats are arriving. You can close this panel.' : 'Enrolled. Waiting for its first heartbeat.'}
                </span>
              </p>
              {enrolled.public_key_fingerprint && (
                <p className="text-caption text-muted">
                  Registered key <span className="break-all font-mono text-mono-small text-ink">{enrolled.public_key_fingerprint}</span>. It should match the
                  fingerprint the command printed.
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted">No agent from cluster {issued.cluster} has enrolled on this connection yet. This updates on its own.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function createErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Network error. Try again.';
  if (err.status === 409) return '409: This connection is not active. Enable it, then create the token.';
  if (err.status === 503) return '503: Agent enrollment is not configured on this control plane. Ask the platform team.';
  if (err.status === 403) return "403: You don't have permission to enroll agents (agent.mint).";
  if (err.status === 404) return '404: That connection no longer exists.';
  if (err.status === 429) return '429: Too many tokens were created just now. Wait a minute and try again.';
  return `${err.status}: ${err.message}`;
}
