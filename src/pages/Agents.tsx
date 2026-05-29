/**
 * Agents admin page (`/agents`).
 *
 * Rebuilt from the smoke list into the standard admin pattern:
 * PageHeader + Card-wrapped table + brand-gradient '+ Mint' CTA,
 * StatusPill per row (active / stale / revoked), scope chips,
 * last-seen relative time, Revoke confirm.
 *
 * The mint flow surfaces the platform's other load-bearing security
 * UX: the `agent_secret` is returned by the api ONCE on creation.
 * MintDrawer captures `{name, scope}`, submits, then swaps to a
 * reveal-once panel showing the plaintext secret with a Copy button
 * and a strict "shown once" warning. Closing drops the secret from
 * React state and refetches the list.
 *
 * Hard rules:
 *   - The agent_secret is NEVER persisted to localStorage,
 *     sessionStorage, or any cross-tab channel — it lives in this
 *     component's state and is dropped on unmount/close.
 *   - The Mint form is replaced (not extended) by the reveal panel
 *     so an operator can't accidentally re-submit after seeing the
 *     secret.
 *   - The list endpoint NEVER carries the secret — confirmed by the
 *     api's admin projection that omits both `secret_hash` and any
 *     plaintext field from the row shape.
 */

import { useEffect, useState } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { ApiError } from '../api/client';
import {
  agentsKey,
  type MintAgentInput,
  type MintAgentResponse,
  useAgents,
  useMintAgent,
  useRevokeAgent,
} from '../api/agents';
import type { Agent } from '../api/types';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfirmModal } from '../ui/ConfirmModal';
import { Drawer } from '../ui/Drawer';
import { PageHeader } from '../ui/PageHeader';
import { StatusPill } from '../ui/StatusPill';

export function Agents() {
  const list = useAgents();
  const revoke = useRevokeAgent();

  const [minting, setMinting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<Agent | null>(null);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Outbound-only execution agents (BRD §14). One identity per cluster; mint here, drop the credentials into the agent's environment, restart the pod."
        actions={
          <Button variant="primary" onClick={() => setMinting(true)}>
            + Mint agent
          </Button>
        }
      />

      {list.isError && (
        <Card className="border-red-500/40 p-5 text-sm mb-4">
          <div className="text-red-300 font-medium">Failed to load agents</div>
          <div className="text-muted mt-1">{stringifyError(list.error)}</div>
        </Card>
      )}

      {list.isLoading && <div className="text-muted text-sm">Loading…</div>}

      {list.data && list.data.length === 0 && (
        <Card className="p-10 text-center text-muted text-sm">
          No agents registered yet. Mint one and drop its credentials
          into the agent pod's environment.
        </Card>
      )}

      {list.data && list.data.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
              <tr className="border-b border-border/60">
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>Scope</Th>
                <Th>Last seen</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((a) => (
                <AgentRow
                  key={a.id}
                  row={a}
                  onRevoke={() => setConfirmRevoke(a)}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {minting && <MintDrawer onClose={() => setMinting(false)} />}

      {confirmRevoke && (
        <ConfirmModal
          title={`Revoke agent "${confirmRevoke.name}"?`}
          body="Heartbeats stop being accepted immediately. Any in-flight job claim will fail on the agent's next complete. The row stays in the table for audit; mint a fresh identity to bring capacity back."
          confirmText="Revoke"
          danger
          onCancel={() => setConfirmRevoke(null)}
          onConfirm={async () => {
            await revoke.mutateAsync(confirmRevoke.id);
            setConfirmRevoke(null);
          }}
          loading={revoke.isPending}
          error={revoke.error}
        />
      )}
    </div>
  );
}

// --- row ------------------------------------------------------------

function AgentRow({
  row: a,
  onRevoke,
}: {
  row: Agent;
  onRevoke: () => void;
}) {
  const revoked = a.status === 'revoked';
  const scopeEntries = Object.entries(a.scope ?? {});
  return (
    <tr className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-top">
      <Td>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-accent text-sm">{a.name}</span>
        </div>
        <div className="text-muted text-[11px] mt-1 font-mono">
          {a.id.slice(0, 8)}…
        </div>
      </Td>
      <Td>
        <StatusPill
          variant={
            a.status === 'active'
              ? 'success'
              : a.status === 'stale'
                ? 'warning'
                : 'cancelled'
          }
          tone="outline"
        >
          {a.status}
        </StatusPill>
      </Td>
      <Td>
        {scopeEntries.length === 0 ? (
          <span className="text-muted text-xs italic">unscoped</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {scopeEntries.map(([k, v]) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 rounded-full bg-bg/60 border border-border px-2 py-0.5 text-[11px] font-mono"
              >
                <span className="text-muted">{k}</span>
                <span className="text-muted/50">=</span>
                <span className="text-accent">{String(v)}</span>
              </span>
            ))}
          </div>
        )}
      </Td>
      <Td className="text-muted text-xs">
        {a.last_seen_at ? (
          <>
            <div>{formatRelativePast(a.last_seen_at)}</div>
            <div className="text-muted/70 mt-0.5 font-mono">
              {formatAbs(a.last_seen_at)}
            </div>
          </>
        ) : (
          <span className="italic">never</span>
        )}
      </Td>
      <Td className="text-right">
        <button
          onClick={onRevoke}
          disabled={revoked}
          title={revoked ? 'Already revoked' : 'Revoke heartbeats'}
          className={
            revoked
              ? 'text-muted/50 cursor-not-allowed text-sm font-medium'
              : 'text-red-300 hover:text-red-200 text-sm font-medium'
          }
        >
          Revoke
        </button>
      </Td>
    </tr>
  );
}

// --- mint drawer (form + reveal-once panel) ------------------------

const schema = z.object({
  name: z.string().min(1, 'name required').max(120),
  scope_cluster: z.string().max(120).optional(),
  scope_extra_key: z.string().max(120).optional(),
  scope_extra_value: z.string().max(255).optional(),
});

type FormShape = z.infer<typeof schema>;

function MintDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const mint = useMintAgent();
  const [revealed, setRevealed] = useState<MintAgentResponse | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormShape>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      scope_cluster: '',
      scope_extra_key: '',
      scope_extra_value: '',
    },
  });

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const scope: Record<string, string> = {};
    if (data.scope_cluster?.trim()) scope.cluster = data.scope_cluster.trim();
    if (data.scope_extra_key?.trim() && data.scope_extra_value?.trim()) {
      scope[data.scope_extra_key.trim()] = data.scope_extra_value.trim();
    }
    const body: MintAgentInput = {
      name: data.name.trim(),
      scope: Object.keys(scope).length > 0 ? scope : undefined,
    };
    const r = await mint.mutateAsync(body);
    setRevealed(r);
  };

  const handleClose = () => {
    setRevealed(null);
    qc.invalidateQueries({ queryKey: agentsKey.all });
    onClose();
  };

  // Drop the plaintext secret on unmount as a defense-in-depth gesture.
  // React state goes away anyway, but explicit null makes review easy.
  useEffect(() => {
    return () => setRevealed(null);
  }, []);

  if (revealed) {
    return (
      <Drawer
        wide
        title={`Minted "${revealed.name}"`}
        onClose={handleClose}
        footer={
          <>
            <span className="text-muted text-[11px] flex-1">
              Closing drops the secret from the SPA forever.
            </span>
            <Button variant="primary" size="md" onClick={handleClose}>
              I've copied it
            </Button>
          </>
        }
      >
        <RevealOncePanel response={revealed} />
      </Drawer>
    );
  }

  return (
    <Drawer
      wide
      title="Mint new agent"
      onClose={onClose}
      footer={
        <>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="mint-agent-form"
            variant="primary"
            size="md"
            disabled={mint.isPending}
          >
            {mint.isPending ? 'Minting…' : 'Mint'}
          </Button>
        </>
      }
    >
      <form
        id="mint-agent-form"
        onSubmit={handleSubmit(onValid)}
        className="space-y-5"
      >
        <Field
          label="Name"
          error={errors.name?.message}
          hint="Operator-readable identifier; surfaced in the agents table and audit log. Common: cluster slug ('prod-eu-vault') or workload slug ('payments-rotator')."
        >
          <input
            type="text"
            {...register('name')}
            className={inputCls + ' font-mono'}
            placeholder="prod-eu-vault"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>

        <fieldset className="border border-border/60 rounded-lg p-4 space-y-3">
          <legend className="text-[11px] text-muted uppercase tracking-wider px-1 font-medium">
            Scope (optional)
          </legend>
          <p className="text-[11px] text-muted/80">
            Operator-supplied metadata. Recommended at minimum:{' '}
            <code className="font-mono">cluster</code> so discovery rows
            and audit events can be filtered by it. The extra
            key/value pair is a quick way to add another tag without
            editing JSON.
          </p>

          <Field label="Cluster">
            <input
              type="text"
              {...register('scope_cluster')}
              className={inputCls + ' font-mono'}
              placeholder="prod-eu"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Extra key">
              <input
                type="text"
                {...register('scope_extra_key')}
                className={inputCls + ' font-mono'}
                placeholder="region"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="Extra value">
              <input
                type="text"
                {...register('scope_extra_value')}
                className={inputCls + ' font-mono'}
                placeholder="eu-central-1"
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </div>
        </fieldset>

        {mint.error instanceof ApiError && (
          <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2">
            {mint.error.status}: {mint.error.message}
          </div>
        )}
      </form>
    </Drawer>
  );
}

// --- reveal-once panel ---------------------------------------------

function RevealOncePanel({ response }: { response: MintAgentResponse }) {
  return (
    <div className="space-y-4">
      <div className="bg-yellow-400/10 border border-yellow-400/40 border-l-4 border-l-yellow-400 rounded-lg px-4 py-3 text-sm">
        <div className="text-yellow-300 font-semibold">
          Shown once — copy them now.
        </div>
        <div className="text-muted text-xs mt-1">
          The agent secret is hashed in the database; this is the only
          moment the plaintext exists in the SPA. After you close this
          drawer it's gone — you'd have to revoke and mint a fresh
          agent.
        </div>
      </div>

      <CopyField label="Agent ID" value={response.id} mono />
      <CopyField label="Agent secret" value={response.agent_secret} mono />

      <div className="bg-bg/40 border border-border/60 rounded-lg p-4 space-y-2">
        <div className="text-text font-medium text-sm">
          Drop into the agent container
        </div>
        <pre className="text-[11px] text-muted overflow-x-auto font-mono whitespace-pre-wrap">
{`SB_AGENT_ID=${response.id}
SB_AGENT_SECRET=${response.agent_secret}
SB_CLUSTER_NAME=<your-cluster-slug>`}
        </pre>
        <div className="text-[11px] text-muted/80">
          For Kubernetes deployments, the recommended path is to write
          these to a <code className="font-mono">Secret</code> and mount
          it as env vars on the agent Deployment. See the agent README
          for the full bootstrap chain.
        </div>
      </div>
    </div>
  );
}

function CopyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={
            'flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 ' +
            (mono ? 'font-mono break-all' : '')
          }
        />
        <Button variant="secondary" size="md" onClick={doCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

// --- shared bits ----------------------------------------------------

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted font-medium uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && !error && (
        <div className="text-[11px] text-muted/80">{hint}</div>
      )}
      {error && <div className="text-xs text-red-300">{error}</div>}
    </div>
  );
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
  return <td className={`px-5 py-3.5 align-top ${className}`}>{children}</td>;
}

const inputCls =
  'w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40';

function formatRelativePast(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const seconds = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatAbs(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  return d.toISOString().replace('T', ' ').slice(0, 19) + 'Z';
}

function stringifyError(e: unknown): string {
  if (e instanceof ApiError) return `${e.status}: ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}
