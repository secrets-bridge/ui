/**
 * Agents (`/agents`, agent.list): every agent enrolled against a
 * provider connection, with its status, cluster, version and last
 * heartbeat (GET /admin/agents, value-free).
 *
 * - "Enroll an agent" (agent.mint) opens the onboarding drawer: pick a
 *   connection and cluster, create a one-time token you can copy once,
 *   run the enrollment command on your own machine (it creates the
 *   private key there and stores the credential in your secret store),
 *   then deploy the chart with `identity.existingSecret` (skills#116).
 * - A row opens the agent's details: its id, health, and the fingerprint
 *   and version of its registered X25519 wire key. Never a private key or
 *   an agent secret: the console doesn't have them.
 * - Rotate key (agent.mint, fresh second factor) creates a one-time
 *   rotation token for `secrets-bridge-agent rotate-key`.
 * - Revoke (agent.revoke) asks for an optional reason, which goes to the
 *   audit log; heartbeats from a revoked agent are refused at once, and
 *   open rotation tokens stop working.
 *
 * `?connection=<id>` filters the table to one connection; the provider
 * connections page links here with it.
 */

import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { type AdminAgent, type AgentStatus, useAdminAgents, useRevokeAgent } from '../api/agents';
import { useAuth } from '../auth/AuthContext';
import { AGENT_STATUS_LABEL as LABEL, AGENT_STATUS_MEANING as MEANING } from '../lib/agentStatus';
import { providerLabel } from '../lib/providers';
import { formatAgo, formatExact } from '../lib/time';
import { useNow } from '../lib/useNow';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { DataTable, type Column } from '../ui/DataTable';
import { Dialog } from '../ui/Dialog';
import { Drawer } from '../ui/Drawer';
import { EmptyState } from '../ui/EmptyState';
import { Field, Select, Textarea } from '../ui/Field';
import { Keys } from '../ui/Keys';
import { PageHeader } from '../ui/PageHeader';
import { useToast } from '../ui/toastContext';
import { AgentStatusWord } from './agents/AgentStatusWord';
import { EnrollAgentDrawer } from './agents/EnrollAgentDrawer';
import { RotateKeyDrawer } from './agents/RotateKeyDrawer';

export function Agents() {
  const { hasPermission } = useAuth();
  const list = useAdminAgents();
  const now = useNow(15_000);
  const [params, setParams] = useSearchParams();
  const connection = params.get('connection') ?? '';
  const [status, setStatus] = useState<'' | AgentStatus>('');
  const [enrolling, setEnrolling] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const all = list.data ?? [];
  const connections = [...new Map(all.filter((a) => a.provider_connection_id).map((a) => [a.provider_connection_id!, a.provider_connection_name || 'Unnamed connection'])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1]),
  );
  const rows = all
    .filter((a) => !connection || a.provider_connection_id === connection)
    .filter((a) => !status || a.status === status)
    .sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked') || a.name.localeCompare(b.name));
  const open = all.find((a) => a.id === openId) ?? null;
  const count = (s: AgentStatus) => all.filter((a) => a.status === s).length;
  const facts = [
    `${all.length} ${all.length === 1 ? 'agent' : 'agents'}`,
    count('active') && `${count('active')} active`,
    count('stale') && `${count('stale')} stale`,
    count('enrolled') && `${count('enrolled')} waiting for a heartbeat`,
    count('error') && `${count('error')} with errors`,
  ].filter(Boolean);
  const filtered = !!connection || !!status;

  const columns: Column<AdminAgent>[] = [
    {
      key: 'name',
      header: 'Agent',
      render: (a) => (
        <button type="button" onClick={() => setOpenId(a.id)} className="text-left font-medium text-accent hover:underline">
          {a.name}
        </button>
      ),
    },
    { key: 'status', header: 'Status', render: (a) => <AgentStatusWord status={a.status} /> },
    {
      key: 'connection',
      header: 'Connection',
      render: (a) =>
        a.provider_connection_name ? (
          <span>
            {a.provider_connection_name}
            <span className="block text-caption text-muted">{providerLabel(a.provider_type)}</span>
          </span>
        ) : (
          <span className="text-muted">Not bound</span>
        ),
    },
    { key: 'cluster', header: 'Cluster', render: (a) => (a.cluster_name ? <span className="font-mono text-mono">{a.cluster_name}</span> : <span className="text-muted">—</span>) },
    {
      key: 'seen',
      header: 'Last heartbeat',
      render: (a) => (a.last_seen_at ? <span title={formatExact(a.last_seen_at, true)}>{formatAgo(a.last_seen_at, now)}</span> : <span className="text-muted">Never</span>),
      className: 'whitespace-nowrap',
    },
    { key: 'version', header: 'Version', render: (a) => (a.agent_version ? <span className="font-mono text-mono">{a.agent_version}</span> : <span className="text-muted">—</span>) },
    {
      key: 'key',
      header: 'Wire key',
      render: (a) =>
        a.public_key_fingerprint ? (
          <span className="font-mono text-mono-small" title={a.public_key_fingerprint}>
            {shortFingerprint(a.public_key_fingerprint)}
            <span className="block text-caption text-muted">version {a.public_key_version ?? 1}</span>
          </span>
        ) : (
          <span className="text-muted">Not registered</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Agents"
        description={list.data ? facts.join(' · ') : 'Agents run approved reads and changes inside the boundary that holds the secrets.'}
        actions={
          hasPermission('agent.mint') ? (
            <Button variant="primary" onClick={() => setEnrolling(true)}>
              Enroll an agent
            </Button>
          ) : undefined
        }
      />

      {all.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <label className="min-w-[200px] max-[600px]:w-full">
            <span className="sr-only">Connection</span>
            <Select value={connection} onChange={(e) => setParams(e.target.value ? { connection: e.target.value } : {}, { replace: true })} className="w-full">
              <option value="">All connections</option>
              {connections.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </label>
          <label className="min-w-[160px] max-[600px]:w-full">
            <span className="sr-only">Status</span>
            <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="w-full">
              <option value="">Any status</option>
              {(Object.keys(LABEL) as AgentStatus[]).map((s) => (
                <option key={s} value={s}>
                  {LABEL[s]}
                </option>
              ))}
            </Select>
          </label>
          {filtered && (
            <Button
              variant="quiet"
              onClick={() => {
                setStatus('');
                setParams({}, { replace: true });
              }}
            >
              Reset filters
            </Button>
          )}
          {filtered && (
            <span className="text-ui font-normal text-muted" aria-live="polite">
              Showing {rows.length} of {all.length}
            </span>
          )}
        </div>
      )}

      {list.isLoading && <p className="text-muted">Loading agents…</p>}
      {list.isError && (
        <Banner
          tone="error"
          title="Couldn't load the agents."
          action={
            <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
              Try again
            </Button>
          }
        >
          {list.error instanceof ApiError ? `${list.error.status}: ${list.error.message}` : 'Network error.'}
        </Banner>
      )}
      {list.data &&
        (all.length === 0 ? (
          <EmptyState
            title="No agents yet."
            action={
              hasPermission('agent.mint') ? (
                <Button variant="secondary" onClick={() => setEnrolling(true)}>
                  Enroll an agent
                </Button>
              ) : undefined
            }
          >
            An agent runs next to the provider, calls out to the control plane and never opens a port. Enroll one for each provider connection.
          </EmptyState>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-border bg-surface px-4 py-3 text-muted">No agent matches these filters.</p>
        ) : (
          <DataTable
            label="Agents"
            columns={columns}
            rows={rows}
            rowKey={(a) => a.id}
            onRowClick={(a) => setOpenId(a.id)}
            minWidth={880}
            stacked={(a) => (
              <div className="flex flex-col gap-1">
                <p className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => setOpenId(a.id)} className="text-left font-medium text-accent hover:underline">
                    {a.name}
                  </button>
                  <AgentStatusWord status={a.status} />
                </p>
                <p className="text-caption text-muted">
                  {a.provider_connection_name ?? 'Not bound'}
                  {a.cluster_name ? ` · ${a.cluster_name}` : ''} · {a.last_seen_at ? `seen ${formatAgo(a.last_seen_at, now)}` : 'never seen'}
                </p>
              </div>
            )}
          />
        ))}

      {open && <AgentDrawer agent={open} now={now} onClose={() => setOpenId(null)} />}
      {enrolling && <EnrollAgentDrawer initialConnectionId={connection || undefined} onClose={() => setEnrolling(false)} />}
    </div>
  );
}

/** `sha256:` and the first 16 hex digits, for the table; the drawer shows all of it. */
function shortFingerprint(fp: string): string {
  const hex = fp.startsWith('sha256:') ? fp.slice(7) : fp;
  return `sha256:${hex.slice(0, 16)}…`;
}

function AgentDrawer({ agent: a, now, onClose }: { agent: AdminAgent; now: number; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const [revoking, setRevoking] = useState(false);
  const [rotating, setRotating] = useState(false);
  const canRevoke = hasPermission('agent.revoke') && a.status !== 'revoked';
  const canRotate = hasPermission('agent.mint') && a.status !== 'revoked' && !!a.public_key_fingerprint;
  const rows: [string, ReactNode][] = [
    ['Status', <span key="s"><AgentStatusWord status={a.status} /><span className="mt-0.5 block text-caption text-muted">{MEANING[a.status]}</span></span>],
    ['Connection', a.provider_connection_name ? `${a.provider_connection_name} · ${providerLabel(a.provider_type)}` : 'Not bound'],
    ['Cluster', a.cluster_name ? <span key="c" className="font-mono text-mono">{a.cluster_name}</span> : '—'],
    ['Region', a.region || '—'],
    ['Version', a.agent_version ? <span key="v" className="font-mono text-mono">{a.agent_version}</span> : '—'],
    ['Can run', a.capabilities?.length ? <Keys key="k" keys={a.capabilities} variant="chips" /> : '—'],
    ['Last heartbeat', a.last_seen_at ? `${formatAgo(a.last_seen_at, now)} · ${formatExact(a.last_seen_at, true)}` : 'Never'],
    ['Enrolled', formatExact(a.created_at, true)],
  ];
  if (a.revoked_at) rows.push(['Revoked', formatExact(a.revoked_at, true)]);
  if (a.last_status && a.last_status !== a.status) rows.push(['Last report', a.last_status]);
  rows.push(['Agent id', <span key="id" className="break-all font-mono text-mono">{a.id}</span>]);
  rows.push([
    'Wire key',
    a.public_key_fingerprint ? (
      <span key="fp">
        <span className="break-all font-mono text-mono-small">{a.public_key_fingerprint}</span>
        <span className="mt-0.5 block text-caption text-muted">
          {(a.public_key_algorithm || 'x25519').toUpperCase()} public key, version {a.public_key_version ?? 1}. Its private key stays with the
          agent; this console never has it.
        </span>
      </span>
    ) : (
      'Not registered'
    ),
  ]);

  return (
    <Drawer
      title={a.name}
      subtitle="Agent details. Nothing here is a credential."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canRotate && (
            <Button variant="secondary" onClick={() => setRotating(true)}>
              Rotate key…
            </Button>
          )}
          {canRevoke && (
            <Button variant="danger" onClick={() => setRevoking(true)}>
              Revoke…
            </Button>
          )}
        </>
      }
    >
      <dl className="m-0">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {revoking && <RevokeDialog agent={a} onClose={() => setRevoking(false)} />}
      {rotating && <RotateKeyDrawer agent={a} onClose={() => setRotating(false)} />}
    </Drawer>
  );
}

function RevokeDialog({ agent, onClose }: { agent: AdminAgent; onClose: () => void }) {
  const revoke = useRevokeAgent();
  const toast = useToast();
  const [reason, setReason] = useState('');

  return (
    <Dialog
      title={`Revoke ${agent.name}?`}
      onClose={onClose}
      dismissible={!revoke.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={revoke.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={revoke.isPending}
            aria-busy={revoke.isPending}
            onClick={async () => {
              try {
                await revoke.mutateAsync({ id: agent.id, reason: reason.trim() || undefined });
                toast(`Revoked ${agent.name}.`);
                onClose();
              } catch {
                // Shown below.
              }
            }}
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke agent'}
          </Button>
        </>
      }
    >
      <p className="text-muted">
        The control plane refuses this agent's heartbeats and job claims from now on, and any open key rotation token stops
        working. A job it is running fails when it reports back. This can't be undone; enroll a new agent to replace it, and
        delete the old credential from your secret store.
      </p>
      <Field id="revoke-reason" label="Reason (optional)" hint="Recorded in the audit log.">
        {(p) => <Textarea {...p} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus />}
      </Field>
      {revoke.isError && (
        <Banner tone="error" title="Not revoked.">
          {revoke.error instanceof ApiError ? `${revoke.error.status}: ${revoke.error.message}` : 'Network error.'}
        </Banner>
      )}
    </Dialog>
  );
}
