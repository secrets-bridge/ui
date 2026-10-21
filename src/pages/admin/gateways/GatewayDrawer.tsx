/**
 * One Gateway (GET /admin/gateways/:id and /tasks, gateway.list): its
 * facts, enrollment tokens, replicas, advertised connectors and targets,
 * bindings and recent observation tasks. Nothing here is a credential.
 *
 * Actions, each behind its own permission and a fresh second factor:
 * create or revoke an enrollment token (gateway.mint), approve an
 * advertised Argo CD connector and create or delete bindings
 * (gateway.bind), disable, enable or revoke the Gateway (gateway.revoke).
 */

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../../../api/client';
import { missingFactorText } from '../../../api/mfaErrors';
import {
  type Gateway,
  type GatewayBinding,
  type GatewayConnector,
  type GatewayDetail,
  type GatewayEnrollmentTokenMeta,
  useApproveConnector,
  useDeleteBinding,
  useGateway,
  useGatewayTasks,
  useRevokeGateway,
  useRevokeGatewayToken,
  useSetGatewayEnabled,
} from '../../../api/gateways';
import { useEnvironments, useProjects } from '../../../api/tenancy';
import { useAuth } from '../../../auth/AuthContext';
import {
  CONNECTOR_KIND_LABEL,
  CONNECTOR_STATUS_LABEL,
  CONNECTOR_STATUS_TONE,
  GATEWAY_STATUS_MEANING,
  ROLLUP_LABEL,
  ROLLUP_TONE,
  TASK_STATE_LABEL,
  TASK_STATE_TONE,
  VERDICT_REASON,
  words,
} from '../../../lib/gatewayStatus';
import { requestRef } from '../../../lib/requestRef';
import { formatExact } from '../../../lib/time';
import { useNow } from '../../../lib/useNow';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { ConfirmModal } from '../../../ui/ConfirmModal';
import { Dialog } from '../../../ui/Dialog';
import { Drawer } from '../../../ui/Drawer';
import { Field, Input } from '../../../ui/Field';
import { ToneStatus } from '../../../ui/Status';
import { useToast } from '../../../ui/toastContext';
import { BindingDrawer } from './BindingDrawer';
import { GatewayStatusWord } from './GatewayStatusWord';

const errText = (e: unknown) =>
  missingFactorText(e, 'nothing changed') ?? (e instanceof ApiError ? `${e.status}: ${e.message}` : 'Network error.');

export function GatewayDrawer({ id, onClose, onMintToken }: { id: string; onClose: () => void; onMintToken: (g: Gateway) => void }) {
  const { hasPermission } = useAuth();
  const detail = useGateway(id);
  const [confirm, setConfirm] = useState<'disable' | 'enable' | 'revoke' | null>(null);
  const g = detail.data?.gateway;
  const canRevoke = hasPermission('gateway.revoke') && !!g && g.status !== 'revoked';

  return (
    <Drawer
      title={g?.name ?? 'Gateway'}
      subtitle="Gateway details. Nothing here is a credential."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canRevoke && g!.status === 'disabled' && (
            <Button variant="secondary" onClick={() => setConfirm('enable')}>
              Enable…
            </Button>
          )}
          {canRevoke && g!.status !== 'disabled' && (
            <Button variant="secondary" onClick={() => setConfirm('disable')}>
              Disable…
            </Button>
          )}
          {canRevoke && (
            <Button variant="danger" onClick={() => setConfirm('revoke')}>
              Revoke…
            </Button>
          )}
        </>
      }
    >
      {detail.isLoading && <p className="text-muted">Loading the Gateway…</p>}
      {detail.isError && (
        <Banner tone="error" title="Couldn't load this Gateway.">
          {errText(detail.error)}
        </Banner>
      )}
      {detail.data && <Body d={detail.data} onMintToken={onMintToken} />}
      {g && confirm === 'revoke' && <RevokeDialog gateway={g} onClose={() => setConfirm(null)} />}
      {g && (confirm === 'disable' || confirm === 'enable') && (
        <EnableDialog gateway={g} enable={confirm === 'enable'} onClose={() => setConfirm(null)} />
      )}
    </Drawer>
  );
}

function Body({ d, onMintToken }: { d: GatewayDetail; onMintToken: (g: Gateway) => void }) {
  const g = d.gateway;
  const envs = useEnvironments();
  const projects = useProjects();
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]));
  const envById = new Map((envs.data ?? []).map((e) => [e.id, e]));
  const envLabel = (envId: string) => {
    const e = envById.get(envId);
    return e ? `${projectName.get(e.project_id) ?? 'Project'} · ${e.name}` : envId;
  };

  // The detail's replicas_seen is not filled in; count from the rows.
  const now = useNow(30_000);
  const recent = (d.replicas ?? []).filter((r) => now - Date.parse(r.last_seen_at) <= 10 * 60_000).length;
  const facts: [string, ReactNode][] = [
    [
      'Status',
      <span key="s">
        <GatewayStatusWord status={g.status} />
        <span className="mt-0.5 block text-caption text-muted">{GATEWAY_STATUS_MEANING[g.status]}</span>
      </span>,
    ],
    ['Boundary', g.boundary],
    ['Environment', g.environment_id ? envLabel(g.environment_id) : 'Any'],
    ['Replicas', `${recent} seen in the last 10 minutes, ${g.max_replicas} allowed`],
    ['Tasks in flight', `Up to ${g.max_inflight_tasks}`],
    ['Last heartbeat', g.last_seen_at ? formatExact(g.last_seen_at, true) : 'Never'],
  ];
  if (g.last_status) facts.push(['Last report', <span key="lr" className="font-mono text-mono">{g.last_status}</span>]);
  if (g.gateway_version) facts.push(['Version', <span key="v" className="font-mono text-mono">{g.gateway_version}</span>]);
  if (g.contract_versions?.length) facts.push(['Contract', g.contract_versions.join(', ')]);
  if (g.catalog_updated_at) facts.push(['Catalog updated', formatExact(g.catalog_updated_at, true)]);
  if (g.enrolled_at) facts.push(['Enrolled', formatExact(g.enrolled_at, true)]);
  if (g.revoked_at) facts.push(['Revoked', formatExact(g.revoked_at, true)]);
  facts.push(['Created', `${formatExact(g.created_at, true)} by ${g.created_by}`]);
  facts.push(['Gateway id', <span key="id" className="break-all font-mono text-mono">{g.id}</span>]);

  return (
    <div className="flex flex-col gap-6">
      {g.over_privileged && g.status !== 'revoked' && (
        <Banner tone="error" title="This Gateway reports more Argo CD rights than read-only.">
          Its evidence is not used while it is over-privileged. Reduce its Argo CD role to read-only, or disable it.
        </Banner>
      )}
      <dl className="m-0">
        {facts.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[140px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <Tokens gateway={g} tokens={d.enrollment_tokens ?? []} onMintToken={onMintToken} />
      <Replicas d={d} />
      <Connectors d={d} />
      <Bindings d={d} envLabel={envLabel} />
      <Tasks gateway={g} />
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-body font-semibold text-ink">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function List({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none rounded-md border border-border p-0">{children}</ul>;
}

function Item({ children }: { children: ReactNode }) {
  return <li className="flex flex-col gap-1 border-t border-rule px-3.5 py-2.5 text-ui font-normal first:border-t-0">{children}</li>;
}

// --- enrollment tokens ---------------------------------------------------------

function tokenState(t: GatewayEnrollmentTokenMeta, now: number): { word: string; tone: 'ok' | 'warn' | 'neutral' } {
  if (t.consumed_at) return { word: 'Used', tone: 'ok' };
  if (t.revoked_at) return { word: 'Revoked', tone: 'neutral' };
  if (Date.parse(t.expires_at) <= now) return { word: 'Expired', tone: 'neutral' };
  return { word: 'Unused', tone: 'warn' };
}

function Tokens({ gateway, tokens, onMintToken }: { gateway: Gateway; tokens: GatewayEnrollmentTokenMeta[]; onMintToken: (g: Gateway) => void }) {
  const { hasPermission } = useAuth();
  const now = useNow(30_000);
  const revoke = useRevokeGatewayToken();
  const toast = useToast();
  const [revoking, setRevoking] = useState<GatewayEnrollmentTokenMeta | null>(null);
  const canMint = hasPermission('gateway.mint');
  if (!tokens.length && gateway.status !== 'pending') return null;
  return (
    <Section
      title="Enrollment tokens"
      aside={
        canMint && gateway.status === 'pending' ? (
          <Button variant="secondary" size="sm" onClick={() => onMintToken(gateway)}>
            Create enrollment token
          </Button>
        ) : undefined
      }
    >
      {tokens.length === 0 ? (
        <p className="text-muted">No token yet. Create one to enroll this Gateway.</p>
      ) : (
        <List>
          {tokens.map((t) => {
            const st = tokenState(t, now);
            return (
              <Item key={t.id}>
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-x-3">
                    <ToneStatus tone={st.tone}>{st.word}</ToneStatus>
                    <span className="text-caption text-muted">
                      created {formatExact(t.created_at)} · expires {formatExact(t.expires_at)}
                      {t.expected_cluster_name ? ` · cluster ${t.expected_cluster_name}` : ''}
                    </span>
                  </span>
                  {canMint && st.word === 'Unused' && (
                    <Button variant="danger" size="sm" onClick={() => setRevoking(t)}>
                      Revoke…
                    </Button>
                  )}
                </p>
              </Item>
            );
          })}
        </List>
      )}
      {revoking && (
        <ConfirmModal
          title="Revoke this enrollment token?"
          body="A Gateway can't enroll with it any more. Create a new token when you're ready to install."
          confirmText="Revoke token"
          danger
          loading={revoke.isPending}
          error={revoke.error}
          onCancel={() => {
            revoke.reset();
            setRevoking(null);
          }}
          onConfirm={async () => {
            try {
              await revoke.mutateAsync({ tokenId: revoking.id, gatewayId: gateway.id });
              toast('Revoked the enrollment token.');
              setRevoking(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </Section>
  );
}

// --- replicas -------------------------------------------------------------------

function Replicas({ d }: { d: GatewayDetail }) {
  const replicas = d.replicas ?? [];
  if (!replicas.length) return null;
  return (
    <Section title="Replicas">
      <List>
        {replicas.map((r) => (
          <Item key={r.replica_id}>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-mono text-mono-small text-ink">{r.replica_id.slice(0, 8)}</span>
              <ToneStatus tone={r.status === 'ok' ? 'ok' : r.status === 'over_privileged' ? 'bad' : 'warn'}>{r.status.replace(/_/g, ' ')}</ToneStatus>
              <span className="text-caption text-muted">
                {r.in_flight} in flight · last seen {formatExact(r.last_seen_at, true)}
                {r.gateway_version ? ` · ${r.gateway_version}` : ''}
              </span>
            </p>
            {!!r.connectors?.length && (
              <p className="text-caption text-muted">
                {r.connectors.map((c) => `${c.connector_id}: ${c.status.replace(/_/g, ' ')}`).join(' · ')}
              </p>
            )}
          </Item>
        ))}
      </List>
    </Section>
  );
}

// --- connectors -----------------------------------------------------------------

function Connectors({ d }: { d: GatewayDetail }) {
  const { hasPermission } = useAuth();
  const approve = useApproveConnector();
  const toast = useToast();
  const [approving, setApproving] = useState<GatewayConnector | null>(null);
  const [binding, setBinding] = useState<GatewayConnector | null>(null);
  const canBind = hasPermission('gateway.bind') && d.gateway.status !== 'revoked';
  const connectors = d.connectors ?? [];

  return (
    <Section title="Advertised connectors">
      {connectors.length === 0 ? (
        <p className="text-muted">Nothing advertised yet. The Gateway uploads its catalog after it enrolls.</p>
      ) : (
        <List>
          {connectors.map((c) => {
            const targets = c.targets ?? [];
            const bindable = c.kind === 'argocd' && c.status === 'approved' && targets.some((t) => !t.stale);
            return (
              <Item key={c.id}>
                <p className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-ink">{words(c.kind, CONNECTOR_KIND_LABEL)}</span>
                    <span className="font-mono text-mono-small">{c.connector_id}</span>
                    <ToneStatus tone={CONNECTOR_STATUS_TONE[c.status] ?? 'neutral'}>{words(c.status, CONNECTOR_STATUS_LABEL)}</ToneStatus>
                  </span>
                  <span className="flex gap-2">
                    {canBind && c.status === 'advertised' && c.kind === 'argocd' && (
                      <Button variant="secondary" size="sm" onClick={() => setApproving(c)}>
                        Approve…
                      </Button>
                    )}
                    {canBind && bindable && (
                      <Button variant="secondary" size="sm" onClick={() => setBinding(c)}>
                        Bind a target
                      </Button>
                    )}
                  </span>
                </p>
                <p className="text-caption text-muted">
                  {c.approved_at ? `Approved ${formatExact(c.approved_at)}` : 'Not approved'}
                  {c.last_advertised_at ? ` · last advertised ${formatExact(c.last_advertised_at)}` : ''}
                </p>
                {targets.length > 0 && (
                  <ul className="m-0 list-none p-0 text-caption">
                    {targets.map((t) => (
                      <li key={t.target_id} className="flex flex-wrap gap-x-2">
                        <span className="font-mono text-mono-small text-ink">{t.target_id}</span>
                        {(t.namespace || t.name) && (
                          <span className="text-muted">
                            {t.namespace ? `${t.namespace}/` : ''}
                            {t.name}
                          </span>
                        )}
                        {t.stale && <span className="text-muted">· no longer advertised</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Item>
            );
          })}
        </List>
      )}
      {approving && (
        <ConfirmModal
          title={`Approve ${approving.connector_id}?`}
          body="Its advertised Argo CD targets can then be bound to an environment. Approving grants the Gateway nothing in Argo CD; it keeps the read-only rights it has."
          confirmText="Approve connector"
          loading={approve.isPending}
          error={approve.error}
          onCancel={() => {
            approve.reset();
            setApproving(null);
          }}
          onConfirm={async () => {
            try {
              await approve.mutateAsync({ gatewayId: d.gateway.id, connectorId: approving.id });
              toast(`Approved ${approving.connector_id}.`);
              setApproving(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
      {binding && <BindingDrawer gateway={d.gateway} connector={binding} onClose={() => setBinding(null)} />}
    </Section>
  );
}

// --- bindings -------------------------------------------------------------------

function Bindings({ d, envLabel }: { d: GatewayDetail; envLabel: (id: string) => string }) {
  const { hasPermission } = useAuth();
  const del = useDeleteBinding();
  const toast = useToast();
  const [deleting, setDeleting] = useState<GatewayBinding | null>(null);
  const bindings = d.bindings ?? [];
  const connectorName = new Map((d.connectors ?? []).map((c) => [c.id, c.connector_id]));
  const canBind = hasPermission('gateway.bind');

  return (
    <Section title="Bindings">
      {bindings.length === 0 ? (
        <p className="text-muted">No bindings. Approve an Argo CD connector, then bind one of its targets to an environment.</p>
      ) : (
        <List>
          {bindings.map((b) => (
            <Item key={b.id}>
              <p className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{envLabel(b.environment_id)}</span>
                {canBind && (
                  <Button variant="danger" size="sm" onClick={() => setDeleting(b)}>
                    Delete…
                  </Button>
                )}
              </p>
              <p className="text-caption text-muted">
                {b.secret_ref ? (
                  <>
                    Secret path <span className="font-mono text-mono-small text-ink">{b.secret_ref}</span>
                  </>
                ) : (
                  <>
                    Catalog secret <span className="font-mono text-mono-small text-ink">{b.secret_id}</span>
                  </>
                )}
                {' → '}
                {b.argocd_connector_id ? (connectorName.get(b.argocd_connector_id) ?? 'connector') : 'connector'} /{' '}
                <span className="font-mono text-mono-small text-ink">{b.argocd_target_id}</span>
              </p>
              <p className="text-caption text-muted">
                Deadline {Math.round(b.observation_timeout_seconds / 60)} minutes · {b.enabled ? 'enabled' : 'disabled'} · created{' '}
                {formatExact(b.created_at)}
              </p>
            </Item>
          ))}
        </List>
      )}
      {deleting && (
        <ConfirmModal
          title="Delete this binding?"
          body="Changes in this scope are no longer observed by this Gateway. Its open observation tasks are cancelled."
          confirmText="Delete binding"
          danger
          loading={del.isPending}
          error={del.error}
          onCancel={() => {
            del.reset();
            setDeleting(null);
          }}
          onConfirm={async () => {
            try {
              await del.mutateAsync({ id: deleting.id });
              toast('Deleted the binding.');
              setDeleting(null);
            } catch {
              // Shown in the dialog.
            }
          }}
        />
      )}
    </Section>
  );
}

// --- tasks ----------------------------------------------------------------------

function Tasks({ gateway }: { gateway: Gateway }) {
  const tasks = useGatewayTasks(gateway.id, 25);
  const items = tasks.data?.items ?? [];
  // counts and total cover every task of the Gateway, not only this page.
  const counts = Object.entries(tasks.data?.counts ?? {}).filter(([, n]) => !!n);
  const total = tasks.data?.total ?? 0;
  return (
    <Section
      title="Recent tasks"
      aside={
        total > 0 ? (
          <span className="text-caption text-muted">
            {total} {total === 1 ? 'task' : 'tasks'} in all:{' '}
            {counts.map(([s, n]) => `${n} ${(TASK_STATE_LABEL as Record<string, string>)[s]?.toLowerCase() ?? s}`).join(' · ')}
            {items.length < total ? ` · latest ${items.length} shown` : ''}
          </span>
        ) : undefined
      }
    >
      {tasks.isLoading && <p className="text-muted">Loading tasks…</p>}
      {tasks.isError && (
        <Banner tone="error" title="Couldn't load the tasks.">
          {errText(tasks.error)}
        </Banner>
      )}
      {tasks.data && items.length === 0 && <p className="text-muted">No observation tasks yet.</p>}
      {items.length > 0 && (
        <List>
          {items.map((t) => (
            <Item key={t.id}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link to={`/requests/${t.request_id}`} className="font-mono text-mono-small text-accent hover:underline">
                  {requestRef(t.request_id)}
                </Link>
                <ToneStatus tone={TASK_STATE_TONE[t.state] ?? 'neutral'}>{TASK_STATE_LABEL[t.state] ?? t.state}</ToneStatus>
                <ToneStatus tone={ROLLUP_TONE[t.verdict] ?? 'neutral'}>{ROLLUP_LABEL[t.verdict] ?? t.verdict}</ToneStatus>
              </p>
              <p className="text-caption text-muted">
                {t.terminal_at ? `Closed ${formatExact(t.terminal_at)}` : `Deadline ${formatExact(t.deadline_at)}`} · {t.attempt_count}{' '}
                {t.attempt_count === 1 ? 'attempt' : 'attempts'}
                {t.verdict_reason ? ` · ${words(t.verdict_reason, VERDICT_REASON)}` : ''}
              </p>
            </Item>
          ))}
        </List>
      )}
    </Section>
  );
}

// --- disable, enable, revoke ------------------------------------------------------

function EnableDialog({ gateway, enable, onClose }: { gateway: Gateway; enable: boolean; onClose: () => void }) {
  const set = useSetGatewayEnabled();
  const toast = useToast();
  return (
    <ConfirmModal
      title={enable ? `Enable ${gateway.name}?` : `Disable ${gateway.name}?`}
      body={
        enable
          ? 'Its heartbeats and task claims are accepted again.'
          : 'Its next call is refused and its leased tasks go back to the queue. Requests keep working; their observation shows pending until a Gateway reports or the deadline passes. You can enable it again.'
      }
      confirmText={enable ? 'Enable gateway' : 'Disable gateway'}
      danger={!enable}
      loading={set.isPending}
      error={set.error}
      onCancel={() => {
        set.reset();
        onClose();
      }}
      onConfirm={async () => {
        try {
          await set.mutateAsync({ id: gateway.id, enabled: enable });
          toast(enable ? `Enabled ${gateway.name}.` : `Disabled ${gateway.name}.`);
          onClose();
        } catch {
          // Shown in the dialog.
        }
      }}
    />
  );
}

const REASON_RE = /^[a-z0-9_-]{1,64}$/;

function RevokeDialog({ gateway, onClose }: { gateway: Gateway; onClose: () => void }) {
  const revoke = useRevokeGateway();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const reasonError = reason && !REASON_RE.test(reason) ? 'A short code: lowercase letters, digits, _ and -, up to 64.' : undefined;

  return (
    <Dialog
      title={`Revoke ${gateway.name}?`}
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
              setTried(true);
              if (reasonError) return;
              try {
                await revoke.mutateAsync({ id: gateway.id, reason: reason || undefined });
                toast(`Revoked ${gateway.name}.`);
                onClose();
              } catch {
                // Shown below.
              }
            }}
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke gateway'}
          </Button>
        </>
      }
    >
      <p className="text-muted">
        Its heartbeats, catalog uploads and task claims are refused from now on. This can't be undone; create a new Gateway to
        replace it.
      </p>
      <Field id="gw-revoke-reason" label="Reason (optional)" hint="A short code for the audit log, such as key_rotation." error={tried ? reasonError : undefined}>
        {(p) => <Input {...p} value={reason} onChange={(e) => setReason(e.target.value.trim())} className="font-mono" autoComplete="off" spellCheck={false} data-autofocus />}
      </Field>
      {revoke.isError && (
        <Banner tone="error" title="Not revoked.">
          {errText(revoke.error)}
        </Banner>
      )}
    </Dialog>
  );
}
