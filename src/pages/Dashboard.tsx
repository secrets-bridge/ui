/**
 * Dashboard — operator landing page. Matches the Figma frame
 * `Dashboard · /` on page 05 of the brand file.
 *
 * Layout:
 *   ┌── KPI row ──────────────────────────────────────────────────┐
 *   │ Pending  · Providers · Agents online · Secrets synced (24h) │
 *   ├── two columns ──────────────────────────────────────────────┤
 *   │ LEFT (≈ 60%):                       RIGHT (≈ 40%):          │
 *   │   Pending Approvals (table)           Providers Health      │
 *   │   Recent Audit Activity (timeline)    Agents                │
 *   │                                       Requests this week    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Data wiring strategy:
 *   - Agents card + "Agents online" KPI: REAL — hydrated from
 *     `GET /api/v1/agents` (same shape the existing Agents page uses).
 *   - Pending Approvals: PREVIEW — the requests list endpoint
 *     (api#37 follow-up) and the per-row approve/deny actions land
 *     with the Requests page slice. Rows shown are demo data.
 *   - Recent Audit Activity: PREVIEW — same shape as the future
 *     `/audit` page; placeholder rows for now.
 *   - Providers Health, Secrets synced, Requests-this-week chart:
 *     PREVIEW — depend on the BRD §16 metrics endpoints that aren't
 *     scaffolded yet. Placeholders keep the visual.
 *
 * Sections fed by demo data are tagged with a small `preview` chip in
 * their header so operators don't mistake them for live data.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { useAuditEvents } from '../api/audit';
import { api } from '../api/client';
import { useRequests } from '../api/requests';
import type { Agent } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { VersionChip } from '../ui/VersionChip';
import { StatusPill } from '../ui/StatusPill';

export function Dashboard() {
  const agents = useAgentsSnapshot();
  const { identity, hasPermission } = useAuth();
  const me = identity?.id ?? '';

  // Role-derived view shape. The page is tailored so a developer
  // doesn't see admin-only or approver-only cards (or stale
  // placeholder data). The fall-through "admin" view keeps the rich
  // shape — agents + admin KPIs + everything.
  const isApprover = hasPermission('secret.approve');
  const isAdmin = hasPermission('team.edit') || hasPermission('role.edit');
  const canRequest = hasPermission('secret.request');

  // Real per-user counters from the live api. We always pull "my
  // requests"; we also pull "all pending" only when the caller can
  // actually approve (gate matches the Requests page).
  const myRequestsQ = useRequests({ requester_id: me }, { enabled: !!me && canRequest });
  const pendingQ = useRequests({ status: 'pending' }, { enabled: isApprover });

  const myCounts = useMemo(() => {
    const rows = myRequestsQ.data ?? [];
    const by = (s: string) => rows.filter((r) => r.status === s).length;
    return {
      total: rows.length,
      pending: by('pending'),
      approved: by('approved'),
      rejected: by('rejected'),
      executed: by('executed'),
    };
  }, [myRequestsQ.data]);

  const pendingMineToApprove = useMemo(() => {
    const rows = pendingQ.data ?? [];
    return rows.filter((r) => r.requester_id !== me).length;
  }, [pendingQ.data, me]);

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={
          isAdmin
            ? 'Platform health + the queues your role gates.'
            : isApprover
              ? 'Your requests + the approvals waiting on you.'
              : canRequest
                ? 'Your requests and where they stand.'
                : 'Welcome.'
        }
        actions={<VersionChip />}
      />

      {/* KPI row — tailored per role. Admins get the full quartet
          including agent health; developers + approvers get focused
          per-user numbers without the fake placeholders the old
          dashboard carried. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {canRequest && (
          <Kpi
            label="My open requests"
            value={String(myCounts.pending + myCounts.approved)}
            accent={
              <span className="text-muted text-xs">
                {myCounts.pending} pending · {myCounts.approved} approved
              </span>
            }
            to="/requests"
          />
        )}
        {isApprover && (
          <Kpi
            label="Awaiting my review"
            value={pendingQ.isLoading ? '…' : String(pendingMineToApprove)}
            accent={
              <DotLabel
                tone={pendingMineToApprove === 0 ? 'success' : 'warning'}
              >
                {pendingMineToApprove === 0 ? 'queue empty' : 'open the queue'}
              </DotLabel>
            }
            to="/requests"
          />
        )}
        {canRequest && (
          <Kpi
            label="My executed"
            value={String(myCounts.executed)}
            accent={
              <span className="text-muted text-xs">lifetime</span>
            }
            to="/requests"
          />
        )}
        {isAdmin && (
          <Kpi
            label="Agents Online"
            value={
              agents.loading
                ? '…'
                : `${agents.online} / ${agents.total}`
            }
            accent={
              <DotLabel
                tone={
                  agents.loading
                    ? 'neutral'
                    : agents.online === agents.total && agents.total > 0
                      ? 'success'
                      : 'warning'
                }
              >
                {agents.loading
                  ? 'loading…'
                  : agents.total === 0
                    ? 'no agents minted'
                    : agents.online === agents.total
                      ? 'all healthy'
                      : `${agents.total - agents.online} stale`}
              </DotLabel>
            }
            to="/agents"
          />
        )}
      </div>

      {/* Two-column grid — admins get the full layout; everyone else
          sees just the cards relevant to their role. */}
      <div
        className={
          isAdmin
            ? 'grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6'
            : 'grid grid-cols-1 gap-6'
        }
      >
        <div className="space-y-6">
          {isApprover && <PendingApprovalsCard />}
          {canRequest && !isAdmin && <MyRequestsRecentCard />}
          <RecentAuditCard scopeLabel={isAdmin ? 'all activity' : 'your activity'} />
        </div>
        {isAdmin && (
          <div className="space-y-6">
            <AgentsSummaryCard agents={agents} />
          </div>
        )}
      </div>
    </div>
  );
}

// --- KPI card -------------------------------------------------------

function Kpi({
  label,
  value,
  accent,
  preview,
  to,
}: {
  label: string;
  value: string;
  accent: React.ReactNode;
  preview?: boolean;
  to?: string;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-muted text-xs uppercase tracking-wider font-medium">
          {label}
        </div>
        {preview && (
          <StatusPill variant="neutral" tone="outline">
            preview
          </StatusPill>
        )}
      </div>
      <div className="text-text text-3xl font-bold mt-2 tracking-tight">
        {value}
      </div>
      <div className="mt-2 text-xs">{accent}</div>
    </>
  );
  if (to) {
    return (
      <Card className="p-0 transition-colors hover:border-accent/60">
        <Link to={to} className="block p-5">
          {inner}
        </Link>
      </Card>
    );
  }
  return <Card className="p-5">{inner}</Card>;
}

function DotLabel({
  tone,
  children,
}: {
  tone: 'success' | 'warning' | 'error' | 'neutral';
  children: React.ReactNode;
}) {
  const dot =
    tone === 'success'
      ? 'bg-success'
      : tone === 'warning'
        ? 'bg-yellow-400'
        : tone === 'error'
          ? 'bg-red-400'
          : 'bg-muted';
  return (
    <span className="inline-flex items-center gap-1.5 text-muted">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

// --- Pending Approvals ----------------------------------------------

interface ApprovalRow {
  secret: string;
  requester: string;
  provider: 'Vault' | 'AWS' | 'Azure' | 'GCP';
  ttl: string;
}

const APPROVAL_DEMO_ROWS: ApprovalRow[] = [
  { secret: 'prod/db/password', requester: 'alice@corp', provider: 'Vault', ttl: '1h' },
  { secret: 'prod/payments/stripe', requester: 'bob@corp', provider: 'AWS', ttl: '30m' },
  { secret: 'prod/app/config', requester: 'carol@corp', provider: 'Azure', ttl: '2h' },
  { secret: 'staging/api/key', requester: 'dave@corp', provider: 'GCP', ttl: '4h' },
];

const PROVIDER_DOT: Record<ApprovalRow['provider'], string> = {
  Vault: 'bg-yellow-400',
  AWS: 'bg-orange-400',
  Azure: 'bg-blue-400',
  GCP: 'bg-cyan-400',
};

function PendingApprovalsCard() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <h3 className="text-text font-semibold">Pending Approvals</h3>
          <StatusPill variant="neutral" tone="outline">
            preview
          </StatusPill>
        </div>
        <a
          href="/requests"
          className="text-accent hover:text-accent-bright text-sm font-medium"
        >
          View all
        </a>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted text-[11px] uppercase tracking-wider">
          <tr className="border-b border-border/60">
            <Th>Secret</Th>
            <Th>Requester</Th>
            <Th>Provider</Th>
            <Th>TTL</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {APPROVAL_DEMO_ROWS.map((r) => (
            <tr
              key={r.secret}
              className="border-b border-border/40 last:border-0 hover:bg-bg/20 align-middle"
            >
              <Td>
                <span className="font-mono text-accent text-sm">
                  {r.secret}
                </span>
              </Td>
              <Td className="text-muted">{r.requester}</Td>
              <Td>
                <span className="inline-flex items-center gap-2 text-text">
                  <span
                    className={`inline-block w-1.5 h-1.5 rounded-full ${PROVIDER_DOT[r.provider]}`}
                  />
                  {r.provider}
                </span>
              </Td>
              <Td className="text-text font-mono">{r.ttl}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="primary" size="sm" disabled>
                    Approve
                  </Button>
                  <button
                    disabled
                    className="text-red-300/50 cursor-not-allowed text-sm font-medium"
                  >
                    Deny
                  </button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// --- Recent Audit Activity ------------------------------------------

function RecentAuditCard({ scopeLabel }: { scopeLabel: string }) {
  const { identity, hasPermission } = useAuth();
  const isPrivileged =
    hasPermission('role.edit') ||
    hasPermission('user_role.edit') ||
    hasPermission('team.edit');
  const actor = !isPrivileged && identity ? `user:${identity.id}` : undefined;
  const list = useAuditEvents({ actor, limit: 10 });
  const rows = (list.data ?? []).slice(0, 10);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-2 justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-text font-semibold">Recent activity</h3>
          <StatusPill variant="neutral" tone="outline">
            {scopeLabel}
          </StatusPill>
        </div>
        <Link
          to="/audit"
          className="text-[11px] text-accent hover:text-accent-bright"
        >
          full audit →
        </Link>
      </div>
      {list.isLoading && (
        <div className="px-5 py-6 text-muted text-sm">Loading…</div>
      )}
      {list.data && rows.length === 0 && (
        <div className="px-5 py-6 text-muted text-sm">No events yet.</div>
      )}
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-4 px-5 py-3 border-b border-border/40 last:border-0"
            >
              <span className="font-mono text-muted text-xs w-12 shrink-0">
                {shortTime(r.occurred_at)}
              </span>
              <span className="font-mono text-text text-sm w-36 shrink-0 truncate">
                {r.actor}
              </span>
              <span className="text-muted text-xs font-mono truncate flex-1 min-w-0">
                {r.action}
              </span>
              <span className="text-muted/70 text-[11px] font-mono truncate w-40 shrink-0 hidden md:inline">
                {r.resource}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function shortTime(iso?: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '—';
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// --- My recent requests (developer view) ----------------------------

function MyRequestsRecentCard() {
  const { identity } = useAuth();
  const me = identity?.id ?? '';
  const q = useRequests({ requester_id: me }, { enabled: !!me });
  const rows = (q.data ?? []).slice(0, 8);
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between gap-2">
        <h3 className="text-text font-semibold">My recent requests</h3>
        <Link
          to="/requests"
          className="text-[11px] text-accent hover:text-accent-bright"
        >
          see all →
        </Link>
      </div>
      {q.isLoading && (
        <div className="px-5 py-6 text-muted text-sm">Loading…</div>
      )}
      {q.data && rows.length === 0 && (
        <div className="px-5 py-6 text-muted text-sm">
          You haven&apos;t submitted any requests yet.{' '}
          <Link to="/requests" className="text-accent">
            Open the requests page
          </Link>{' '}
          to file one.
        </div>
      )}
      {rows.length > 0 && (
        <ul>
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 px-5 py-3 border-b border-border/40 last:border-0"
            >
              <Link
                to={`/requests/${r.id}`}
                className="font-mono text-accent hover:text-accent-bright text-xs w-20 shrink-0"
              >
                {r.id.slice(0, 8)}
              </Link>
              <span className="font-mono text-muted text-[11px] uppercase w-14 shrink-0">
                {r.type}
              </span>
              <span className="font-mono text-text text-sm truncate flex-1 min-w-0">
                {r.target_secret_ref}
              </span>
              <StatusPill
                variant={
                  r.status === 'approved' || r.status === 'executed'
                    ? 'success'
                    : r.status === 'rejected' || r.status === 'failed'
                      ? 'cancelled'
                      : 'warning'
                }
                tone="outline"
              >
                {r.status}
              </StatusPill>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- helpers --------------------------------------------------------

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
  return <td className={`px-5 py-3 align-middle ${className}`}>{children}</td>;
}

interface AgentsSnapshot {
  loading: boolean;
  error?: string;
  total: number;
  online: number;
  scopes: string[];
  lastSeenAgo?: string;
}

function AgentsSummaryCard({ agents }: { agents: AgentsSnapshot }) {
  return (
    <Card className="p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-text font-semibold">Agents</h3>
        <Link to="/agents" className="text-[11px] text-accent hover:text-accent-bright">
          manage →
        </Link>
      </div>
      <div className="text-text text-3xl font-bold tracking-tight">
        {agents.loading ? '…' : `${agents.online} / ${agents.total}`}
      </div>
      <div className="text-muted text-xs">
        {agents.loading
          ? 'Loading…'
          : agents.total === 0
            ? 'No agents minted yet.'
            : agents.online === agents.total
              ? 'All agents have a fresh heartbeat.'
              : `${agents.total - agents.online} agent(s) stale or pending — see the Agents page for the live badge.`}
      </div>
      {agents.lastSeenAgo && (
        <div className="text-muted/70 text-[11px]">
          Most recent heartbeat: {agents.lastSeenAgo} ago
        </div>
      )}
      {agents.error && (
        <div className="text-red-300 text-[11px]">{agents.error}</div>
      )}
    </Card>
  );
}

function useAgentsSnapshot(): AgentsSnapshot {
  const [state, setState] = useState<AgentsSnapshot>({
    loading: true,
    total: 0,
    online: 0,
    scopes: [],
  });

  useEffect(() => {
    const ac = new AbortController();
    api
      .get<Agent[]>('/api/v1/agents', { signal: ac.signal })
      .then((rows) => {
        const total = rows.length;
        const online = rows.filter((a) => a.status === 'active').length;
        const scopes = Array.from(
          new Set(
            rows
              .map((a) => {
                if (!a.scope) return null;
                const s = a.scope as Record<string, unknown>;
                return (
                  (s.cluster as string) ??
                  (s.cluster_name as string) ??
                  (s.region as string) ??
                  null
                );
              })
              .filter((x): x is string => !!x),
          ),
        );
        const lastSeen = rows
          .map((a) => (a.last_seen_at ? new Date(a.last_seen_at) : null))
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        setState({
          loading: false,
          total,
          online,
          scopes,
          lastSeenAgo: lastSeen ? formatAgo(lastSeen) : undefined,
        });
      })
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setState({
          loading: false,
          total: 0,
          online: 0,
          scopes: [],
          error:
            err instanceof Error
              ? err.message
              : 'failed to load agents',
        });
      });
    return () => ac.abort();
  }, []);

  return state;
}

function formatAgo(d: Date): string {
  const seconds = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
