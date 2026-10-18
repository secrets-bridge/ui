/**
 * Enroll an agent (ui#93, api#177). Two steps in one drawer:
 *
 * 1. Choose the provider connection the agent will serve, the cluster
 *    it runs in and how long the token lives (15 minutes to 24 hours).
 *    The cluster name is bound into the token, so an agent that reports
 *    another cluster is refused.
 * 2. The one-time token, shown once, inside the command that stores it
 *    as a Kubernetes Secret, and the helm command that installs the
 *    agent chart in enrollment mode. The chart reads the token from that
 *    Secret and never takes it as a chart value. The drawer then watches
 *    the agent list until the agent enrolls and heartbeats.
 *
 * Token hygiene: the token lives only in this component's state. The
 * mutation is reset as soon as the token is copied into state, it is
 * masked until "Show token", copied with `copySecret` and cleared from
 * the clipboard (best effort) when the drawer closes. Closing before
 * copying asks once, because the token can't be shown again.
 */

import { useState } from 'react';

import { useAdminAgents, useCreateEnrollmentToken } from '../../api/agents';
import { ApiError } from '../../api/client';
import { useProviderConnectionsAdmin } from '../../api/providerConnections';
import type { ProviderConnection } from '../../api/types';
import { providerLabel } from '../../lib/providers';
import { copySecret, useClearCopiedSecretOnUnmount } from '../../lib/secretClipboard';
import { formatClock, formatRemaining } from '../../lib/time';
import { useNow } from '../../lib/useNow';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { Field, Input, Select } from '../../ui/Field';
import { AgentStatusWord } from './AgentStatusWord';

const LIFETIMES = [
  { seconds: 900, label: '15 minutes' },
  { seconds: 3600, label: '1 hour' },
  { seconds: 86400, label: '24 hours' },
];

const NAMESPACE = 'secrets-bridge';
const TOKEN_SECRET = 'secrets-bridge-agent-enroll';
const MASK = '••••••••••••';

interface Issued {
  token: string;
  expiresAt: string;
  /** Server time the token was issued (expiry minus lifetime). */
  issuedAt: number;
  connection: ProviderConnection;
  cluster: string;
}

export function EnrollAgentDrawer({ initialConnectionId, onClose }: { initialConnectionId?: string; onClose: () => void }) {
  const connections = useProviderConnectionsAdmin();
  const create = useCreateEnrollmentToken();
  useClearCopiedSecretOnUnmount();

  const [connectionId, setConnectionId] = useState(initialConnectionId ?? '');
  const [clusterTyped, setClusterTyped] = useState<string | null>(null);
  const [ttl, setTtl] = useState(900);
  const [tried, setTried] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [closeWarned, setCloseWarned] = useState(false);

  const all = connections.data ?? [];
  const connection = all.find((c) => c.id === connectionId);
  // The connection's own cluster name is the default; typing replaces it.
  const cluster = (clusterTyped ?? connection?.cluster_name ?? '').trim();

  const errors: Record<string, string> = {};
  if (!connection) errors.connection = 'Choose the connection this agent will serve.';
  else if (connection.status !== 'active') errors.connection = 'This connection is disabled. Enable it first.';
  if (!cluster) errors.cluster = 'Name the cluster the agent runs in.';
  else if (/\s/.test(cluster) || cluster.length > 100) errors.cluster = 'Use the cluster identifier, without spaces.';
  const show = (k: string) => (tried ? errors[k] : undefined);

  const submit = async () => {
    setTried(true);
    const first = ['connection', 'cluster'].find((k) => errors[k]);
    if (first || !connection) {
      document.getElementById(first === 'cluster' ? 'enroll-cluster' : 'enroll-connection')?.focus();
      return;
    }
    try {
      const res = await create.mutateAsync({ connectionId: connection.id, expected_cluster_name: cluster, expires_in_seconds: ttl });
      setIssued({ token: res.enrollment_token, expiresAt: res.expires_at, issuedAt: Date.parse(res.expires_at) - ttl * 1000, connection, cluster });
      create.reset();
    } catch {
      // Shown in the banner below.
    }
  };

  const close = () => {
    if (issued && !copied && !closeWarned) {
      setCloseWarned(true);
      return;
    }
    onClose();
  };

  if (issued) {
    return (
      <Drawer
        title="Install the agent"
        subtitle={`${issued.connection.name} · ${providerLabel(issued.connection.type)} · cluster ${issued.cluster}`}
        onClose={close}
        wide
        footer={
          <Button variant={closeWarned && !copied ? 'danger' : 'primary'} onClick={close}>
            {closeWarned && !copied ? 'Close anyway' : 'Done'}
          </Button>
        }
      >
        <TokenSteps issued={issued} copied={copied} onCopied={() => setCopied(true)} closeWarned={closeWarned && !copied} />
      </Drawer>
    );
  }

  return (
    <Drawer
      title="Enroll an agent"
      subtitle="Creates a one-time token that an agent trades for its own credential on first start."
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
              ? 'Listing connections needs integration.edit as well as agent.mint. Ask an administrator.'
              : 'Try again in a moment.'}
          </Banner>
        ) : (
          <Field
            id="enroll-connection"
            label="Provider connection"
            hint="The agent is bound to this connection for good. One agent per connection and cluster."
            error={show('connection')}
          >
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

        <Field
          id="enroll-cluster"
          label="Cluster name"
          hint="The clusterName the agent chart is installed with. Enrollment is refused from any other cluster."
          error={show('cluster')}
        >
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

        <Field id="enroll-ttl" label="Token lifetime" hint="Unused tokens expire. Pick the shortest time you need to run the install.">
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

        {create.isError && (
          <Banner tone="error" title="No token was created.">
            {createErrorText(create.error)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function TokenSteps({ issued, copied, onCopied, closeWarned }: { issued: Issued; copied: boolean; onCopied: () => void; closeWarned: boolean }) {
  const now = useNow(15_000);
  const [showToken, setShowToken] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [helmCopied, setHelmCopied] = useState(false);
  const agents = useAdminAgents();

  const secretCmd = (token: string) =>
    [`kubectl -n ${NAMESPACE} create secret generic ${TOKEN_SECRET} \\`, `  --from-literal=enrollment_token=${token}`].join('\n');
  const endpoint = window.location.origin;
  const helm = helmCommand(issued, endpoint);
  const expired = Date.parse(issued.expiresAt) <= now;

  // The new agent: bound to this connection, from this cluster, created
  // after the token was issued (both times come from the server).
  const enrolled = (agents.data ?? []).find(
    (a) =>
      a.provider_connection_id === issued.connection.id &&
      a.cluster_name === issued.cluster &&
      Date.parse(a.created_at) >= issued.issuedAt - 60_000,
  );

  return (
    <div className="flex flex-col gap-5">
      {closeWarned ? (
        <Banner tone="error" title="You haven't copied the token.">
          It can't be shown again. If you close now, create a new token when you're ready to install.
        </Banner>
      ) : expired ? (
        <Banner tone="error" title="This token has expired.">
          An agent can't enroll with it any more. Close this panel and create a new token when you're ready to install.
        </Banner>
      ) : (
        <Banner title="Copy the token now. It is shown only once.">
          It works once and expires at {formatClock(issued.expiresAt)} ({formatRemaining(issued.expiresAt, now)}).
        </Banner>
      )}

      <section aria-labelledby="step-secret" className="flex flex-col gap-2">
        <h3 id="step-secret" className="text-body font-semibold text-ink">
          1. Store the token in the workload cluster
        </h3>
        <pre className="overflow-x-auto rounded-md border border-border bg-sunken px-3 py-2.5 font-mono text-mono-small leading-relaxed text-ink">
          {secretCmd(showToken ? issued.token : MASK)}
        </pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              setCopyError(null);
              try {
                await copySecret(secretCmd(issued.token));
                onCopied();
              } catch {
                setCopyError("Couldn't copy. Show the token and copy it by hand.");
              }
            }}
          >
            {copied ? 'Copied' : 'Copy command'}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setShowToken((s) => !s)} aria-pressed={showToken}>
            {showToken ? 'Hide token' : 'Show token'}
          </Button>
        </div>
        <p className="text-caption text-muted" aria-live="polite">
          {copyError ??
            (copied
              ? "Copied. Run it before you close this panel: closing clears the clipboard if it still holds the command. Don't rely on that, and remember the token stays in your shell history until it is spent."
              : `Create the ${NAMESPACE} namespace first if it doesn't exist.`)}
        </p>
      </section>

      <section aria-labelledby="step-helm" className="flex flex-col gap-2">
        <h3 id="step-helm" className="text-body font-semibold text-ink">
          2. Install the agent chart
        </h3>
        <pre className="overflow-x-auto rounded-md border border-border bg-sunken px-3 py-2.5 font-mono text-mono-small leading-relaxed text-ink">{helm}</pre>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                // No secret in this one: the chart reads the token from the Secret.
                await navigator.clipboard.writeText(helm);
                setHelmCopied(true);
              } catch {
                setHelmCopied(false);
              }
            }}
          >
            {helmCopied ? 'Copied' : 'Copy command'}
          </Button>
        </div>
        <p className="text-caption text-muted">
          Replace the &lt;placeholders&gt;: pin the chart version and the agent image digest, and fill in the provider
          settings. The token never goes into chart values.
          {endpoint.startsWith('http:') && " This console is on plain HTTP; the chart refuses an http endpoint, so use the control plane's HTTPS address."}
        </p>
      </section>

      <section aria-labelledby="step-watch" className="flex flex-col gap-2">
        <h3 id="step-watch" className="text-body font-semibold text-ink">
          3. Watch it connect
        </h3>
        <div aria-live="polite" className="rounded-md border border-border bg-surface px-3.5 py-3 text-ui font-normal">
          {enrolled ? (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-ink">{enrolled.name}</span>
              <AgentStatusWord status={enrolled.status} />
              <span className="text-muted">
                {enrolled.status === 'active' ? 'Heartbeats are arriving. You can close this panel.' : 'Enrolled. Waiting for its first heartbeat.'}
              </span>
            </p>
          ) : (
            <p className="text-muted">No agent from cluster {issued.cluster} has enrolled on this connection yet. This updates on its own.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function helmCommand(i: Issued, endpoint: string): string {
  const scope = i.connection.scope ?? {};
  const str = (k: string) => (typeof scope[k] === 'string' && scope[k] ? (scope[k] as string) : undefined);
  const provider: string[] =
    i.connection.type === 'vault'
      ? [
          'providers.vault.enabled=true',
          `providers.vault.addr=${str('address') ?? '<vault-address>'}`,
          ...(str('namespace') ? [`providers.vault.namespace=${str('namespace')}`] : []),
          ...(str('mount') ? [`providers.vault.kvMount=${str('mount')}`] : []),
          ...(str('kvPrefix') ? [`providers.vault.kvPrefix=${str('kvPrefix')}`] : []),
          'providers.vault.kubernetesRole=<vault-role>',
        ]
      : i.connection.type === 'aws-sm'
        ? [
            'providers.awsSecretsManager.enabled=true',
            `providers.awsSecretsManager.region=${str('region') ?? '<aws-region>'}`,
            ...(str('endpoint') ? [`providers.awsSecretsManager.endpoint=${str('endpoint')}`] : []),
          ]
        : [];
  const sets = [
    `cp.endpoint=${endpoint}`,
    `clusterName=${i.cluster}`,
    `agent.providerType=${i.connection.type}`,
    'enrollment.enabled=true',
    `enrollment.tokenSecretName=${TOKEN_SECRET}`,
    'identity.mode=file',
    'identity.persistence.enabled=true',
    'image.digest=sha256:<agent-image-digest>',
    ...provider,
  ];
  return [
    'helm upgrade --install secrets-bridge-agent oci://ghcr.io/secrets-bridge/charts/secrets-bridge-agent \\',
    '  --version <chart-version> \\',
    `  --namespace ${NAMESPACE} \\`,
    ...sets.map((s, n) => `  --set ${s}${n < sets.length - 1 ? ' \\' : ''}`),
  ].join('\n');
}

function createErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Network error. Try again.';
  if (err.status === 409) return 'This connection is not active. Enable it, then create the token.';
  if (err.status === 503) return 'Agent enrollment is not configured on this control plane. Ask the platform team.';
  if (err.status === 403) return "You don't have permission to enroll agents (agent.mint).";
  if (err.status === 404) return 'That connection no longer exists.';
  return `${err.status}: ${err.message}`;
}
